// Round-3 UX features, server side: task colours, tool auto-drop, Main Hall delivery, destabilisation=Chaos win, verbose role-reveal log.
import { Match } from '../src/server/Match.js';
import { PHASE } from '../src/shared/constants.js';
import { TASK_COLORS, TASKS } from '../src/shared/tasks.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
function mk(n = 7) {
  const m = new Match({ send: () => {} }); const ids = [];
  for (let i = 0; i < n; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  for (const id of ids) m.P(id).isBot = false;
  m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016);
  return { m, ids, P: i => m.P(ids[i]) };
}
const T0 = (m) => { m.dbg.maxConcurrent = 0; for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; };

// ---- 1. one distinct colour per active task, exposed to clients
{ const { m } = mk(5); m.dbg.maxConcurrent = 5; for (let i = 0; i < 40; i++) m.tick(0.5);   // small board that fits the palette
  const ser = m.tasks.serializeTasks();          // viewer omitted → whole board (used only to inspect colours here)
  ok(ser.length >= 4 && ser.every(t => Number.isInteger(t.color) && t.color >= 0 && t.color < TASK_COLORS), `every active task carries a palette colour (${ser.length} tasks)`);
  ok(new Set(ser.map(t => t.color)).size === ser.length, 'no two active tasks share a colour while the board fits the 12-colour palette');
  ok(ser.every(t => t.points.length >= 1), 'each task exposes its marker points (all share the task colour on the client)');
  ok(ser.filter(t => TASKS[t.key].tool).every(t => t.tool === TASKS[t.key].tool), 'tasks that need a tool say which one (for the tool beacon)');
  const items = m.tasks.serializeWorld().items; ok(items.every(i => 'task' in i), 'world items say which task they belong to (book beacon)');
  const c0 = ser[0].color; m.tasks.removeTask(m.tasks.active.get(ser[0].uid)); m.tasks.reassign();
  ok(new Set([...m.tasks.active.values()].map(t => t.color)).size === m.tasks.active.size, 'a replacement task never reuses a colour that is still on the board'); }
// a packed 11-player board must serialize cleanly with valid palette indices (unique while it fits, repeating past that)
{ const { m } = mk(11); for (let i = 0; i < 40; i++) m.tick(0.5);
  const ser = m.tasks.serializeTasks();
  ok(ser.length >= 12 && ser.every(t => Number.isInteger(t.color) && t.color >= 0 && t.color < TASK_COLORS), `a large board (${ser.length} tasks) serializes with valid palette colours`);
  if (ser.length <= TASK_COLORS) ok(new Set(ser.map(t => t.color)).size === ser.length, `…and colours stay unique while within the ${TASK_COLORS}-colour palette`); }

// ---- 2. tool is put down when the job is done
{ const { m, P } = mk(); T0(m);
  const inst = m.tasks.spawnTask('soot'); const p = P(1); const br = m.tasks.tools.get('broom1');
  br.heldBy = p.id; p.heldTool = br.id; Object.assign(p.body, { x: 3, z: 3, y: 0 });
  m.tasks.forceComplete(inst, [p]);
  ok(p.heldTool === null && br.heldBy === null, 'finishing the task drops the tool');
  ok(Math.hypot(br.x - 3, br.z - 3) < 1, 'the tool is left where the player stood (free to be picked up)');
  const inst2 = m.tasks.spawnTask('glass'); const wr = m.tasks.tools.get('wrench1'); wr.heldBy = p.id; p.heldTool = wr.id;
  m.tasks.forceComplete(inst2, [p]);
  ok(p.heldTool === wr.id, 'a tool that has nothing to do with the finished task is kept');
  const coal = m.tasks.spawnTask('coal'); const sh = m.tasks.tools.get('shovel1'); sh.heldBy = p.id; p.heldTool = sh.id; p.load = { type: 'coal', uid: coal.uid, step: 1 };
  m.tasks.forceComplete(coal, [p]); ok(p.heldTool !== sh.id && !p.load, 'shovel (and its load) are dropped after the coal delivery'); }

