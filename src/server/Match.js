// ============================================================================
//  MATCH — host-authoritative game state machine.
//
//   LOBBY ──start(≥5)──▶ STATE_REVEAL_SCREEN ──10s──▶ STATE_GAMEPLAY_WORK
//      ▲                                                  │   ▲
//      │                                   yellow≥milestone│   │ debate over
//      │                                                  ▼   │
//      └──── host "return to lobby" ◀── STATE_FINALE ◀── STATE_CEREMONY
//                                  (final milestone / explosion / Chaos sudden death)
//
//  The Match owns all authoritative data (players, factions, roles, crystals,
//  NPC glyphs). The GameServer serialises *filtered* views of it per client.
// ============================================================================
import {
  PHASE, CER, FACTIONS, ROLES, ROLE_BY_ID, ECONOMY, DEFAULT_TIMERS, MIN_PLAYERS, MAX_PLAYERS,
  ROBE_COLORS, getBalance, MILESTONE_TRACKS, FACTION_INFO,
} from '../shared/constants.js';
import { makeBody, stepBody, inFront, wallsBetween, EYE_H } from '../shared/physics.js';
import { roomAt, lobbySpawn, workSpawn, LOBBY_MIRROR, SPYHOLE, PORTAL, INTERCOMS } from '../shared/map.js';
import { ProgressBars } from './ProgressBars.js';
import { TaskManager } from './TaskManager.js';
import { NpcSystem } from './NpcSystem.js';
import { Ceremony } from './Ceremony.js';
import { Roles } from './Roles.js';
import { Bots } from './Bots.js';
import { Debug } from './Debug.js';
import { shuffle, pick, dist2, garble } from './util.js';

let NEXT_ID = 1;

export class Match {
  constructor(opts = {}) {
    this.opts = opts;
    this.send = opts.send || (() => {});            // (playerId, msg)
    this.players = new Map();
    this.hostId = null;
    this.phase = PHASE.LOBBY;
    this.locked = false;
    this.time = 0;
    this.phaseT = 0;
    this.timeScale = 1;
    this.timers = { ...DEFAULT_TIMERS };
    this.dbg = {
      debugAll: !!opts.debugAll, freezeRed: false, redX: null, redT: 1.5, yellowMul: 1,
      debateSec: null, debateInfinite: false, maxConcurrent: null, mutinyThreshold: null,
      forcedEvent: null, forcedNpcs: null, forcedDuo: null, botMode: 'roamer',
      workSec: null, holdMul: 1, extendedCurses: false,
      forceFaction: new Map(), forceRole: new Map(),
    };
    this.bars = new ProgressBars(this);
    this.tasks = new TaskManager(this);
    this.npcs = new NpcSystem(this);
    this.cer = new Ceremony(this);
    this.roles = new Roles(this);
    this.bots = new Bots(this);
    this.debug = new Debug(this);
    this.balance = getBalance(MIN_PLAYERS);
    this.track = MILESTONE_TRACKS[5];
    this.masterId = null;
    this.execId = null;
    this.exhaustedQueue = [];      // newest last
    this.tally = { fire: 0, blood: 0, chaos: 0 };
    this.sacrificeLog = [];
    this.winner = null;
    this.finaleReason = '';
    this.ceremonyIndex = 0;
    this.chaosLeaderId = null;
    this.publicLog = [];
  }

