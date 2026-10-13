// ============================================================================
//  BOTS — dummy minions for solo validation of the full macro loop.
//  Behaviour modes (Debug → Bot Behaviour):
//    idle    – stand still (proximity chat / piggyback / shove tests); still
//              performs mandatory duties (Master/Executioner) so a match
//              can never dead-lock
//    roamer  – FSM: PICK → NAVIGATE (waypoint graph A*) → WORK (timed) → PICK
//              + random ceremony votes
//    voter   – idle in the Work Phase, random 0–2 crystals during rebellions
// ============================================================================
import { PHASE, CER } from '../shared/constants.js';
import { NAV_NODES, NAV_EDGES, PORTAL } from '../shared/map.js';
import { wallsBetween } from '../shared/physics.js';
import { pick, rand, dist2, weighted } from './util.js';

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
      const r = m.addPlayer({ name: `Bot_${this.seq++}`, isBot: true });
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
    // Master duty: fetch two captives
    if (p.id === m.masterId && !p.ghost) {
      if (p.carryingNpc) {
        if (this.navTo(p, { x: 0, z: 5.2 }, dt, input) || dist2(p.body, PORTAL) < 6.5) m.npcs.lmbCarrying(p);
        return;
      }
      const need = 2 - m.npcs.altar().length;
      const ch = m.npcs.chamber();
      if (need > 0 && ch.length && !m.npcs.spyActive) {
        const n = ch[0];
        if (this.navTo(p, { x: n.x, z: -21.4 }, dt, input) || dist2(p.body, n) < 2.2) m.npcs.lmb(p, n.id);
        return;
      }
    }
    if (mode !== 'roamer') return;
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
    const mode = m.dbg.botMode;
    switch (cer.sub) {
      case CER.NOMINATE:
        if (p.id === m.masterId && ready) { const el = m.eligibleExec(); if (el.length) { cer.nominate(pick(el).id); B.done = true; } }
        break;
      case CER.VOTE:
        if (ready && cer.isVoter(p)) {
          const v = mode === 'idle' ? 0 : weighted([[0, 74], [1, 19], [2, 7]]);
          cer.vote(p, Math.min(v, p.crystals)); B.done = true;
        }
        break;
      case CER.REACTION:
        if (cer.fanatical?.pending && cer.fanatical.target === p.id && ready) { cer.fanaticalReply(p, Math.random() < 0.5); B.done = true; }
        break;
      case CER.EXECUTION:
        if (p.id === m.execId && B.decT <= 0) {
          if (!p.carryingNpc) {
            const n = B.victim ? m.npcs.npcs.get(B.victim) : pick(m.npcs.altar());
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
        if (['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(cer.mode) && !B.done) { const c = cer.slapCandidates(p.id); if (c.length) cer.eventSlap(pick(c)); B.done = true; }
        if (cer.mode === 'LIVING') {
          if (!p.carryingPlayer) {
            let v = B.victim && m.P(B.victim);
            if (!v || v.ghost) { v = pick(cer.slapCandidates(p.id)); B.victim = v?.id; }
            if (v && (this.navTo(p, v.body, dt, input) || dist2(p.body, v.body) < 2.2)) cer.liftLiving(p, v);
          } else if (this.navTo(p, { x: 0, z: 3.2 }, dt, input) || m.nearPortal(p, 5)) cer.lmb(p, null);
        }
        break;
      default: break;
    }
  }
}
