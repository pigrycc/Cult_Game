// Regression test: a Humanlike (or any) bot that is Master of Ceremonies must walk into the
// Selection Chamber, pick captives and carry TWO of them to the altar without circling.
// node tools/bot-master-test.mjs
import { Match } from '../src/server/Match.js';
import { PHASE } from '../src/shared/constants.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function setup(mode, { holdItem = false, seed = 0 } = {}) {
  const m = new Match({ send: () => {} });
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0, isBot: i > 0 }).id);
  m.list.forEach(p => { if (p.isBot) m.bots.adopt(p); });
  m.dbg.botMode = mode; m.dbg.freezeRed = true;
  m.timers.revealBack = m.timers.revealFront = 0.5;
  m.startGame(ids[0]);
  m.phaseT = 0; m.tick(0.016);
  // the host is human-idle; make a bot the Master
  const bot = m.list.find(p => p.isBot);
  m.masterId = bot.id;
  if (holdItem) { const it = m.tasks.makeItem('skull', bot.body.x, 0.6, bot.body.z); it.heldBy = bot.id; bot.heldItem = it.id; }
  return { m, bot };
}

function run(m, bot, maxSec = 120) {
  let t = 0, targetChanges = 0, last = null, maxAltar = 0, firstAltarAt = null, headingFlips = 0, lastHeading = null;
  while (t < maxSec && m.phase === PHASE.WORK) {
    m.tick(0.05); t += 0.05;
    const tgt = bot.brain?.captive ?? null;
    if (tgt !== last) { if (last !== null && tgt !== null) targetChanges++; last = tgt; }
    const a = m.npcs.altar().length; maxAltar = Math.max(maxAltar, a);
    if (a >= 2) { firstAltarAt = t; break; }
  }
  return { t, maxAltar, targetChanges, done: maxAltar >= 2 };
}

for (const mode of ['human', 'roamer']) {
  for (let i = 0; i < 6; i++) {
    const { m, bot } = setup(mode);
    const r = run(m, bot);
    ok(r.done, `${mode} Master bot #${i} puts 2 captives on the altar (${r.t.toFixed(1)}s)`);
  }
}
{ const { m, bot } = setup('human', { holdItem: true }); const r = run(m, bot); ok(r.done, 'Master bot that was holding an item still fetches captives'); }
// the chosen captive must stay stable once the bot is inside the chamber
{ const { m, bot } = setup('human'); let flips = 0, prev = null;
  for (let i = 0; i < 2400 && m.npcs.altar().length < 1; i++) { m.tick(0.05); const c = bot.brain?.captive; if (c != null && prev != null && c !== prev) flips++; if (c != null) prev = c; }
  ok(flips === 0, `captive choice is sticky (flips: ${flips})`); }
// the ceremony must still advance after the Master delivered both captives
{ const { m, bot } = setup('human'); run(m, bot); m.bars.fillToNext();
  for (let i = 0; i < 400 && m.phase === PHASE.WORK; i++) m.tick(0.05);
  ok(m.phase === PHASE.CEREMONY, 'ceremony starts after delivery'); }

console.log(fails ? `\n${fails} FAILED` : '\nBOT MASTER TESTS PASSED');
process.exit(fails ? 1 : 0);