  // ------------------------------------------------------------------ players
  addPlayer({ name, isBot = false, isHost = false }) {
    if (this.locked) return { error: 'LOBBY_LOCKED' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'ROOM_FULL' };
    const id = NEXT_ID++;
    const used = new Set([...this.players.values()].map(p => p.color));
    const color = ROBE_COLORS.find(c => !used.has(c)) || pick(ROBE_COLORS);
    const sp = lobbySpawn(this.players.size);
    const p = {
      id, name: (name || 'Minion').slice(0, 16), isBot, isHost, color,
      body: makeBody(sp.x, sp.z), inputQ: [], lastSeq: 0, lastInputAt: this.time,
      faction: null, roleId: null, cardUsed: false, roleRevealed: false,
      crystals: ECONOMY.startCrystals, gold: 0, ghost: false, servedMaster: 0,
      muted: false, mutedSince: -1, gagged: false, fumesT: 0, immuneChaos: false, hasKey: false,
      known: new Map(),            // targetId -> faction (private knowledge: inspection / eye / pact)
      knownNpcs: new Set(), infiniteMana: false, godMode: false,
      hold: null, holdT: 0, heldTool: null, heldItem: null, load: null,
      carryingNpc: null, carryingPlayer: null, carriedBy: null, ridingOn: null, rider: null,
      carryHandle: null, lookoutT: 0, shoveCd: 0, blind: false, wasAir: false, frozen: false,
      chatQ: [],
    };
    p.body.yaw = 0; // lobby: face the mirror (north)
    this.players.set(id, p);
    if (isHost && !this.hostId) this.hostId = id;
    if (!this.hostId && !isBot) this.hostId = id;
    this.toastAll(`${p.name} joined the cave.`);
    return { id };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.releaseAll(p);
    if (this.phase === PHASE.LOBBY) this.players.delete(id);
    else { p.disconnected = true; p.isBot = true; p.name += ' (bot)'; this.bots.adopt(p); } // keep match consistent
    if (this.hostId === id) {
      const next = [...this.players.values()].find(q => !q.isBot && !q.disconnected);
      this.hostId = next ? next.id : null;
    }
    this.toastAll(`${p.name} left.`);
  }

  get list() { return [...this.players.values()]; }
  get living() { return this.list.filter(p => !p.ghost); }
  P(id) { return this.players.get(id); }
  isDebugAllowed(p) { return p && (p.id === this.hostId || this.dbg.debugAll); }

  // ------------------------------------------------------------ messaging
  toast(pid, text, kind = 'info') { this.send(pid, { t: 'toast', text, kind }); }
  toastAll(text, kind = 'info') { for (const p of this.list) this.toast(p.id, text, kind); }
  big(pid, text, sub = '', dur = 3, color = '#fff') { this.send(pid, { t: 'big', text, sub, dur, color }); }
  bigAll(text, sub = '', dur = 3, color = '#fff') { for (const p of this.list) this.big(p.id, text, sub, dur, color); }
  fx(type, data = {}) { for (const p of this.list) this.send(p.id, { t: 'fx', type, ...data }); }
  log(text) { this.publicLog.push({ t: Math.round(this.time), text }); if (this.publicLog.length > 40) this.publicLog.shift(); }

