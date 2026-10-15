// ============================================================================
//  GAME SERVER — WebSocket transport for the host-authoritative Match.
//  Runs inside the host's Electron main process (or standalone via
//  `node dist/server.cjs`). Clients connect with ws://<host-ip>:<port>.
//
//  Channels
//   JSON  client→host : hello, input, use, release, lmb, drop, shove, buck,
//                       color, start, vote, ability, fanatical, calib, runes,
//                       chat, debug, lobby, ping
//   JSON  host→client : welcome, reject, snap (30 Hz), state (10 Hz, FILTERED
//                       per viewer), reveal, toast, big, fx, chat, label,
//                       roleRevealed, recipe, calibUI, runesUI, spyhole,
//                       fanaticalOffer, converted, finale, teleport, coins, pong
//   Binary (voice)    : client→host  Int16 PCM 16 kHz mono frame
//                       host→client  [speakerId u8][gain u8][flags u8][PCM…]
// ============================================================================
import { WebSocketServer } from 'ws';
import os from 'node:os';
import { Match } from './Match.js';
import { PHASE, CER, MIN_PLAYERS, MAX_PLAYERS, SERVER_TICK_HZ, SNAPSHOT_HZ, STATE_HZ, FACTIONS } from '../shared/constants.js';
import { GATES } from '../shared/map.js';

const r2 = v => Math.round(v * 100) / 100;

