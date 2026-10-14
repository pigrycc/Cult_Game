// ============================================================================
//  BOTS — dummy minions for solo validation of the full macro loop.
//  Behaviour modes (Debug → Bot Behaviour):
//    idle    – stand still (proximity chat / piggyback / shove tests); still
//              performs mandatory duties (Master/Executioner) so a match
//              can never dead-lock
//    roamer  – FSM: PICK → NAVIGATE (waypoint graph A*) → WORK (timed) → PICK
//              + random ceremony votes
//    voter   – idle in the Work Phase, random 0–2 crystals during rebellions
//    human   – "Humanlike": does tasks like a roamer, but reasons about trust
//              (Blood Pact, inspections, flogging evidence), mutinies against a
//              duo it believes hostile, picks captives/executioners/victims for
//              its own cult and fires its role card when it helps its faction
// ============================================================================
import { PHASE, CER, FACTIONS, ROLE_BY_ID } from '../shared/constants.js';
import { NAV_NODES, NAV_EDGES, PORTAL, roomAt } from '../shared/map.js';
import { wallsBetween } from '../shared/physics.js';
import { pick, rand, dist2, weighted } from './util.js';

export const BOT_NAMES = [
  'Grubwick', 'Snivel', 'Mumblecowl', 'Torchnose', 'Wickles', 'Grimsby', 'Pudding', 'Sootfoot', 'Nubbin', 'Moldrick',
  'Tallowmere', 'Gristle', 'Bonnet', 'Skulkin', 'Dribble', 'Hobnail', 'Crumbsworth', 'Wormwood', 'Fennick', 'Bramble',
  'Clinker', 'Mopsy', 'Ashcrumb', 'Pockle', 'Ruffwick', 'Glimmer', 'Sprocket', 'Thimble', 'Murk', 'Ladle',
];
const NODES = Object.entries(NAV_NODES).map(([k, [x, z]]) => ({ k, x, z }));
const ADJ = new Map(NODES.map(n => [n.k, []]));
for (const [a, b] of NAV_EDGES) { ADJ.get(a).push(b); ADJ.get(b).push(a); }
const NODE = Object.fromEntries(NODES.map(n => [n.k, n]));

function nearestVisible(x, z) {
  let best = null, bd = Infinity;
  for (const n of NODES) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd && wallsBetween(x, z, n.x, n.z, 1) === 0) { bd = d; best = n; }
  }
  if (!best) for (const n of NODES) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
  return best;
}
function astar(a, b) {
  const open = new Set([a.k]), g = { [a.k]: 0 }, from = {};
  const h = k => Math.hypot(NODE[k].x - b.x, NODE[k].z - b.z);
  while (open.size) {
    let cur = null, cf = Infinity;
    for (const k of open) { const f = g[k] + h(k); if (f < cf) { cf = f; cur = k; } }
    if (cur === b.k) { const path = [cur]; while (from[path[0]]) path.unshift(from[path[0]]); return path.map(k => NODE[k]); }
    open.delete(cur);
    for (const nb of ADJ.get(cur)) {
      const ng = g[cur] + Math.hypot(NODE[cur].x - NODE[nb].x, NODE[cur].z - NODE[nb].z);
      if (g[nb] === undefined || ng < g[nb]) { g[nb] = ng; from[nb] = cur; open.add(nb); }
    }
  }
  return [b];
}

export class Bots {
  constructor(m) { this.m = m; this.seq = 1; }

  spawn(count) {
    const m = this.m;
    let made = 0;
    while (made < count) {
      const used = new Set(m.list.map(q => q.name));
      const free = BOT_NAMES.filter(n => !used.has(n));
      const r = m.addPlayer({ name: free.length ? pick(free) : `Minion_${this.seq++}`, isBot: true });
      if (r.error) break;
      this.adopt(m.P(r.id)); made++;
    }
    return made;
  }
  removeAll() { for (const p of this.m.list) if (p.isBot && this.m.phase === PHASE.LOBBY) this.m.players.delete(p.id); }

  adopt(p) { p.brain = { state: 'pick', path: [], goal: null, t: 0, stuck: 0, last: { x: p.body.x, z: p.body.z }, lastCheck: 0, cerKey: null, decT: 0, done: false, jit: 0 }; }