  // ------------------------------------------------------------ lobby
  setColor(p, color) {
    if (this.phase !== PHASE.LOBBY) return;
    if (dist2(p.body, LOBBY_MIRROR) > 3.5) return this.toast(p.id, 'Stand in front of the mirror.');
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) p.color = color;
  }

  canStart() { return this.phase === PHASE.LOBBY && this.players.size >= MIN_PLAYERS; }

  startGame(byId) {
    if (byId !== this.hostId) return;
    if (!this.canStart()) return this.toast(byId, `Need at least ${MIN_PLAYERS} minions.`);
    this.locked = true;                             // LOBBY_LOCKED
    const n = this.players.size;
    this.balance = getBalance(n);
    this.track = MILESTONE_TRACKS[this.balance.milestones];
    this.dealIdentities();
    this.bars.reset(this.balance.milestones);
    this.tally = { fire: 0, blood: 0, chaos: 0 };
    this.sacrificeLog = []; this.winner = null; this.ceremonyIndex = 0; this.exhaustedQueue = [];
    this.setPhase(PHASE.REVEAL, this.timers.revealBack + this.timers.revealFront + 0.8);
    for (const p of this.list) {
      this.send(p.id, {
        t: 'reveal', faction: p.faction, roleId: p.roleId,
        back: this.timers.revealBack, front: this.timers.revealFront,
      });
    }
    this.log(`Ritual begins with ${n} minions.`);
  }

  dealIdentities() {
    const ps = shuffle(this.list);
    const b = this.balance;
    let fire = b.fire, blood = b.blood;
    if (Array.isArray(fire)) { const i = Math.random() < 0.5 ? 0 : 1; fire = b.fire[i]; blood = b.blood[i]; }
    const bag = [];
    for (let i = 0; i < b.chaos; i++) bag.push(FACTIONS.CHAOS);
    for (let i = 0; i < blood; i++) bag.push(FACTIONS.BLOOD);
    while (bag.length < ps.length) bag.push(FACTIONS.FIRE);
    const factions = shuffle(bag);
    ps.forEach((p, i) => { p.faction = factions[i]; });
    // Debug overrides (swap to preserve composition where possible)
    for (const [pid, f] of this.dbg.forceFaction) {
      const p = this.P(pid); if (!p || p.faction === f) continue;
      const other = ps.find(q => q.faction === f && !this.dbg.forceFaction.has(q.id));
      if (other) other.faction = p.faction;
      p.faction = f;
    }
    // Roles — strictly unique
    const pool = shuffle(ROLES.map(r => r.id));
    const taken = new Set();
    for (const [pid, r] of this.dbg.forceRole) { const p = this.P(pid); if (p) { p.roleId = r; taken.add(r); } }
    for (const p of ps) {
      if (this.dbg.forceRole.has(p.id)) continue;
      p.roleId = pool.find(r => !taken.has(r)); taken.add(p.roleId);
    }
    const chaos = ps.filter(p => p.faction === FACTIONS.CHAOS);
    this.chaosLeaderId = chaos[0]?.id ?? null;
    for (const p of ps) p.origFaction = p.faction;   // Blood Pact is based on the dealt identity
    for (const p of ps) {
      Object.assign(p, {
        cardUsed: false, roleRevealed: false, crystals: ECONOMY.startCrystals, gold: 0, ghost: false,
        servedMaster: 0, muted: false, gagged: false, fumesT: 0, immuneChaos: false, hasKey: false,
        known: new Map(), knownNpcs: new Set(), exhausted: false,
      });
    }
    // Chaos cultists (11p) know their leader & vice versa
    for (const a of chaos) for (const c of chaos) if (a !== c) a.known.set(c.id, FACTIONS.CHAOS);
    // First Master of Ceremonies — random
    this.masterId = this.dbg.forcedDuo?.master && this.P(this.dbg.forcedDuo.master) ? this.dbg.forcedDuo.master : pick(ps).id;
    this.P(this.masterId).servedMaster = 1;
    this.execId = null;
  }

  isChaosLeader(p) { return p.id === this.chaosLeaderId; }

  setPhase(ph, dur = 0) { this.phase = ph; this.phaseT = dur; this.send('*', { t: 'phase', phase: ph }); }

  beginWork(first = false) {
    this.setPhase(PHASE.WORK, 0);
    if (first) {
      this.list.forEach((p, i) => { const s = workSpawn(i); Object.assign(p.body, { x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, ragdoll: 0 }); });
      this.tasks.initWorld();
    }
    for (const p of this.list) p.frozen = false;
    this.npcs.beginRound();
    this.tasks.fillPool();
    this.bars.running = true;
    const m = this.P(this.masterId);
    if (m) {
      this.big(m.id, '👑 You are the Master of Ceremonies', 'Fetch 2 of the 3 captives from the Selection Chamber (north) — LMB to lift, LMB at the altar to set down.', 6, '#ffd75e');
    }
    for (const p of this.list) if (p.id !== this.masterId) this.big(p.id, 'WORK PHASE', `Keep the crypt standing! Master of Ceremonies: ${m?.name ?? '?'}`, 3.5, '#ffe28a');
    this.fx('gong');
  }

  // ------------------------------------------------------------ main loop
  tick(rdt) {
    const dt = rdt * this.timeScale;
    this.time += dt;
    // Humans: inputs are applied on arrival; keep physics alive when idle
    for (const p of this.list) {
      if (!p.isBot && this.time - p.lastInputAt > 0.15) this.simulate(p, { fwd: 0, strafe: 0, yaw: p.body.yaw, pitch: p.body.pitch }, dt);
      p.shoveCd = Math.max(0, p.shoveCd - dt);
      if (p.fumesT > 0) { p.fumesT -= dt; if (p.fumesT > 0 && Math.random() < dt * 0.06 && p.body.ragdoll <= 0 && !p.frozen) this.ragdoll(p, 1.1, 2.5); }
      if (p.lookoutT > 0) p.lookoutT -= dt;
    }
    this.bots.tick(dt);
    this.updateAttachments();

    switch (this.phase) {
      case PHASE.REVEAL:
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.beginWork(true);
        break;
      case PHASE.WORK:
        this.bars.tick(dt);
        this.tasks.tick(dt);
        this.npcs.tick(dt);
        this.roles.tick(dt);
        break;
      case PHASE.CEREMONY:
        this.tasks.tickHazardsOnly(dt);
        this.cer.tick(dt);
        break;
      case PHASE.FINALE:
        break;
      default: break;
    }
    if (this.phase !== PHASE.LOBBY) this.tasks.tickItems(dt);
  }

  /** Apply one input frame from a client (or bot) to its body. */
  simulate(p, inp, dt) {
    const b = p.body;
    const ctx = {
      gateClosed: id => this.gateClosedFor(p, id),
      speedMul: this.speedMul(p),
      drunk: p.fumesT > 0 ? 1 : 0, time: this.time,
      frozen: p.frozen,
      locked: !!(p.carriedBy || p.ridingOn),
      noJump: !!p.heldItem && !!this.tasks.itemHeavy(p.heldItem),
    };
    const was = b.onGround;
    stepBody(b, inp, dt, ctx);
    if (!was && b.onGround) this.tasks.onLanding(p);
    if (p.ridingOn && inp.jump) this.dismount(p, false);
    // Spy / Master gate bookkeeping
    if (this.phase === PHASE.WORK && p.id === this.masterId && roomAt(b.x, b.z) === 'selection') this.npcs.masterEntered(p);
  }

  speedMul(p) {
    let m = 1;
    if (p.heldItem) { const h = this.tasks.itemHeavy(p.heldItem); if (h) m *= h; }
    if (p.carryHandle) m *= 0.62;
    if (p.rider) m *= 0.8;
    if (p.carryingNpc || p.carryingPlayer) m *= 0.85;
    if (p.ghost) m *= 1.1;
    return m;
  }

  gateClosedFor(p, id) {
    const inCer = this.phase === PHASE.CEREMONY;
    switch (id) {
      case 'selection_grate':
        if (inCer || this.phase !== PHASE.WORK) return true;
        if (this.npcs.spyActive) return p.id !== this.npcs.spyId;
        return p.id !== this.masterId;
      case 'prison_bars': return !p.hasKey;
      case 'cold_door': return !this.tasks.coldDoorOpen();
      case 'barrier_n': case 'barrier_s': case 'barrier_w': case 'barrier_e': return inCer;
      default: return false;
    }
  }

  // ------------------------------------------------------------ attachments
  updateAttachments() {
    for (const p of this.list) {
      if (p.ridingOn) {
        const bot = this.P(p.ridingOn);
        if (!bot) { p.ridingOn = null; continue; }
        Object.assign(p.body, { x: bot.body.x, y: bot.body.y + 0.95, z: bot.body.z, vx: 0, vy: 0, vz: 0 });
        if (bot.body.ragdoll > 0) this.dismount(p, true);
      }
      if (p.carryingPlayer) {
        const v = this.P(p.carryingPlayer);
        if (v) Object.assign(v.body, { x: p.body.x, y: p.body.y + 1.35, z: p.body.z, vx: 0, vy: 0, vz: 0 });
      }
    }
  }

  // ------------------------------------------------------------ physical statuses
  ragdoll(p, secs = 1.5, push = 3, dirX = null, dirZ = null) {
    const b = p.body;
    if (p.ridingOn) this.dismount(p, true);
    if (p.rider) { const r = this.P(p.rider); if (r) this.dismount(r, true); }
    if (p.carriedBy) return;
    this.releaseHold(p);
    if (p.carryHandle) this.tasks.releaseHandle(p);
    let ang = Math.random() * Math.PI * 2;
    if (dirX !== null) ang = Math.atan2(dirZ, dirX);
    b.vx = Math.cos(ang) * push; b.vz = Math.sin(ang) * push; b.vy = Math.max(b.vy, 3 + push * 0.4);
    b.onGround = false; b.ragdoll = secs;
    if (p.heldItem && this.tasks.itemHeavy(p.heldItem)) this.tasks.dropItem(p);
    this.send(p.id, { t: 'fx', type: 'ouch' });
  }

  shove(p, targetId) {
    const t = this.P(targetId);
    if (!t || t === p || p.shoveCd > 0 || p.frozen || p.body.ragdoll > 0 || p.carriedBy || p.ridingOn) return;
    if (dist2(p.body, t.body) > 2.0 || !inFront(p.body, t.body.x, t.body.z, 0.3)) return;
    p.shoveCd = 4;
    if (t.frozen && this.phase === PHASE.CEREMONY) return;
    const dx = t.body.x - p.body.x, dz = t.body.z - p.body.z;
    this.ragdoll(t, 1.3, 6.5, dx, dz);
    this.fx('slap', { x: t.body.x, z: t.body.z });
  }

  climb(p, targetId) {
    const t = this.P(targetId);
    if (!t || t === p || t.rider || t.ridingOn || p.rider || p.ridingOn || t.carriedBy || p.heldItem) return;
    if (t.body.ragdoll > 0 || p.body.ragdoll > 0 || p.frozen || t.frozen) return;
    if (dist2(p.body, t.body) > 2.0) return;
    p.ridingOn = t.id; t.rider = p.id;
    this.releaseHold(p);
    this.toast(p.id, 'You climbed on ' + t.name + "'s back. [SPACE] to hop off — you can only look & use.");
    this.toast(t.id, p.name + ' climbed onto your back! [X] to buck them off.');
  }

  dismount(p, knocked) {
    const bot = this.P(p.ridingOn);
    p.ridingOn = null;
    if (bot) bot.rider = null;
    this.releaseHold(p);
    p.body.y = Math.max(p.body.y, 0.9);
    if (knocked) {
      // Knocked off the back: drop half the gold (stealable by anyone, e.g. the bottom minion)
      const lost = Math.floor(p.gold / 2);
      if (lost > 0) { p.gold -= lost; this.tasks.spawnCoins(p.body.x, p.body.z, lost); this.toast(p.id, `You fell and spilled ${lost} 💰!`, 'warn'); }
      this.ragdoll(p, 1.6, 4.5);
    } else { p.body.vy = 3; p.body.vx = Math.sin(p.body.yaw) * 2; }
  }

  buck(p) { if (p.rider) { const r = this.P(p.rider); if (r) this.dismount(r, true); } }

  /** End a hold-to-interact. reason: 'done' | 'cancel' | 'silent' — the client plays matching feedback. */
  releaseHold(p, reason = 'cancel') {
    if (p.hold && reason !== 'silent' && !p.isBot) this.send(p.id, { t: 'holdEnd', reason, target: p.hold.target });
    p.hold = null; p.holdT = 0;
  }

  releaseAll(p) {
    this.releaseHold(p, 'silent');
    if (p.ridingOn) this.dismount(p, false);
    if (p.rider) { const r = this.P(p.rider); if (r) this.dismount(r, false); }
    if (p.carryHandle) this.tasks.releaseHandle(p);
    if (p.heldItem) this.tasks.dropItem(p);
    if (p.heldTool) this.tasks.returnTool(p);
    p.load = null;
    if (p.carryingNpc) this.npcs.dropCarried(p, true);
    if (p.carryingPlayer) { const v = this.P(p.carryingPlayer); if (v) v.carriedBy = null; p.carryingPlayer = null; }
  }

  teleport(p, x, z, yaw) {
    this.releaseAll(p);
    Object.assign(p.body, { x, y: 0, z, vx: 0, vy: 0, vz: 0, ragdoll: 0 });
    if (yaw !== undefined) p.body.yaw = yaw;
    this.send(p.id, { t: 'teleport', x, z, yaw: p.body.yaw });
  }

  // ------------------------------------------------------------ exhaustion
  applyExhaustion(masterId, execId) {
    for (const id of [masterId, execId]) {
      if (!id) continue;
      this.exhaustedQueue = this.exhaustedQueue.filter(x => x !== id);
      this.exhaustedQueue.push(id);
    }
    const n = this.balance.exhaust;
    this.exhaustedQueue = this.exhaustedQueue.slice(-n);
    this.refreshExhausted();
  }
  refreshExhausted() { for (const p of this.list) p.exhausted = this.exhaustedQueue.includes(p.id); }

  // ------------------------------------------------------------ crystals
  addCrystals(p, n) {
    if (p.infiniteMana && n < 0) return;
    p.crystals = Math.max(0, Math.min(ECONOMY.maxCrystals, p.crystals + n));
  }

  // ------------------------------------------------------------ chat (text) with proximity/intercom rules
  chat(p, text) {
    text = String(text || '').slice(0, 160).trim();
    if (!text) return;
    if (p.muted || p.gagged) return this.toast(p.id, p.muted ? '🤐 Your tongue is cursed — you cannot speak.' : '🔇 The Gagging Seal muffles you.', 'warn');
    const shown = p.fumesT > 0 ? garble(text) : text;
    const global = this.phase !== PHASE.WORK;
    for (const l of this.list) {
      let ch = null;
      if (global || l === p) ch = global ? 'global' : 'local';
      else {
        const g = this.voiceGain(p, l);
        if (g.gain > 0.05) ch = g.via;
      }
      if (ch) this.send(l.id, { t: 'chat', from: p.id, name: p.name, text: shown, ch });
    }
  }

  /** Proximity + wall-occlusion + intercom routing (shared by text & voice). */
  voiceGain(sp, l) {
    if (this.phase !== PHASE.WORK) return { gain: 1, via: 'global' };
    const d = dist2(sp.body, l.body);
    let gain = 0, via = 'local';
    if (d < 20) {
      const occ = wallsBetween(sp.body.x, sp.body.z, l.body.x, l.body.z, 3);
      gain = Math.max(0, 1 - d / 20) * Math.pow(0.3, occ);
    }
    for (const ic of INTERCOMS) {
      if (dist2(sp.body, ic) < 2.6) {
        const out = INTERCOMS.find(o => o.id === ic.pair);
        const d2 = dist2(l.body, out);
        if (d2 < 9) { const g = 0.9 * (1 - d2 / 9); if (g > gain) { gain = g; via = 'intercom'; } }
      }
    }
    return { gain, via };
  }

  // ------------------------------------------------------------ finale
  endMatch(winner, reason) {
    if (this.phase === PHASE.FINALE) return;
    this.winner = winner;
    this.finaleReason = reason;
    this.bars.running = false;
    this.setPhase(PHASE.FINALE);
    const reveal = this.list.map(p => ({ id: p.id, name: p.name, faction: p.faction, roleId: p.roleId, gold: p.gold, ghost: p.ghost, color: p.color, leader: this.isChaosLeader(p) }));
    for (const p of this.list) this.send(p.id, { t: 'finale', winner, reason, tally: this.tally, reveal, log: this.sacrificeLog });
    this.log(`FINALE: ${winner} — ${reason}`);
  }

  returnToLobby(byId) {
    if (byId !== this.hostId || this.phase !== PHASE.FINALE) return;
    this.locked = false;
    this.phase = PHASE.LOBBY;
    this.tasks.clearAll(); this.npcs.reset(); this.cer.reset();
    this.list.forEach((p, i) => {
      this.releaseAll(p);
      const s = lobbySpawn(i);
      Object.assign(p, { faction: null, roleId: null, ghost: false, frozen: false, blind: false });
      this.teleport(p, s.x, s.z, Math.PI);
    });
    this.masterId = this.execId = null;
    this.setPhase(PHASE.LOBBY);
  }

  // ------------------------------------------------------------ helpers
  eligibleExec(excludeIds = []) {
    return this.living.filter(p => p.id !== this.masterId && !p.exhausted && !p.muted && !excludeIds.includes(p.id));
  }
  factionName(f) { return FACTION_INFO[f]?.name ?? f; }
  roleName(id) { return ROLE_BY_ID[id]?.name ?? '?'; }
  eyeOf(p) { return { x: p.body.x, y: p.body.y + EYE_H, z: p.body.z }; }
  nearPortal(p, r = 4.6) { return dist2(p.body, PORTAL) < r; }
  nearSpyhole(p) { return dist2(p.body, SPYHOLE) < 2.4; }
}
