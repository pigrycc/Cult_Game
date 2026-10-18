// Task minigames — Part B1 (scrub + collect) + per-curse spawn odds. Server-authoritative checks (no network).
import { Match } from '../src/server/Match.js';
import { PHASE, CURSE_KEYS, CURSES } from '../src/shared/constants.js';
import { TASKS, BOT_MECHS } from '../src/shared/tasks.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
function mk(n = 5) {
  const sent = [];
  const m = new Match({ send: (id, msg) => sent.push({ id, msg }) }); const ids = [];
  for (let i = 0; i < n; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  for (const id of ids) m.P(id).isBot = false;
  m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016); m.dbg.freezeRed = true;
  return { m, ids, P: i => m.P(ids[i]), sent };
}
const spawn = (m, key) => { m.dbg.maxConcurrent = 0; for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; return m.tasks.spawnTask(key); };
const put = (p, pt) => Object.assign(p.body, { x: pt.x, z: pt.z, y: 0 });

// ---- 1. catalogue additions
{ for (const k of ['candles', 'tablet', 'specimens', 'scrap']) ok(TASKS[k], `new task "${k}" exists`);
  for (const k of ['soot', 'glass', 'mop', 'tablet']) ok(TASKS[k].game === 'scrub', `"${k}" uses the scrub minigame`);
  ok(TASKS.tablet.tool === 'rag', 'Polish Runic Tablet needs the Rag');
  ok(['candles', 'specimens', 'scrap'].every(k => TASKS[k].mech === 'collect'), 'the three sorting tasks use the collect mechanic');
  ok(BOT_MECHS.has('collect'), 'bots can perform collect tasks (so bots-only games do not stall)'); }

// ---- 2. scrub opens a minigame and a reported success advances exactly one rep
{ const { m, P, sent } = mk(); const p = P(1); const t = spawn(m, 'soot');
  const br = [...m.tasks.tools.values()].find(x => x.type === 'broom'); br.heldBy = p.id; p.heldTool = br.id;
  const pt = m.tasks.points(t)[0]; put(p, pt);
  m.tasks.use(p, pt.id);
  const mg = sent.map(s => s.msg).find(x => x.t === 'minigame');
  ok(mg && mg.game === 'scrub' && mg.uid === t.uid && mg.cfg.threshold <= 1, 'E opens the scrub overlay (no plain hold)');
  ok(!p.hold, 'scrub does not start a timed hold');
  const rep0 = t.rep; t.data.gameAt = -10; m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]);
  ok(t.rep === rep0 + 1, 'a reported scrub success advances one rep'); }

// ---- 3. scrub is server-authoritative: wrong tool / out of range / too fast are rejected
{ const { m, P } = mk(); const p = P(1); const t = spawn(m, 'glass'); const pt = m.tasks.points(t)[0];
  put(p, pt); t.data.gameAt = -10;
  m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]); ok(t.rep === 0, 'no tool → scrub success ignored');
  const br = [...m.tasks.tools.values()].find(x => x.type === 'broom'); br.heldBy = p.id; p.heldTool = br.id;
  Object.assign(p.body, { x: pt.x + 50, z: pt.z }); m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]); ok(t.rep === 0, 'out of range → ignored');
  put(p, pt); t.data.gameAt = m.time; m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]); ok(t.rep === 0, 'finished too fast (<0.6 s) → ignored');
  t.data.gameAt = m.time - 1; m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]); ok(t.rep === 1, 'valid scrub → accepted'); }

// ---- 4. collect: take at source, place on each slot, completes after all reps
{ const { m, P } = mk(); const p = P(2); const t = spawn(m, 'candles');
  const src = m.tasks.points(t).find(x => x.collectSrc); put(p, src);
  m.tasks.use(p, src.id);
  ok(p.heldItem && t.data.carrier === p.id, 'picked up a candle at the supply crate (carrier locked)');
  // only one carrier at a time
  const q = P(3); put(q, src); m.tasks.use(q, src.id); ok(!q.heldItem, 'a second player cannot grab a candle while one is carried');
  const reps = TASKS.candles.reps;
  for (let i = 0; i < reps; i++) {
    const slot = m.tasks.points(t).find(x => x.slot != null); put(p, slot);
    m.tasks.use(p, slot.id);
    if (i < reps - 1) { const s2 = m.tasks.points(t).find(x => x.collectSrc); put(p, s2); m.tasks.use(p, s2.id); }
  }
  ok(!m.tasks.active.has(t.uid), `collect completes after ${reps} placements`); }

