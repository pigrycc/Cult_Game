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
import { BOT_MECHS } from '../shared/tasks.js';
import { wallsBetween } from '../shared/physics.js';
import { pick, rand, dist2, weighted } from './util.js';

// Humanlike bots perform BOT_MECHS tasks with the REAL game actions (same validated calls a human triggers).
// Everything else (carry, bell, bellows, stack, relay, carcass, calib, books) needs choreography the bots can't do yet, so
// they leave those to players instead of faking them (TaskManager keeps enough bot-doable tasks on the board).
const REAL_MECH = BOT_MECHS;
const USE_RANGE = 1.7;       // how close a bot stands before it interacts

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

  adopt(p) { p.brain = { persona: { chatty: rand(0.4, 0.9) }, state: 'pick', path: [], goal: null, t: 0, stuck: 0, last: { x: p.body.x, z: p.body.z }, lastCheck: 0, cerKey: null, decT: 0, done: false, jit: 0 }; }

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
    this.doTask(p, dt, input);
  }

  // ================================================================ maintenance tasks
  /** Think-time before a big decision. Humanlike bots use the (debug-tunable) botDecisionDelaySeconds ±33 %. */
  think() {
    const d = this.m.dbg.botDecisionDelaySeconds ?? 2.25;
    return d <= 0 ? 0 : d * rand(0.67, 1.33);
  }

  isClaimed(uid, except) {
    const inst = this.m.tasks.active.get(uid);
    const cap = inst && inst.def.mech === 'coop' ? inst.def.handles.length : 1;
    return this.m.list.filter(q => q !== except && q.brain && q.brain.task === uid && q.brain.state !== 'pick').length >= cap;
  }

  abandonTask(p, cooldown = 0) {
    const m = this.m, B = p.brain;
    if (B.task != null && cooldown) (B.skip ||= new Map()).set(B.task, m.time + cooldown);
    if (p.hold) m.releaseHold(p, 'silent', true);
    B.state = 'pick'; B.task = null; B.toolId = null; B.waitTool = 0; B.waitPartner = 0; B.fails = 0; B.goal = null; B.calledHelp = false;
  }

  /** Choose a task: cheapest total walk (tool detour included), only ones the bot can really perform. */
  pickTask(p) {
    const m = this.m, B = p.brain, real = m.dbg.botMode === 'human';
    const held = m.tasks.heldToolType(p);
    const opts = [];
    // Personal lists: a bot works ITS OWN assigned tasks first; only if it has none does it fall back to anything
    // interactable (covers the brief window before reassign() tops it up).
    const mine = [...m.tasks.active.values()].some(t => (t.assignedTo || []).includes(p.id) && (t.def.mech !== 'coop' || true));
    for (const t of m.tasks.active.values()) {
      if (real && !REAL_MECH.has(t.def.mech)) continue;
      if ((B.skip?.get(t.uid) ?? 0) > m.time) continue;
      if (this.isClaimed(t.uid, p)) continue;
      if (mine && !(t.assignedTo || []).includes(p.id)) continue;    // stick to my own list when I have one
      const pt = m.tasks.mainPoint(t);
      let cost = dist2(p.body, pt);
      const need = t.def.tool;
      if (need && held !== need) {
        const tool = m.tasks.nearestFreeTool(need, p.body);
        if (!tool) continue;                                   // every such tool is taken → pick something else
        cost = dist2(p.body, tool) + dist2(tool, pt) + 4;
      }
      if (t.def.mech === 'coop') cost += 6;                    // needs a partner: slightly less attractive
      opts.push({ t, cost });
    }
    opts.sort((x, y) => x.cost - y.cost);
    return pick(opts.slice(0, 3))?.t ?? null;
  }

  doTask(p, dt, input) {
    const m = this.m, B = p.brain, real = m.dbg.botMode === 'human';
    B.state ||= 'pick';
    let inst = B.task != null ? m.tasks.active.get(B.task) : null;
    if (B.state !== 'pick' && !inst) { this.abandonTask(p); return; }       // finished by someone else / removed

    if (B.state === 'pick') {
      const t = this.pickTask(p);
      if (!t) return;
      B.task = t.uid; B.state = 'tool'; B.goal = null; B.stuck = 0; B.fails = 0; B.t = rand(5, 9); B.progressAt = m.time; B.lastProg = -1;
      // hands: put back a tool we no longer need (the rack is where others look for it)
      const held = m.tasks.heldToolType(p);
      if (held && held !== t.def.tool) m.tasks.returnTool(p);
      return;
    }
    if (m.time - B.progressAt > 60) { this.abandonTask(p, 90); return; }        // nothing changed for a minute → give up on this one
    const prog = inst.rep * 10 + inst.progress; if (prog !== B.lastProg) { B.lastProg = prog; B.progressAt = m.time; }

    if (B.state === 'tool') {
      const need = inst.def.tool;
      if (!need || m.tasks.heldToolType(p) === need) { B.state = 'go'; B.goal = null; return; }
      let tool = B.toolId ? m.tasks.tools.get(B.toolId) : null;
      if (!tool || tool.heldBy || tool.type !== need) tool = m.tasks.nearestFreeTool(need, p.body);
      if (!tool) { B.waitTool = (B.waitTool || 0) + dt; if (B.waitTool > 6) this.abandonTask(p, 30); return; }
      B.toolId = tool.id; B.waitTool = 0;
      if (dist2(p.body, tool) < 1.6) {
        input.yaw = Math.atan2(-(tool.x - p.body.x), -(tool.z - p.body.z));
        m.tasks.use(p, 'tool:' + tool.id);
        if (m.tasks.heldToolType(p) !== need && ++B.fails > 10) this.abandonTask(p, 45);
      } else this.navTo(p, tool, dt, input);
      return;
    }

    // the tool is mandatory: if it is lost mid-task (dropped, ragdolled, taken) the bot goes back for it
    if (inst.def.tool && m.tasks.heldToolType(p) !== inst.def.tool) { if (p.hold) m.releaseHold(p, 'silent'); B.state = 'tool'; B.toolId = null; return; }

    if (B.state === 'go') {
      const tgt = real ? this.nextTarget(p, inst) : { pos: m.tasks.mainPoint(inst) };
      if (!tgt) return;
      if (dist2(p.body, tgt.pos) < USE_RANGE) { B.state = 'work'; B.goal = null; B.fails = 0; }
      else if (this.navTo(p, tgt.pos, dt, input) && dist2(p.body, tgt.pos) < 3.0) { B.state = 'work'; B.goal = null; }
      else if (B.stuck > 6) this.abandonTask(p, 60);
      return;
    }
    if (B.state === 'work') {
      if (real) this.workReal(p, inst, dt, input); else this.workAbstract(p, inst, dt, input);
    }
  }

  /** Roamer (fast test automaton): timer-based, but ONLY ticks while the required tool is in hand. */
  workAbstract(p, inst, dt, input) {
    const m = this.m, B = p.brain;
    p.botWorking = true;
    const pt = m.tasks.mainPoint(inst);
    input.yaw = Math.atan2(-(pt.x - p.body.x), -(pt.z - p.body.z));
    if (!m.tasks.botMayWork(p, inst)) { B.state = 'tool'; return; }
    B.t -= dt;
    if (B.t <= 0) { m.tasks.botComplete(p, inst); B.state = 'pick'; B.task = null; B.toolId = null; }
  }

  /** What the bot should walk to / interact with next for this task. {pos, kind:'use'|'item'|'runes', id} */
  nextTarget(p, inst) {
    const m = this.m, T = m.tasks, d = inst.def, pts = T.points(inst);
    const P = id => pts.find(q => q.id === `task:${inst.uid}:${id}`);
    switch (d.mech) {
      case 'hold': { const pt = pts[0]; return pt && { pos: pt, kind: 'use', id: pt.id }; }
      case 'runes': { const pt = pts[0]; return pt && { pos: pt, kind: 'runes', id: pt.id }; }
      case 'fetch': {
        let step = null;
        if (d.tool) { if (p.load && p.load.uid === inst.uid) step = p.load.step; }
        else { const it = T.items.get(p.heldItem); if (it && it.taskUid === inst.uid) step = it.step; }
        if (step != null) { const pt = P('s' + step); return pt && { pos: pt, kind: 'use', id: pt.id }; }
        if (!d.tool && d.srcs) {                                     // loose items lying around the room
          let best = null, bd = Infinity;
          for (const it of T.items.values()) if (it.taskUid === inst.uid && !it.heldBy && it.step === 0) { const dd = dist2(p.body, it); if (dd < bd) { bd = dd; best = it; } }
          return best && { pos: { x: best.x, z: best.z, y: best.y }, kind: 'item', id: 'item:' + best.id };
        }
        const pt = P('src'); return pt && { pos: pt, kind: 'use', id: pt.id };
      }
      case 'coop': {
        const taken = new Set(m.list.filter(q => q !== p && q.hold && q.hold.uid === inst.uid).map(q => q.hold.target));
        const free = pts.filter(q => !taken.has(q.id));
        free.sort((a, b) => dist2(p.body, a) - dist2(p.body, b));
        const pt = (p.hold && p.hold.uid === inst.uid ? pts.find(q => q.id === p.hold.target) : null) || free[0];
        return pt && { pos: pt, kind: 'use', id: pt.id };
      }
      case 'collect': { const pt = pts[0]; return pt && { pos: pt, kind: 'collect', id: pt.id }; }
      default: return null;
    }
  }

  /** Humanlike: perform the task exactly like a player — walk, interact, keep holding, repeat. */
  workReal(p, inst, dt, input) {
    const m = this.m, T = m.tasks, B = p.brain, d = inst.def;
    p.botWorking = !!p.hold;
    if (p.hold) {                                                  // holding [E] on something right now
      const pos = p.hold.pos;
      input.yaw = Math.atan2(-(pos.x - p.body.x), -(pos.z - p.body.z));
      if (d.mech === 'coop' && p.hold.need === Infinity) {         // waiting for a partner on the other handle
        B.waitPartner = (B.waitPartner || 0) + dt;
        if (!B.calledHelp && B.waitPartner > 1.5) { B.calledHelp = true; m.botChat.onNeedPartner(p, inst); }
        if (B.waitPartner > 24) this.abandonTask(p, 60);           // nobody came
      }
      return;
    }
    B.waitPartner = 0;
    if (d.mech === 'runes') {                                      // read the glowing wall rune, move the bookmark
      const tgt = this.nextTarget(p, inst); if (!tgt) return;
      if (dist2(p.body, tgt.pos) > USE_RANGE + 0.4) { B.state = 'go'; return; }
      input.yaw = Math.atan2(-(27 - p.body.x), -(8.3 - p.body.z));
      B.t -= dt;
      if (B.t <= 0) { T.answerRunes(p, inst.uid, inst.data.rune); B.t = rand(1.4, 2.4); }
      return;
    }
    // Minigame hold tasks (scrub) and the collect/sorting tasks: a bot "plays" them for a short beat at the station,
    // then finishes abstractly (bots never open the 2D overlay). botComplete still enforces the tool requirement.
    if (d.game || d.mech === 'collect') {
      const pt = m.tasks.mainPoint(inst);
      if (dist2(p.body, pt) > USE_RANGE + 0.5) { B.state = 'go'; B.goal = null; return; }
      input.yaw = Math.atan2(-(pt.x - p.body.x), -(pt.z - p.body.z));
      if (!m.tasks.botMayWork(p, inst)) { B.state = 'tool'; return; }      // scrub still needs its tool
      p.botWorking = true;
      B.t -= dt;
      if (B.t <= 0) { if (!m.tasks.botComplete(p, inst)) { B.t = rand(1, 2); } else { B.state = 'pick'; B.task = null; B.toolId = null; } }
      return;
    }
    const tgt = this.nextTarget(p, inst);
    if (!tgt) { B.state = 'go'; return; }
    if (dist2(p.body, tgt.pos) > USE_RANGE + 0.5) { B.state = 'go'; B.goal = null; return; }
    input.yaw = Math.atan2(-(tgt.pos.x - p.body.x), -(tgt.pos.z - p.body.z));
    const before = inst.rep * 10 + inst.progress;
    T.use(p, tgt.id);                                              // the server enforces tool / range / occupancy
    if (!p.hold && inst.rep * 10 + inst.progress === before && T.active.has(inst.uid) && ++B.fails > 8) {
      this.abandonTask(p, 45);                                     // refused repeatedly (e.g. wrong state) → try another task
    } else if (p.hold) B.fails = 0;
  }

  ceremony(p, dt, input) {
    const m = this.m, cer = m.cer, B = p.brain;
    p.botWorking = false;
    const key = `${m.ceremonyIndex}:${cer.sub}:${cer.mode}:${m.masterId}:${m.execId}`;
    if (B.cerKey !== key) { B.cerKey = key; B.decT = m.dbg.botMode === 'human' ? this.think() : rand(1.0, 2.4); B.done = false; B.victim = null; B.goal = null; B.liftAt = null; }
    B.decT -= dt;
    const ready = B.decT <= 0 && !B.done;
    const mode = m.dbg.botMode, human = mode === 'human';
    if (human) this.tryAbility(p, dt);
    if (cer.jailer?.pending && cer.jailer.id === p.id && ready) {        // Jailer: swap the captives if they look bad for our cult
      const bad = m.npcs.altar().filter(n => !human ? Math.random() < 0.5 : (p.faction === FACTIONS.CHAOS ? n.faction !== FACTIONS.CHAOS : n.faction !== p.faction)).length;
      cer.jailerReply(p, bad >= m.npcs.altar().length); B.done = true;
    }
    switch (cer.sub) {
      case CER.ELIMINATE:                                         // Simplified Mode: Master drops the WORST captive (for the bot's cult)
        if (p.id === m.masterId && ready) {
          const line = m.npcs.line();
          if (line.length) {
            for (const n of line) p.knownNpcs.add(n.id);
            const worst = Math.min(...line.map(n => this.captiveScore(p, n)));
            const n = human ? pick(line.filter(c => this.captiveScore(p, c) === worst)) : pick(line);
            cer.pullLever(p, n.id, { bot: true }); B.done = true;
          }
        }
        break;
      case CER.NOMINATE:
        if (p.id === m.masterId && ready) { const el = m.eligibleExec(); if (el.length) { cer.nominate((human ? this.mostTrusted(p, el) : pick(el)).id); B.done = true; } }
        break;
      case CER.VOTE:
        if (ready && cer.isVoter(p)) {
          let v;
          if (mode === 'idle') v = 0;
          else if (m.simple) v = human ? (this.wantsMutiny(p) ? 1 : 0) : (Math.random() < 0.3 ? 1 : 0);
          else if (human) v = this.wantsMutiny(p) ? Math.min(p.crystals, weighted([[1, 30], [2, 45], [3, 25]])) : 0;
          else v = weighted([[0, 74], [1, 19], [2, 7]]);
          cer.vote(p, m.simple ? v : Math.min(v, p.crystals)); B.done = true;
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
            if (B.victim !== n.id) { B.victim = n.id; if (human) { B.liftAt = m.time + this.think(0.6); m.botChat.onExecChoice(p, n); } }
            const near = this.navTo(p, { x: n.x, z: n.z + 1.0 }, dt, input) || dist2(p.body, n) < 2.2;
            if (near && (B.liftAt == null || m.time >= B.liftAt)) m.npcs.lmb(p, n.id);
          } else if (this.navTo(p, { x: 0, z: 3.4 }, dt, input) || dist2(p.body, PORTAL) < 4.6) m.npcs.lmbCarrying(p);
        }
        break;
      case CER.CURSE:
        if (!ready) break;
        if (cer.mode === 'eye' && p.id === cer.eyeHolder()) { const c = cer.slapCandidates(p.id); if (c.length) cer.eyeReveal(pick(c)); B.done = true; }
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
    if (m.simple) return false;                                // Simplified Mode: no Selection Chamber trip
    const key = `${m.ceremonyIndex}:${m.masterId}`;
    if (B.dutyKey !== key) { B.dutyKey = key; B.captive = null; B.dutyT = 0; B.grabFails = 0; B.gaveUp = false; B.pickAt = null; }
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
    if (B.dutyT > 45 + (human ? 2 * (m.dbg.botDecisionDelaySeconds ?? 2.25) : 0)) { B.gaveUp = true; return false; }       // never loop forever: the crypt auto-picks at the ceremony
    if (p.heldItem) m.tasks.dropItem(p);                       // lifting a captive needs free hands
    B.state = 'pick'; B.task = null;                           // abandon any half-done chore

    const inChamber = roomAt(p.body.x, p.body.z) === 'selection';
    let n = B.captive != null ? ch.find(c => c.id === B.captive) : null;
    if (!n && !inChamber) {                                    // enter
      this.navTo(p, { x: 0, z: -19.4 }, dt, input);
      return true;
    }
    if (!n) {                                                  // choose (once) — after looking the captives over
      if (human) {
        B.pickAt ??= m.time + this.think();
        if (m.time < B.pickAt) { const c = ch[Math.floor(m.time * 0.8) % ch.length]; input.yaw = Math.atan2(-(c.x - p.body.x), -(c.z - p.body.z)); return true; }
        B.pickAt = null;
      }
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
    const win = `${m.phase}:${cer.seq}`;
    if (B.abilWin !== win) { B.abilWin = win; B.abilT = 0.05; }       // a new window opened → look at the card right away
    B.abilT = (B.abilT ?? (2 + Math.random() * 4)) - dt;
    if (B.abilT > 0 || b.cardUsed || b.ghost) return;
    B.abilT = 1.5 + Math.random() * 2.5;
    if (!R.check(b).ok) return;
    const others = m.living.filter(q => q !== b);
    const enemy = l => this.leastTrusted(b, l), ally = l => this.mostTrusted(b, l);
    const valid = (f, l) => l.filter(q => R.validTarget(b, f, q));
    const want = m.phase === PHASE.CEREMONY && m.execId ? this.wantsMutiny(b) : null;
    const total = cer.total ? cer.total() : 0, th = cer.threshold;
    let t = null, copy = null;
    if (m.simple) {
      const pickT = (f, pref) => { const v = valid(f, m.list); return v.length ? (pref ? pref(v) : pick(v)).id : null; };
      const master = m.P(m.masterId), exec = m.P(m.execId);
      const duoFoe = this.trust(b, master) + this.trust(b, exec) < 0, duoFriend = this.trust(b, master) + this.trust(b, exec) > 0;
      const decide = id => {
        switch (id) {
          case 101: case 108: case 114: return want ? [] : null;
          case 104: return want && duoFoe ? [] : null;
          case 105: return want === false && duoFriend ? [] : null;
          case 102: { const x = pickT('voter', l => enemy(l.filter(q => q !== b).length ? l.filter(q => q !== b) : l)); return x != null && x !== b.id && Math.random() < 0.7 ? [x] : null; }   // cancel a likely opponent
          case 109: { const x = pickT('voter', enemy); return x != null && Math.random() < 0.6 ? [x] : null; }
          case 103: { const v = valid('eligible_exec_new', m.list).filter(q => this.trust(b, q) > 0); return v.length && this.trust(b, exec) <= 0 ? [ally(v).id] : null; }
          case 106: { const v = valid('exhausted', m.list).filter(q => this.trust(b, q) > 0); return v.length ? [v[0].id] : null; }
          case 107: { const v = valid('used_card', m.list).filter(q => this.trust(b, q) > 0); return v.length ? [v[0].id] : null; }
          case 110: { const v = valid('not_exhausted', others).filter(q => this.trust(b, q) < 0); return v.length && Math.random() < 0.5 ? [v[0].id] : null; }
          case 111: return Math.random() < 0.4 ? [b.faction === FACTIONS.CHAOS ? pickT('any') : b.id] : null;
          case 112: return Math.random() < 0.5 ? [] : null;
          default: return null;
        }
      };
      if (b.roleId === 113) {                                       // Mirror Mage: copy the first used card whose effect helps now
        for (const id of R.copyable(b)) { const tt = decide(id); if (tt && !tt.includes(null)) { t = tt; copy = id; break; } }
      } else { const tt = decide(b.roleId); if (tt && !tt.includes(null)) t = tt; }
    } else switch (b.roleId) {
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
    if (t) {
      if (m.dbg.botMode === 'human') {                              // Humanlike bots deliberate before revealing a card
        const sig = `${b.roleId}:${m.phase}:${cer.seq}:${t.join()}`;
        if (B.abilSig !== sig) { B.abilSig = sig; B.abilAt = m.time + this.think(); B.abilT = Math.max(0.05, B.abilAt - m.time); return; }
        if (m.time < B.abilAt) { B.abilT = Math.max(0.05, B.abilAt - m.time); return; }
        B.abilSig = null;
      }
      R.use(b, t, copy);
    }
  }
}