  // ---------------------------------------------------------------- steering
  navTo(p, goal, dt, input) {
    const B = p.brain;
    if (!B.goal || dist2(B.goal, goal) > 0.8) {
      B.goal = { x: goal.x, z: goal.z };
      if (wallsBetween(p.body.x, p.body.z, goal.x, goal.z, 1) === 0 && dist2(p.body, goal) < 14) B.path = [];
      else B.path = astar(nearestVisible(p.body.x, p.body.z), nearestVisible(goal.x, goal.z)).map(n => ({ x: n.x, z: n.z }));
    }
    while (B.path.length && dist2(p.body, B.path[0]) < 0.7) B.path.shift();
    // skip ahead if next-next waypoint is visible
    if (B.path.length > 1 && wallsBetween(p.body.x, p.body.z, B.path[1].x, B.path[1].z, 1) === 0 && Math.random() < 0.05) B.path.shift();
    const wp = B.path[0] || B.goal;
    const dx = wp.x - p.body.x, dz = wp.z - p.body.z;
    const d = Math.hypot(dx, dz);
    if (!B.path.length && d < 0.9) return true;
    input.yaw = Math.atan2(-dx, -dz);
    input.fwd = 1;
    input.sprint = d > 4 && !p.heldItem;
    // stuck detection
    B.lastCheck += dt;
    if (B.lastCheck > 1.2) {
      if (dist2(p.body, B.last) < 0.35) { B.stuck++; B.jit = 0.6; B.goal = null; }
      else B.stuck = 0;
      B.last = { x: p.body.x, z: p.body.z }; B.lastCheck = 0;
    }
    if (B.jit > 0) { B.jit -= dt; input.strafe = Math.sin(this.m.time * 7 + p.id) > 0 ? 1 : -1; input.fwd = 0.3; input.jump = Math.random() < 0.05; }
    return false;
  }

  // ---------------------------------------------------------------- main tick
  tick(dt) {
    const m = this.m;
    for (const p of m.list) {
      if (!p.isBot) continue;
      if (!p.brain) this.adopt(p);
      const input = { fwd: 0, strafe: 0, yaw: p.body.yaw, pitch: 0, jump: false, sprint: false };
      if (!p.carriedBy && !p.ridingOn && p.body.ragdoll <= 0) {
        try {
          if (m.phase === PHASE.WORK) this.work(p, dt, input);
          else if (m.phase === PHASE.CEREMONY) this.ceremony(p, dt, input);
        } catch (e) { console.error('[bot]', e); }
      }
      m.simulate(p, input, dt);
    }
  }

  work(p, dt, input) {
    const m = this.m, B = p.brain, mode = m.dbg.botMode;
    p.botWorking = false;
    // Master duty: fetch two captives (owns the bot's tick until both are on the altar)
    if (p.id === m.masterId && !p.ghost && this.masterDuty(p, dt, input)) return;
    if (mode === 'human') this.tryAbility(p, dt);
    if (mode !== 'roamer' && mode !== 'human') return;
    if (B.state === 'pick') {
      const tasks = [...m.tasks.active.values()];
      if (!tasks.length) return;
      const claimed = new Set(m.list.filter(q => q.brain && q !== p && q.brain.task).map(q => q.brain.task));
      const sorted = tasks.filter(t => !claimed.has(t.uid)).map(t => ({ t, d: dist2(p.body, m.tasks.mainPoint(t)) })).sort((a, b) => a.d - b.d);
      const ch = pick(sorted.slice(0, 3));
      if (!ch) return;
      B.task = ch.t.uid; B.state = 'go'; B.goal = null; B.stuck = 0;
    } else if (B.state === 'go') {
      const inst = m.tasks.active.get(B.task);
      if (!inst || B.stuck > 6) { B.state = 'pick'; B.task = null; return; }
      const pt = m.tasks.mainPoint(inst);
      if (this.navTo(p, pt, dt, input) || dist2(p.body, pt) < 1.4) { B.state = 'work'; B.t = rand(5, 9); }
    } else if (B.state === 'work') {
      const inst = m.tasks.active.get(B.task);
      if (!inst) { B.state = 'pick'; B.task = null; return; }
      p.botWorking = true;
      const pt = m.tasks.mainPoint(inst);
      input.yaw = Math.atan2(-(pt.x - p.body.x), -(pt.z - p.body.z));
      B.t -= dt;
      if (B.t <= 0) { m.tasks.forceComplete(inst, [p]); B.state = 'pick'; B.task = null; }
    }
  }

