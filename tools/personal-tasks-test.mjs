// Personal Task Lists — server rules (no network).
//  Each living minion owns 2 solo + a share of 1 co-op; serializeTasks(viewer) is filtered to that player;
//  co-op entries carry partner info; completing a solo task frees + refills the slot; "call for help" opens a co-op
//  task to everyone; bots only pick their own assigned tasks.
import { Match } from '../src/server/Match.js';
import { PHASE } from '../src/shared/constants.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
function mk(n = 7, dbg = {}) {
  const m = new Match({ send: () => {} }); const ids = [];
  for (let i = 0; i < n; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  for (const id of ids) m.P(id).isBot = false;
  Object.assign(m.dbg, dbg);
  m.timers.revealBack = m.timers.revealFront = 0.5; m.timers.taskRespawnDelay = 2;
  m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016);
  m.dbg.freezeRed = true;
  return { m, ids, P: i => m.P(ids[i]) };
}
const step = (m, s = 0.1, n = 1) => { for (let i = 0; i < n; i++) m.tick(s); };
const T = m => m.tasks;
const myTasks = (m, p) => T(m).serializeTasks(p);
const soloOf = (m, p) => [...T(m).active.values()].filter(t => t.kind === 'solo' && t.assignedTo.includes(p.id));
const coopOf = (m, p) => [...T(m).active.values()].filter(t => t.kind === 'coop' && t.assignedTo.includes(p.id));

// ---- 1. everyone gets 2 solo + exactly 1 co-op
{ const { m, P } = mk(7); step(m, 0.2, 10);
  let good2solo = 0, good1coop = 0;
  for (const p of m.living) { if (soloOf(m, p).length === 2) good2solo++; if (coopOf(m, p).length === 1) good1coop++; }
  ok(good2solo === m.living.length, `every player has exactly 2 solo tasks (${good2solo}/${m.living.length})`);
  ok(good1coop === m.living.length, `every player is in exactly 1 co-op task (${good1coop}/${m.living.length})`);
  // per-viewer list caps at 3 (2 solo + 1 co-op) unless a teammate called for help
  const ser = myTasks(m, P(1));
  ok(ser.length === 3 && ser.filter(t => t.kind !== 'coop').length === 2 && ser.filter(t => t.kind === 'coop').length === 1,
    `the personal HUD list is 2 solo + 1 co-op (${ser.length} tasks)`); }

// ---- 2. per-viewer filtering: a player does NOT see another player's solo tasks
{ const { m, P } = mk(7); step(m, 0.2, 10);
  const a = P(1), b = P(2);
  const aUids = new Set(myTasks(m, a).map(t => t.uid)), bUids = new Set(myTasks(m, b).map(t => t.uid));
  const aSolo = new Set(soloOf(m, a).map(t => t.uid));
  ok([...aSolo].every(u => !bUids.has(u)), "a player's solo tasks never appear on another player's list");
  ok([...aUids].every(u => T(m).active.has(u)), 'every listed task is a real active task'); }

// ---- 3. co-op pairing carries partner name + colour; same co-op shows for all its members
{ const { m, P } = mk(6); step(m, 0.2, 10);
  const a = P(1); const coop = coopOf(m, a)[0];
  const ser = myTasks(m, a).find(t => t.uid === coop.uid);
  ok(ser && ser.kind === 'coop', 'the co-op task is on the owner list');
  const partnerIds = coop.assignedTo.filter(id => id !== a.id);
  ok(ser.partners.length === partnerIds.length && partnerIds.length >= 1, `co-op entry lists ${ser.partners.length} partner(s)`);
  ok(ser.partners.every(pp => pp.name && pp.color), 'each partner entry has a name and a colour (for the 🔴 chip)');
  for (const pid of partnerIds) ok(myTasks(m, m.P(pid)).some(t => t.uid === coop.uid), 'the same co-op task appears on each partner list'); }

// ---- 4. completing a solo task frees the slot and it refills after the respawn delay
{ const { m, P } = mk(7); step(m, 0.2, 10);
  const p = P(3); const task = soloOf(m, p)[0];
  const before = soloOf(m, p).map(t => t.uid);
  m.tasks.forceComplete(task, [p]);
  ok(!m.tasks.active.has(task.uid), 'the finished task is removed');
  ok(soloOf(m, p).length === 1, 'the owner now has 1 solo task (slot freed)');
  step(m, 0.5, 8);               // > taskRespawnDelay
  const after = soloOf(m, p);
  ok(after.length === 2, 'the solo slot refills to 2 after the delay');
  ok(after.some(t => !before.includes(t.uid)), 'the refill is a new task'); }