export class GameServer {
  constructor({ port = 7777, hostToken = null, debugAll = false, log = console.log } = {}) {
    this.port = port; this.hostToken = hostToken; this.log = log;
    this.conns = new Map();
    this.match = new Match({ debugAll, send: (pid, msg) => this.send(pid, msg) });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, perMessageDeflate: false });
      this.wss.on('listening', () => { this.log(`[server] listening on ${this.port}`); resolve(this.port); });
      this.wss.on('error', reject);
      this.wss.on('connection', ws => this.onConnection(ws));
      let last = performance.now();
      this.tickI = setInterval(() => {
        const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
        try { this.match.tick(dt); } catch (e) { this.log('[tick error]', e.stack || e); }
      }, 1000 / SERVER_TICK_HZ);
      this.snapI = setInterval(() => this.broadcastSnap(), 1000 / SNAPSHOT_HZ);
      this.stateI = setInterval(() => this.broadcastState(), 1000 / STATE_HZ);
    });
  }

  stop() {
    clearInterval(this.tickI); clearInterval(this.snapI); clearInterval(this.stateI);
    for (const ws of this.conns.values()) try { ws.close(); } catch { /* ignore */ }
    return new Promise(res => this.wss ? this.wss.close(() => res()) : res());
  }

  send(pid, msg) {
    if (pid === '*') { for (const id of this.conns.keys()) this.send(id, msg); return; }
    const ws = this.conns.get(pid);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  onConnection(ws) {
    ws.pid = null;
    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) return this.onVoice(ws, data);
        const msg = JSON.parse(data.toString());
        if (!ws.pid) return this.onHello(ws, msg);
        this.onMessage(this.match.P(ws.pid), msg);
      } catch (e) { this.log('[msg error]', e.stack || e); }
    });
    ws.on('close', () => { if (ws.pid) { this.conns.delete(ws.pid); this.match.removePlayer(ws.pid); } });
  }

  onHello(ws, msg) {
    if (msg.t !== 'hello') return;
    const isHost = !!this.hostToken && msg.token === this.hostToken;
    const r = this.match.addPlayer({ name: msg.name, isHost });
    if (r.error) { ws.send(JSON.stringify({ t: 'reject', reason: r.error === 'LOBBY_LOCKED' ? 'The ritual has already begun (LOBBY_LOCKED).' : 'The cave is full (11/11).' })); return ws.close(); }
    ws.pid = r.id;
    this.conns.set(r.id, ws);
    ws.send(JSON.stringify({ t: 'welcome', id: r.id, hostId: this.match.hostId, port: this.port }));
  }

  onMessage(p, msg) {
    if (!p) return;
    const m = this.match;
    switch (msg.t) {
      case 'input': {
        const frames = Array.isArray(msg.f) ? msg.f.slice(0, 12) : [];
        for (const f of frames) {
          if (f.seq <= p.lastSeq) continue;
          const dt = Math.max(0, Math.min(0.05, +f.dt || 0)) * m.timeScale;
          m.simulate(p, { fwd: clamp1(f.fwd), strafe: clamp1(f.strafe), yaw: +f.yaw || 0, pitch: Math.max(-1.5, Math.min(1.5, +f.pitch || 0)), jump: !!f.jump, sprint: !!f.sprint }, dt);
          p.lastSeq = f.seq;
        }
        p.lastInputAt = m.time;
        break;
      }
      case 'use': if (process.env.CRYPT_TRACE) this.log('[use]', p.name, msg.target, p.body.x.toFixed(2), p.body.z.toFixed(2), m.phase, p.frozen); this.use(p, String(msg.target || '')); break;
      case 'release': if (p.hold) m.releaseHold(p, 'cancel', true); break;
      case 'lmb': this.lmb(p, msg.target ? String(msg.target) : null); break;
      case 'drop':
        if (p.carryingNpc && m.phase === PHASE.WORK) m.npcs.dropCarried(p, false);
        else m.tasks.dropAny(p);
        break;
      case 'shove': if (m.phase !== PHASE.CEREMONY) m.shove(p, +msg.target); break;
      case 'buck': m.buck(p); break;
      case 'color': m.setColor(p, msg.color); break;
      case 'name': if (m.phase === PHASE.LOBBY) p.name = String(msg.name || p.name).slice(0, 16); break;
      case 'start': m.startGame(p.id); break;
      case 'vote': m.cer.vote(p, msg.amount); break;
      case 'ability': m.roles.use(p, (msg.targets || []).map(Number)); break;
      case 'fanatical': m.cer.fanaticalReply(p, !!msg.accept); break;
      case 'calib': m.tasks.answerCalib(p, +msg.uid, msg.amounts); break;
      case 'runes': m.tasks.answerRunes(p, +msg.uid, +msg.choice); break;
      case 'chat': m.chat(p, msg.text); break;
      case 'debug': m.debug.run(p, String(msg.cmd), msg.a || {}); break;
      case 'lobby': m.returnToLobby(p.id); break;
      case 'ping': this.send(p.id, { t: 'pong', c: msg.c }); break;
      default: break;
    }
  }

  use(p, target) {
    const m = this.match;
    if (target === 'spyhole') { if (m.nearSpyhole(p) && m.phase !== PHASE.LOBBY) m.npcs.spyhole(p); return; }
    if (target.startsWith('npc:')) return m.npcs.inspect(p, +target.slice(4));
    if (target.startsWith('player:')) { if (m.phase === PHASE.WORK || m.phase === PHASE.LOBBY) m.climb(p, +target.slice(7)); return; }
    m.tasks.use(p, target);
  }

  lmb(p, target) {
    const m = this.match;
    if (p.body.ragdoll > 0 || p.carriedBy) return;
    const pid = target && target.startsWith('player:') ? +target.slice(7) : null;
    if (m.phase === PHASE.CEREMONY) {
      if (target && target.startsWith('npc:')) { m.npcs.lmb(p, +target.slice(4)); return; }
      if (p.carryingNpc && m.cer.sub === CER.EXECUTION) return m.npcs.lmbCarrying(p);
      return m.cer.lmb(p, pid);
    }
    if (m.phase === PHASE.WORK) {
      if (target && target.startsWith('npc:') && m.npcs.lmb(p, +target.slice(4))) return;
      if (p.carryingNpc) return m.npcs.lmbCarrying(p);
    }
    if (pid && m.phase !== PHASE.REVEAL) m.shove(p, pid);
  }

  onVoice(ws, data) {
    const m = this.match;
    const sp = m.P(ws.pid);
    if (!sp || sp.muted || sp.gagged || data.length > 4000 || m.phase === PHASE.REVEAL) return;
    for (const [lid, lws] of this.conns) {
      if (lid === sp.id || lws.readyState !== 1) continue;
      const l = m.P(lid);
      if (!l) continue;
      const g = m.voiceGain(sp, l);
      if (g.gain < 0.03) continue;
      const out = Buffer.allocUnsafe(data.length + 3);
      out[0] = sp.id & 255; out[1] = Math.round(Math.min(1, g.gain) * 255); out[2] = (sp.fumesT > 0 ? 1 : 0) | (g.via === 'intercom' ? 2 : 0);
      data.copy(out, 3);
      lws.send(out);
    }
    // Send a "talking" indicator via state (lastVoice)
    sp.lastVoice = m.time;
  }

  // ------------------------------------------------------------------ replication
  broadcastSnap() {
    const m = this.match;
    const ps = m.list.map(p => {
      const b = p.body;
      const flags = (p.frozen ? 1 : 0) | (p.carriedBy ? 2 : 0) | (p.ridingOn ? 4 : 0) | (p.ghost ? 8 : 0) | ((p.hold || p.botWorking) ? 16 : 0) | (b.onGround ? 32 : 0);
      return [p.id, r2(b.x), r2(b.y), r2(b.z), r2(b.yaw), r2(b.pitch), r2(b.ragdoll), r2(b.spin), flags, r2(Math.hypot(b.vx, b.vz))];
    });
    const carry = [];
    for (const t of m.tasks.active.values()) if (t.data.obj) carry.push([t.uid, r2(t.data.obj.x), r2(t.data.obj.z)]);
    const books = [...m.tasks.items.values()].filter(i => i.wild).map(i => [i.id, r2(i.x), r2(i.y), r2(i.z)]);
    for (const [pid] of this.conns) {
      const p = m.P(pid); if (!p) continue;
      const b = p.body;
      this.send(pid, { t: 'snap', ack: p.lastSeq, me: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.onGround ? 1 : 0, r2(b.ragdoll)], p: ps, c: carry, bk: books });
    }
  }

  broadcastState() {
    for (const [pid] of this.conns) { const p = this.match.P(pid); if (p) this.send(pid, this.stateFor(p)); }
  }

  /** Build the filtered game-state view for ONE viewer (Fog of War is enforced here). */
  stateFor(v) {
    const m = this.match;
    const god = v.godMode;
    const players = m.list.map(p => {
      const e = {
        id: p.id, name: p.name, color: p.color, bot: p.isBot, ghost: p.ghost, crystals: p.crystals,
        master: p.id === m.masterId, exec: p.id === m.execId, exhausted: !!p.exhausted, muted: p.muted, gagged: p.gagged,
        fumes: p.fumesT > 0, key: p.hasKey, ward: !!p.immuneChaos, publicNot: p.publicNot || null, rider: p.rider, ridingOn: p.ridingOn, carriedBy: p.carriedBy,
        tool: p.heldTool ? m.tasks.tools.get(p.heldTool)?.type : null, item: p.heldItem ? m.tasks.items.get(p.heldItem)?.type : null,
        load: p.load?.type || null, npc: p.carryingNpc, talking: p.lastVoice && m.time - p.lastVoice < 0.4,
        role: p.roleRevealed || god || p.id === v.id ? p.roleId : null,
        roleUsed: p.roleRevealed ? p.cardUsed : undefined,
      };
      if (m.phase !== PHASE.LOBBY) {
        if (god || p.id === v.id) e.faction = p.faction;
        else if (v.origFaction === FACTIONS.BLOOD && p.origFaction === FACTIONS.BLOOD) e.pact = 'blood';
        if (!god && p.id !== v.id && v.known.has(p.id)) e.known = v.known.get(p.id);
        if (god) e.leader = p.id === m.chaosLeaderId;
      }
      return e;
    });
    const chk = m.phase === PHASE.WORK || m.phase === PHASE.CEREMONY ? m.roles.check(v) : { ok: false, reason: '' };
    const gates = {};
    for (const id of Object.keys(GATES)) gates[id] = m.gateClosedFor(v, id);
    const st = {
      t: 'state', phase: m.phase, ts: m.timeScale, time: r2(m.time), phaseT: r2(m.phaseT), hostId: m.hostId,
      you: {
        id: v.id, faction: v.faction, roleId: v.roleId, cardUsed: v.cardUsed, roleRevealed: v.roleRevealed, crystals: v.crystals, gold: v.gold,
        ability: chk, hold: v.hold ? { t: r2(v.holdT), need: v.hold.need === Infinity ? 0 : v.hold.need, target: v.hold.target } : null,
        frozen: v.frozen, blind: v.blind, key: v.hasKey, god, infiniteMana: v.infiniteMana,
        debug: m.isDebugAllowed(v), host: v.id === m.hostId, leader: v.id === m.chaosLeaderId, fumes: r2(Math.max(0, v.fumesT)),
        muted: v.muted, gagged: v.gagged, shoveCd: r2(v.shoveCd), exhausted: !!v.exhausted, ghost: v.ghost,
        speedMul: r2(m.speedMul(v)), noSprint: !!m.dbg.noSprint, noJump: !!v.heldItem && !!m.tasks.itemHeavy(v.heldItem),
      },
      players, gates,
      bars: m.bars.serialize(), track: m.track, milestones: m.bars.M,
      tasks: m.phase === PHASE.LOBBY ? [] : m.tasks.serializeTasks(),
      world: m.tasks.serializeWorld(),
      npcs: m.npcs.serialize(v),
      spy: { active: m.npcs.spyActive, id: m.npcs.spyId, t: r2(m.npcs.spyT), visited: m.npcs.masterVisited, n: m.npcs.spyN || 0 },
      cer: m.phase === PHASE.CEREMONY ? m.cer.serialize(v) : null,
      tally: m.tally, masterId: m.masterId, execId: m.execId,
      balance: { ...m.balance, threshold: m.cer.baseThreshold, players: m.players.size },
      lobby: m.phase === PHASE.LOBBY ? { count: m.players.size, min: MIN_PLAYERS, max: MAX_PLAYERS, canStart: m.canStart(), ips: lanIps(), port: this.port } : null,
      log: m.publicLog.slice(-6),
    };
    if (m.isDebugAllowed(v)) st.dbg = m.debug.serialize();
    return st;
  }
}

function clamp1(v) { v = +v || 0; return Math.max(-1, Math.min(1, v)); }
function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