  ceremony(p, dt, input) {
    const m = this.m, cer = m.cer, B = p.brain;
    p.botWorking = false;
    const key = `${m.ceremonyIndex}:${cer.sub}:${cer.mode}:${m.masterId}:${m.execId}`;
    if (B.cerKey !== key) { B.cerKey = key; B.decT = rand(1.0, 2.4); B.done = false; B.victim = null; B.goal = null; }
    B.decT -= dt;
    const ready = B.decT <= 0 && !B.done;
    const mode = m.dbg.botMode, human = mode === 'human';
    if (human) this.tryAbility(p, dt);
    switch (cer.sub) {
      case CER.NOMINATE:
        if (p.id === m.masterId && ready) { const el = m.eligibleExec(); if (el.length) { cer.nominate((human ? this.mostTrusted(p, el) : pick(el)).id); B.done = true; } }
        break;
      case CER.VOTE:
        if (ready && cer.isVoter(p)) {
          let v;
          if (mode === 'idle') v = 0;
          else if (human) v = this.wantsMutiny(p) ? Math.min(p.crystals, weighted([[1, 30], [2, 45], [3, 25]])) : 0;
          else v = weighted([[0, 74], [1, 19], [2, 7]]);
          cer.vote(p, Math.min(v, p.crystals)); B.done = true;
        }
        break;
      case CER.REACTION:
        if (cer.fanatical?.pending && cer.fanatical.target === p.id && ready) { cer.fanaticalReply(p, human ? this.wantsMutiny(p) : Math.random() < 0.5); B.done = true; }
        break;
      case CER.EXECUTION:
        if (p.id === m.execId && B.decT <= 0) {
          if (!p.carryingNpc) {
            const n = B.victim ? m.npcs.npcs.get(B.victim) : (human ? this.bestCaptive(p, m.npcs.altar()) : pick(m.npcs.altar()));
            if (!n || n.state !== 'altar') { B.victim = null; break; }
            B.victim = n.id;
            if (this.navTo(p, { x: n.x, z: n.z + 1.0 }, dt, input) || dist2(p.body, n) < 2.2) m.npcs.lmb(p, n.id);
          } else if (this.navTo(p, { x: 0, z: 3.4 }, dt, input) || dist2(p.body, PORTAL) < 4.6) m.npcs.lmbCarrying(p);
        }
        break;
      case CER.CURSE:
        if (!ready) break;
        if (cer.mode === 'eye' && p.id === m.execId) { const c = cer.slapCandidates(p.id); if (c.length) cer.eyeReveal(pick(c)); B.done = true; }
        if (cer.mode === 'abyss' && p.id === m.masterId) { const c = cer.slapCandidates(p.id); if (c.length) cer.giveKey(pick(c)); B.done = true; }
        if (cer.mode === 'initiation' && p.id === m.chaosLeaderId) { const c = cer.initiationCandidates(); if (c.length) cer.convert(pick(c)); B.done = true; }
        break;
      case CER.EVENT:
        if (p.id !== m.masterId || B.decT > 0) break;
        if (['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(cer.mode) && !B.done) {
          const c = cer.slapCandidates(p.id);
          // humanlike: investigate unknowns, silence suspects
          const t = !human ? pick(c) : cer.mode === 'MUTENESS' ? this.leastTrusted(p, c) : (pick(c.filter(q => this.trust(p, q) === 0)) || pick(c));
          if (t) cer.eventSlap(t); B.done = true;
        }
        if (cer.mode === 'LIVING') {
          if (!p.carryingPlayer) {
            let v = B.victim && m.P(B.victim);
            if (!v || v.ghost) { v = human ? this.livingVictim(p, cer.slapCandidates(p.id)) : pick(cer.slapCandidates(p.id)); B.victim = v?.id; }
            if (v && (this.navTo(p, v.body, dt, input) || dist2(p.body, v.body) < 2.2)) cer.liftLiving(p, v);
          } else if (this.navTo(p, { x: 0, z: 3.2 }, dt, input) || m.nearPortal(p, 5)) cer.lmb(p, null);
        }
        break;
      default: break;
    }
  }

  /**
   * Master of Ceremonies, Work Phase: bring 2 captives from the Selection Chamber to the altar.
   *   stage 'enter'   – walk into the chamber (this is what reveals the glyphs to the Master)
   *   stage 'choose'  – pick ONE captive and keep it (sticky: re-picking every tick made the goal
   *                     flip constantly, so the bot dithered on the spot instead of approaching)
   *   stage 'approach'– walk up to it and lift it (LMB)
   *   stage 'deliver' – carry it to the altar and set it down
   * Returns true while the duty is active; false = nothing to do (or gave up), the bot may work.
   */
  masterDuty(p, dt, input) {
    const m = this.m, B = p.brain, human = m.dbg.botMode === 'human';
    const key = `${m.ceremonyIndex}:${m.masterId}`;
    if (B.dutyKey !== key) { B.dutyKey = key; B.captive = null; B.dutyT = 0; B.grabFails = 0; B.gaveUp = false; }
    if (B.gaveUp) return false;

    if (p.carryingNpc) {                                       // deliver
      B.captive = null;
      if (this.navTo(p, { x: 0, z: 5.2 }, dt, input) || dist2(p.body, PORTAL) < 6.5) m.npcs.lmbCarrying(p);
      return true;
    }
    const need = 2 - m.npcs.altar().length;
    const ch = m.npcs.chamber();
    if (need <= 0 || !ch.length || m.npcs.spyActive) { B.captive = null; return false; }

    B.dutyT += dt;
    if (B.dutyT > 45) { B.gaveUp = true; return false; }       // never loop forever: the crypt auto-picks at the ceremony
    if (p.heldItem) m.tasks.dropItem(p);                       // lifting a captive needs free hands
    B.state = 'pick'; B.task = null;                           // abandon any half-done chore

    const inChamber = roomAt(p.body.x, p.body.z) === 'selection';
    let n = B.captive != null ? ch.find(c => c.id === B.captive) : null;
    if (!n && !inChamber) {                                    // enter
      this.navTo(p, { x: 0, z: -19.4 }, dt, input);
      return true;
    }
    if (!n) {                                                  // choose (once)
      n = human ? this.bestCaptive(p, ch) : ch[0];
      B.captive = n.id; B.grabFails = 0;
    }
    if (dist2(p.body, n) < 2.3) {                              // lift
      input.yaw = Math.atan2(-(n.x - p.body.x), -(n.z - p.body.z));
      if (!m.npcs.lmb(p, n.id) && ++B.grabFails > 12) { B.captive = null; B.grabFails = 0; }
    } else this.navTo(p, { x: n.x, z: -21.4 }, dt, input);     // approach
    return true;
  }

  // ================================================================ Humanlike reasoning
  /** +1 known ally, −1 known enemy, 0 unknown (only uses information this bot legitimately has). */
  trust(b, t) {
    if (!t || t === b) return 1;
    const f = b.faction;
    let k = b.known.get(t.id);
    if (!k && b.origFaction === FACTIONS.BLOOD && f === FACTIONS.BLOOD && t.origFaction === FACTIONS.BLOOD) k = FACTIONS.BLOOD;   // Blood Pact
    if (k) return k === f ? 1 : -1;
    if (t.publicNot && t.publicNot === f) return -1;
    return 0;
  }
  mostTrusted(b, list) { const best = Math.max(...list.map(q => this.trust(b, q))); return pick(list.filter(q => this.trust(b, q) === best)); }
  leastTrusted(b, list) { const w = Math.min(...list.map(q => this.trust(b, q))); return pick(list.filter(q => this.trust(b, q) === w)); }

  /** Rebel when the ruling duo looks hostile; decided once per nomination. */
  wantsMutiny(b) {
    const m = this.m, B = b.brain, key = `${m.ceremonyIndex}:${m.masterId}:${m.execId}`;
    if (B.mutKey === key) return B.mutiny;
    const s = this.trust(b, m.P(m.masterId)) + this.trust(b, m.P(m.execId));
    B.mutKey = key; B.mutiny = s < 0 ? true : s > 0 ? false : Math.random() < 0.22;
    return B.mutiny;
  }

  /** Captive score from the bot's cult's point of view (requires glyph knowledge; unknown = 0). */
  captiveScore(b, n) {
    if (!b.knownNpcs.has(n.id)) return 0;
    const T = this.m.tally, f = b.faction;
    if (f === FACTIONS.CHAOS) {
      if (n.faction === FACTIONS.CHAOS) return 2;
      return T[n.faction] < Math.max(T.fire, T.blood) ? 1 : -1;     // nudge Fire/Blood towards a tie
    }
    if (n.faction === f) return 3;
    if (n.faction === FACTIONS.CHAOS) return 0;
    return -2;
  }
  bestCaptive(b, list) {
    if (!list.length) return null;
    const best = Math.max(...list.map(n => this.captiveScore(b, n)));
    return pick(list.filter(n => this.captiveScore(b, n) === best));
  }
  livingVictim(b, cands) {
    const m = this.m, L = m.chaosLeaderId;
    if (b.faction === FACTIONS.CHAOS && b.id !== L && b.known.has(L)) { const l = cands.find(q => q.id === L); if (l) return l; }  // throw our own Leader = instant win
    const pool = cands.filter(q => this.trust(b, q) <= 0);
    return this.leastTrusted(b, pool.length ? pool : cands);
  }

  /** Fire the role card when it helps this bot's cult. Throttled; runs in Work and Ceremony. */
  tryAbility(b, dt) {
    const m = this.m, B = b.brain, R = m.roles, cer = m.cer;
    B.abilT = (B.abilT ?? (2 + Math.random() * 4)) - dt;
    if (B.abilT > 0 || b.cardUsed || b.ghost) return;
    B.abilT = 1.5 + Math.random() * 2.5;
    if (!R.check(b).ok) return;
    const others = m.living.filter(q => q !== b);
    const enemy = l => this.leastTrusted(b, l), ally = l => this.mostTrusted(b, l);
    const valid = (f, l) => l.filter(q => R.validTarget(b, f, q));
    const want = m.phase === PHASE.CEREMONY && m.execId ? this.wantsMutiny(b) : null;
    const total = cer.total ? cer.total() : 0, th = cer.threshold;
    let t = null;
    switch (b.roleId) {
      case 1: { const v = valid('other_los', others).filter(q => q.crystals > 0 && this.trust(b, q) <= 0); if (v.length) t = [enemy(v).id]; break; }
      case 3: if (b.crystals >= 2 && Math.random() < 0.3) t = []; break;
      case 5: if (Math.random() < 0.5) t = []; break;
      case 11: case 16: if (m.phase === PHASE.WORK && Math.random() < 0.15) t = []; break;
      case 17: { const v = valid('used_card', others).filter(q => this.trust(b, q) > 0); if (v.length) t = [v[0].id]; break; }
      case 18: { const v = others.filter(q => q.crystals > 0 && this.trust(b, q) <= 0); if (v.length >= 2) t = [v[0].id, v[1].id, b.id]; break; }
      case 8: { const ex = valid('exhausted', m.list).filter(q => this.trust(b, q) > 0); const tgt = others.filter(q => !q.exhausted && this.trust(b, q) <= 0); if (ex.length && tgt.length) t = [ex[0].id, enemy(tgt).id]; break; }
      case 13: { const el = valid('eligible_exec', m.list); if (el.length) { const a = ally(el); if (this.trust(b, a) > 0) t = [a.id]; } break; }
      case 6: if (want === false) { const v = others.filter(q => cer.isVoter(q) && this.trust(b, q) <= 0); if (v.length >= 2) t = [v[0].id, v[1].id]; } break;
      case 12: if (want) { const v = others.filter(q => cer.isVoter(q) && q.crystals > 0); if (v.length >= 2) t = [v[0].id, v[1].id]; } break;
      case 14: if (want && this.trust(b, m.P(m.masterId)) < 0) t = []; break;
      case 19: { const duo = [m.P(m.masterId), m.P(m.execId)].filter(Boolean); const e = duo.find(q => this.trust(b, q) < 0 && q.crystals > 0); if (e) t = [e.id]; break; }
      case 20: if (want) t = []; break;
      case 2: if (want) { const v = valid('rebel', m.list); if (v.length && total < th) t = [ally(v).id]; } break;
      case 4: if (want === false && total >= th) { const v = valid('rebel', m.list); if (v.length) t = [v.sort((x, y) => (cer.final.get(y.id) || 0) - (cer.final.get(x.id) || 0))[0].id]; } break;
      case 10: if ((cer.final?.get(b.id) || 0) > 0) t = []; break;
      case 15: if (want && total < th && total >= Math.ceil(th / 2)) t = []; break;
      case 21: if (want && total < th) { const v = others.filter(q => cer.isVoter(q) && q.crystals > 0 && this.trust(b, q) >= 0); if (v.length) t = [v[0].id]; } break;
      default: break;
    }
    if (t) R.use(b, t);
  }
}