// ---- 5. collect self-heals: dropping the carried item frees the slot and the source returns
{ const { m, P } = mk(); const p = P(1); const t = spawn(m, 'specimens');
  const src = m.tasks.points(t).find(x => x.collectSrc); put(p, src); m.tasks.use(p, src.id);
  ok(t.data.carrier === p.id, 'carrying a specimen');
  m.tasks.dropItem(p);
  ok(t.data.carrier == null && !p.heldItem, 'dropping it frees the carrier');
  ok(m.tasks.points(t).some(x => x.collectSrc), 'the supply source is available again'); }

// ---- 6. per-curse spawn odds (debug): weight 0 excludes, high weight dominates, uniform clears
{ const { m, P } = mk(); const h = P(0);
  m.debug.run(h, 'curse_weights', { on: true, weights: { TOXIC_FUMES: 15, GAGGING_SEAL: 0, MANA_BOOST: 1, MANA_DRAIN: 1, EYE_OF_TRUTH: 1 } });
  const pool = ['MANA_BOOST', 'MANA_DRAIN', 'TOXIC_FUMES', 'EYE_OF_TRUTH', 'GAGGING_SEAL'];
  const tally = {}; for (let i = 0; i < 4000; i++) { const c = m.npcs.rollCurse(pool); tally[c] = (tally[c] || 0) + 1; }
  ok(!tally.GAGGING_SEAL, 'a curse weighted 0 never spawns');
  ok(tally.TOXIC_FUMES > tally.MANA_BOOST * 4, `a high-weighted curse dominates (fumes ${tally.TOXIC_FUMES} vs boost ${tally.MANA_BOOST})`);
  ok(Object.keys(tally).length === 4, 'the other weighted curses still appear');
  m.debug.run(h, 'curse_weights', { on: false });
  ok(m.dbg.curseWeights === null, '"Uniform" clears the override');
  const t2 = {}; for (let i = 0; i < 2000; i++) { const c = m.npcs.rollCurse(pool); t2[c] = (t2[c] || 0) + 1; }
  ok(Object.keys(t2).length === pool.length, 'uniform again includes every pool curse'); }

// ---- 7. all-zero weights fall back to uniform (a captive always gets a valid glyph)
{ const { m, P } = mk(); const h = P(0);
  m.debug.run(h, 'curse_weights', { on: true, weights: Object.fromEntries(CURSE_KEYS.map(k => [k, 0])) });
  const pool = ['MANA_BOOST', 'MANA_DRAIN', 'TOXIC_FUMES'];
  const got = new Set(); for (let i = 0; i < 300; i++) got.add(m.npcs.rollCurse(pool));
  ok([...got].every(c => pool.includes(c)) && got.size >= 2, 'all-zero weights → uniform fallback (still a valid glyph)'); }

// ---- 8. bots-only Humanlike matches still finish with the new tasks in the pool
{ for (const n of [5, 7, 9]) {
  const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id; m.bots.spawn(n - 1);
  Object.assign(m.dbg, { botMode: 'human' });
  m.timers.revealBack = m.timers.revealFront = 0.5; m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  let t = 0; while (t < 30 * 60 && m.phase !== PHASE.FINALE) { m.tick(0.05); t += 0.05; }
  ok(m.phase === PHASE.FINALE && t / 60 <= 18, `${n} Humanlike bots finish with scrub/collect tasks present (${(t / 60).toFixed(1)} min)`);
} }

// ================================================================= B2 minigames
// ---- 9. every B2 game type: catalogue mapping + gameCfg returns valid config
{ const expect = { oil: 'derust', forge: 'whack', chop: 'whack', sharpen: 'grind', distill: 'mix', flush: 'simon', lamps: 'pour', chute: 'plunge', drain: 'catch', gauges: 'gauges' };
  for (const [k, g] of Object.entries(expect)) ok(TASKS[k] && TASKS[k].game === g, `"${k}" uses the ${g} minigame`);
  for (const k of ['gauges', 'sharpen', 'chop']) ok(TASKS[k], `new task "${k}" exists`); }
{ const { m } = mk();
  const cfgOf = key => m.tasks.gameCfg(TASKS[key]);
  ok(cfgOf('drain').quota > 0, 'catch cfg has a drip quota');
  ok(Array.isArray(cfgOf('oil').rusty) && cfgOf('oil').rusty.length >= 3, 'derust cfg lists ≥3 rusted gears');
  ok(cfgOf('forge').hits > 0, 'whack cfg has a hit count');
  ok(cfgOf('sharpen').sweetHi > cfgOf('sharpen').sweetLo, 'grind cfg has a valid sweet-spot band');
  ok(Array.isArray(cfgOf('distill').recipe) && cfgOf('distill').recipe.length === 3, 'mix cfg has a 3-pour recipe');
  ok(Array.isArray(cfgOf('flush').seq) && cfgOf('flush').seq.length === 3 && cfgOf('flush').seq.every(i => i >= 0 && i < 8), 'simon cfg has a valid 3-step sequence');
  ok(cfgOf('lamps').sweetHi > cfgOf('lamps').sweetLo, 'pour cfg has a sweet-spot band');
  ok(cfgOf('chute').plunges > 0, 'plunge cfg has a plunge count');
  ok(cfgOf('gauges').gauges > 0, 'gauges cfg has a gauge count'); }