// ---- 3. captive delivery: anywhere in the Main Hall registers
{ const { m, P } = mk(); const master = P(m.list.findIndex(q => q.id === m.masterId));
  const grab = () => { const n = m.npcs.chamber()[0]; n.state = 'carried'; n.carrier = master.id; master.carryingNpc = n.id; return n; };
  const before = m.npcs.altar().length;
  let n = grab(); Object.assign(master.body, { x: -7.5, z: -6.5, y: 0 });         // inside the hall, FAR from the portal trigger (> 7 m)
  ok(Math.hypot(master.body.x, master.body.z) < 11, 'test spot is inside the hall');
  m.npcs.lmbCarrying(master);
  ok(n.state === 'altar' && m.npcs.altar().length === before + 1 && !master.carryingNpc, 'LMB anywhere in the Main Hall delivers the captive');
  n = grab(); Object.assign(master.body, { x: 8, z: 7, y: 0 }); m.npcs.dropCarried(master, false);
  ok(n.state === 'altar', 'plain DROP (Q) inside the hall also delivers it');
  const { m: m2, P: P2 } = mk(); const ms = P2(m2.list.findIndex(q => q.id === m2.masterId)); const n2 = m2.npcs.chamber()[0];
  n2.state = 'carried'; n2.carrier = ms.id; ms.carryingNpc = n2.id; Object.assign(ms.body, { x: 30, z: 0, y: 0 }); m2.npcs.lmbCarrying(ms);
  ok(n2.state === 'ground', 'outside the hall the captive is just put down, not delivered'); }

// ---- 4. debug: destabilisation = Chaos victory
{ const { m } = mk(); m.bars.red = m.bars.next - 0.0001; m.tick(2);
  ok(m.phase === PHASE.FINALE && m.winner === 'nobody', 'default: Red Bar first → everyone loses');
  const { m: c, P } = mk(); c.debug.run(P(0), 'chaos_on_explode', { on: true });
  ok(c.dbg.destabilizationTriggersChaosWin === true && c.debug.serialize().destabilizationTriggersChaosWin === true, 'toggle is stored and sent to the debug menu');
  c.bars.red = c.bars.next - 0.0001; c.tick(2);
  ok(c.phase === PHASE.FINALE && c.winner === 'chaos', 'enabled: Red Bar first → Cult of Chaos wins');
  const { m: r, P: Pr } = mk(); r.debug.run(Pr(0), 'chaos_on_explode', { on: true }); r.debug.run(Pr(0), 'reset_overrides', {});
  ok(r.dbg.destabilizationTriggersChaosWin === false, '"Reset to normal" switches it back off'); }

// ---- 5. verbose role-reveal log: description first, then how/on whom
{ const { m, P } = mk(); const a = P(1), b = P(2); a.roleId = 1; a.cardUsed = false; b.crystals = 3; const before = m.publicLog.length;
  Object.assign(a.body, { x: 0, z: 0, y: 0 }); Object.assign(b.body, { x: 1, z: 0, y: 0 });
  m.roles.use(a, [b.id]);
  const L = m.publicLog.slice(before);
  ok(L.length === 2 && L[0].kind === 'role' && /Mana Thief/.test(L[0].text) && /steal 1 Mana Crystal/.test(L[0].text), `first line explains the ability: "${L[0]?.text.slice(0, 60)}…"`);
  ok(L[1].kind === 'ability' && L[1].text.includes(a.name) && L[1].text.includes(b.name) && /stole a Mana Crystal/.test(L[1].text), `second line says how/on whom: "${L[1]?.text}"`);
  ok(L[1].n === L[0].n + 1, 'log ids are consecutive and monotonic');
  const c = P(3); c.roleId = 5; c.cardUsed = false; const k = m.publicLog.length; m.roles.use(c, []);
  const L2 = m.publicLog.slice(k); ok(L2.length === 2 && /2 Mana Crystals/.test(L2[1].text), 'an untargeted ability is logged too: ' + L2[1]?.text); }

console.log(fails ? `\n${fails} FAILED` : '\nUX ROUND-3 TESTS PASSED');
process.exit(fails ? 1 : 0);