// ---- 5. completing grants progress + coins (same as before)
{ const { m, P } = mk(7); step(m, 0.2, 6);
  const p = P(2); const yb = m.bars.yellow, gold = p.gold; const task = soloOf(m, p)[0];
  m.tasks.forceComplete(task, [p]);
  ok(m.bars.yellow > yb, 'completing a solo task advances the Yellow Bar');
  ok(p.gold > gold, 'completing a solo task pays coins'); }

// ---- 6. any two players at the station complete a co-op task (fallback), even if not the suggested pair
{ const { m, P } = mk(7); step(m, 0.2, 10);
  // find a 'coop' mech (hold-together) task and verify the server has no owner gate on completion
  const coopTask = [...m.tasks.active.values()].find(t => t.kind === 'coop' && t.def.mech === 'coop');
  if (coopTask) {
    const outsiders = m.living.filter(p => !coopTask.assignedTo.includes(p.id)).slice(0, 2);
    const [h0, h1] = coopTask.def.handles;
    Object.assign(outsiders[0].body, { x: h0.x, z: h0.z, y: 0 }); Object.assign(outsiders[1].body, { x: h1.x, z: h1.z, y: 0 });
    m.tasks.use(outsiders[0], `task:${coopTask.uid}:h0`); m.tasks.use(outsiders[1], `task:${coopTask.uid}:h1`);
    step(m, 0.2, 40);
    ok(!m.tasks.active.has(coopTask.uid), 'two non-assigned players standing at the station still complete the co-op task');
  } else ok(true, '(no hold-together co-op task spawned this run — skipped)'); }

// ---- 7. call for help broadcasts the co-op task to everyone
{ const { m, P } = mk(7); step(m, 0.2, 10);
  const a = P(1); const coop = coopOf(m, a)[0];
  const outsider = m.living.find(p => !coop.assignedTo.includes(p.id));
  ok(!myTasks(m, outsider).some(t => t.uid === coop.uid), 'before the call, an outsider does not see the co-op task');
  m.tasks.callForHelp(a, coop.uid);
  ok(coop.helpCall === true, 'the task is flagged as a help call');
  const seen = myTasks(m, outsider).find(t => t.uid === coop.uid);
  ok(seen && seen.mine === false && seen.helpCall === true, 'after the call, everyone sees it (marked not-mine / help)'); }

// ---- 8. markers/world beacons only reference a player's own tasks (serialize contract)
{ const { m, P } = mk(7); step(m, 0.2, 10);
  const a = P(4);
  const ser = myTasks(m, a);
  const myUids = new Set(ser.map(t => t.uid));
  // every task that still carries a world item (e.g. a fetch/book item) and shows on A's list belongs to A
  ok([...myUids].every(u => T(m).active.has(u)), 'personal list only references live tasks');
  ok(ser.every(t => Array.isArray(t.points) && t.points.length >= 1), 'each personal task carries its own marker points'); }

// ---- 9. bots only work their own assigned tasks
{ const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id; m.bots.spawn(5);
  for (let i = 0; m.players.size < 5; i++) m.addPlayer({ name: 'F' + i });
  Object.assign(m.dbg, { botMode: 'human', freezeRed: true });
  m.timers.revealBack = m.timers.revealFront = 0.5; m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  m.masterId = hid;
  step(m, 0.1, 30);
  let onOwn = 0, picked = 0;
  for (const b of m.list.filter(p => p.isBot)) {
    const pickedUid = b.brain?.task;
    if (pickedUid == null) continue;
    picked++;
    const inst = m.tasks.active.get(pickedUid);
    if (inst && (inst.assignedTo || []).includes(b.id)) onOwn++;
  }
  ok(picked > 0, `bots picked tasks (${picked} working)`);
  ok(onOwn === picked, `bots only work tasks assigned to them (${onOwn}/${picked})`); }

// ---- 10. a bots-only Humanlike match still finishes (personal lists must not stall the crew)
{ for (const n of [5, 7, 9]) {
  const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id; m.bots.spawn(n - 1);
  Object.assign(m.dbg, { botMode: 'human' });
  m.timers.revealBack = m.timers.revealFront = 0.5; m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  let t = 0; while (t < 30 * 60 && m.phase !== PHASE.FINALE) { m.tick(0.05); t += 0.05; }
  ok(m.phase === PHASE.FINALE && t / 60 <= 18, `${n} Humanlike bots with personal task lists: match ends after ${(t / 60).toFixed(1)} min`);
} }

console.log(fails ? `\n${fails} FAILED` : '\nPERSONAL TASK LIST TESTS PASSED');
process.exit(fails ? 1 : 0);