// ---- 10. each B2 game opens its overlay on E and a reported success advances/completes it (server-authoritative)
{ const toolFor = { oil: 'oilcan', forge: 'hammer', chop: 'cleaver', sharpen: 'dullblade', chute: 'gaff', drain: 'bucket' };
  for (const key of ['oil', 'forge', 'chop', 'sharpen', 'distill', 'flush', 'lamps', 'chute', 'drain', 'gauges']) {
    const { m, P, sent } = mk(); const p = P(1); const t = spawn(m, key);
    const need = TASKS[key].tool;
    if (need) { const tool = [...m.tasks.tools.values()].find(x => x.type === need); tool.heldBy = p.id; p.heldTool = tool.id; }
    const pt = m.tasks.points(t)[0]; put(p, pt);
    sent.length = 0; m.tasks.use(p, pt.id);
    const mg = sent.map(s => s.msg).find(x => x.t === 'minigame');
    ok(mg && mg.game === TASKS[key].game && mg.uid === t.uid, `${key}: E opens the ${TASKS[key].game} overlay`);
    ok(!p.hold, `${key}: no plain timed hold is started`);
    t.data.gameAt = -10; m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]);
    ok(!m.tasks.active.has(t.uid), `${key}: a reported success completes the task`);
  }
}

// ---- 11. new tools exist and spawn in the world
{ const { m } = mk();
  for (const type of ['bucket', 'dullblade', 'cleaver', 'rag']) {
    const sp = [...m.tasks.tools.values()].find(x => x.type === type);
    ok(sp, `tool "${type}" spawns in the world`);
  } }

// ---- 12. Bookshelf Ladder is now a (tool-less) stacking co-op; it still completes with a rider
{ const { m, P } = mk(); const t = spawn(m, 'ladder');
  ok(TASKS.ladder.mech === 'stack' && !TASKS.ladder.tool, 'Bookshelf Ladder is a tool-less stacking task');
  const bottom = P(1), top = P(2); const pt = m.tasks.points(t)[0];
  put(bottom, pt); put(top, pt); top.ridingOn = bottom.id;        // top minion stands on the bottom one
  m.tasks.use(top, pt.id);
  ok(top.hold && top.hold.uid === t.uid, 'the top minion can hold the high ladder spot');
  // drive the hold to completion
  top.holdT = top.hold.need; m.tasks.tick(0.05);
  ok(!m.tasks.active.has(t.uid), 'the ladder completes once the stacked hold finishes'); }

// ---- 13. a tool minigame is refused without the tool (server stays authoritative)
{ const { m, P, sent } = mk(); const p = P(1); const t = spawn(m, 'oil');   // needs the oil can
  const pt = m.tasks.points(t)[0]; put(p, pt);
  sent.length = 0; m.tasks.use(p, pt.id);
  ok(!sent.some(s => s.msg.t === 'minigame'), 'derust overlay does NOT open without the oil can');
  t.data.gameAt = -10; m.tasks.minigameDone(p, t.uid, pt.id.split(':')[2]);
  ok(m.tasks.active.has(t.uid), 'a success report without the tool is rejected'); }

// ---- 14. bots-only matches still finish with the full B2 catalogue (classic + Simplified)
{ for (const simple of [false, true]) {
  const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id; m.bots.spawn(6);
  Object.assign(m.dbg, { botMode: 'human', simplified: simple });
  m.timers.revealBack = m.timers.revealFront = 0.5; m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  let t = 0; while (t < 40 * 60 && m.phase !== PHASE.FINALE) { m.tick(0.05); t += 0.05; }
  ok(m.phase === PHASE.FINALE && t / 60 <= 20, `${simple ? 'Simplified' : 'classic'} 7-bot match finishes with B2 tasks (${(t / 60).toFixed(1)} min)`);
} }

console.log(fails ? `\n${fails} FAILED` : '\nMINIGAME (B1+B2) + CURSE-ODDS TESTS PASSED');
process.exit(fails ? 1 : 0);
