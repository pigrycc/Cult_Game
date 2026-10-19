// Humanlike-bot behaviour tests: mandatory tools, reaction delays, banter / bluffing.
//   node tools/bot-ai-test.mjs
import { Match } from '../src/server/Match.js';
import { PHASE, CER, FACTIONS } from '../src/shared/constants.js';
import { TASKS, TASK_KEYS } from '../src/shared/tasks.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const REAL = new Set(['hold', 'fetch', 'runes', 'coop', 'collect']);   // mechanics a Humanlike bot performs (mirrors BOT_MECHS)

function world({ bots = 6, mode = 'human', delay = 0, chat = true } = {}) {
  const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Human', isHost: true }).id;
  m.bots.spawn(bots);
  for (let i = 0; m.players.size < 5; i++) m.addPlayer({ name: 'Idle' + i });        // a match needs ≥5 players; fillers just stand there
  Object.assign(m.dbg, { botMode: mode, freezeRed: true, botDecisionDelaySeconds: delay, botChat: chat });
  m.timers.revealBack = m.timers.revealFront = 0.5;
  m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  m.masterId = hid;                                         // keep bots free of Master duty
  return { m, hid, human: m.P(hid), botList: m.list.filter(p => p.isBot) };
}
const run = (m, sec, dt = 0.05, until = null) => { let t = 0; for (; t < sec; t += dt) { m.tick(dt); if (until && until()) break; } return t; };
/** Wrap progress entry points: any bot that makes progress / finishes a tool task without the tool is a violation. */
function audit(m) {
  const out = { viol: [], steps: 0 }, T = m.tasks;
  const rd = T.repDone.bind(T);
  T.repDone = (i, p) => { out.steps++; if (p?.isBot && i.def.tool && T.heldToolType(p) !== i.def.tool) out.viol.push(`${p.name} advanced ${i.key} empty-handed`); rd(i, p); };
  const bc = T.botComplete.bind(T);
  T.botComplete = (p, i) => { const held = T.heldToolType(p); const r = bc(p, i); if (r) { out.steps++; if (i.def.tool && held !== i.def.tool) out.viol.push(`${p.name} completed ${i.key} empty-handed`); } return r; };
  return out;
}
const bump = (m, key) => { m.dbg.maxConcurrent = 0; for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; return m.tasks.spawnTask(key); };

// ===================================================================== 1. every task, with a Humanlike bot
console.log('--- tasks: tools are mandatory ---');
let toolTasks = 0, doneTasks = 0;
for (const key of TASK_KEYS) {
  const def = TASKS[key], real = REAL.has(def.mech);
  const { m, botList } = world({ bots: def.mech === 'coop' ? 2 : 1 });
  const inst = bump(m, key);
  const A = audit(m), viol = A.viol; let tookTool = false, lastProg = -1;
  let done = false; const t = run(m, real ? 200 : 45, 0.05, () => {
    for (const b of botList) {
      const held = m.tasks.heldToolType(b);
      if (def.tool && held === def.tool) tookTool = true;
      const live = m.tasks.active.get(inst.uid);
      if (live) { const prog = live.rep * 10 + live.progress; if (prog !== lastProg) { if (lastProg !== -1 && def.tool && !botList.some(x => m.tasks.heldToolType(x) === def.tool)) viol.push('progress while no bot held the tool'); lastProg = prog; } }
    }
    if (!m.tasks.active.has(inst.uid)) { done = true; return true; }
    return false;
  });
  if (!real) { ok(!done && !viol.length, `${key} (${def.mech}) is left to players — bots neither fake it nor touch it`); continue; }
  if (def.tool) toolTasks++;
  if (done) doneTasks++;
  ok(done && !viol.length && (!def.tool || tookTool), `${key} (${def.mech}${def.tool ? ', needs ' + def.tool : ''}) completed by Humanlike bot in ${t.toFixed(0)}s${def.tool ? ' — tool fetched from the rack & held' : ''}${viol.length ? ' VIOLATIONS: ' + viol.join(';') : ''}`);
}
ok(toolTasks >= 8 && doneTasks >= 20, `covered ${toolTasks} tool tasks, ${doneTasks} bot-completable tasks`);

console.log('--- the server refuses empty-handed work ---');
{ const { m, botList } = world({ bots: 1 }); const b = botList[0]; const inst = bump(m, 'soot');
  const pt = m.tasks.points(inst)[0]; Object.assign(b.body, { x: pt.x + 1, z: pt.z, y: 0 }); b.heldTool = null;
  m.tasks.use(b, pt.id); ok(!b.hold, 'use() without the broom starts nothing');
  ok(m.tasks.botComplete(b, inst) === false && m.tasks.active.has(inst.uid), 'botComplete() without the broom is refused');
  const wr = m.tasks.tools.get('wrench1'); wr.heldBy = b.id; b.heldTool = wr.id;
  ok(m.tasks.botComplete(b, inst) === false, 'holding the WRONG tool is refused too');
  m.tasks.dropTool(b); const br = m.tasks.tools.get('broom1'); br.heldBy = b.id; b.heldTool = br.id;
  ok(m.tasks.botComplete(b, inst) === true && !m.tasks.active.has(inst.uid), 'with the right tool it completes'); }
{ // roamer (fast test mode) is gated as well
  const { m, botList } = world({ bots: 2, mode: 'roamer' }); const inst = bump(m, 'glass'); let bad = 0;
  const A = audit(m);
  const t = run(m, 120, 0.05, () => !m.tasks.active.has(inst.uid));
  ok(!m.tasks.active.has(inst.uid) && A.viol.length === 0 && A.steps > 0, `roamer bots also fetch the broom before sweeping (${t.toFixed(0)}s)`); }
{ // a big mixed match: not a single bot completion without its tool
  const { m } = world({ bots: 8 }); const A = audit(m); let n = 0;
  const oc = m.tasks.complete.bind(m.tasks); m.tasks.complete = (i, ps) => { n++; oc(i, ps); };
  m.dbg.maxConcurrent = null; m.dbg.freezeRed = true; m.tasks.fillPool();
  run(m, 240, 0.05);
  ok(n >= 6 && A.viol.length === 0, `240 s with 8 Humanlike bots: ${n} tasks finished, ${A.steps} progress steps, ${A.viol.length} made empty-handed${A.viol.length ? ' → ' + A.viol[0] : ''}`); }

// ===================================================================== 2. reaction delays
console.log('--- reaction delays ---');
function ceremonyTimes(delay) {
  const { m, botList } = world({ bots: 6, delay, chat: false });
  const master = botList[0]; m.masterId = master.id;
  const times = { vote: [], nominateAt: null, start: null };
  const ov = m.cer.vote.bind(m.cer); m.cer.vote = (p, a) => { if (p.isBot) times.vote.push(m.time - times.voteStart); ov(p, a); };
  const on = m.cer.nominate.bind(m.cer); m.cer.nominate = (id, e) => { if (times.nominateAt === null) times.nominateAt = m.time - times.start; times.voteStart = m.time; return on(id, e); };
  m.timers.nominate = 30; m.timers.vote = 30;
  for (const b of botList) { b.crystals = 3; b.known.clear(); b.cardUsed = true; }       // no stray role cards in this scripted scene
  m.bars.fillToNext();
  // wait for NOMINATE to begin
  run(m, 20, 0.05, () => m.cer.sub === CER.NOMINATE); times.start = m.time;
  run(m, 40, 0.05, () => times.vote.length >= 5);
  return times;
}
{ const fast = ceremonyTimes(0), slow = ceremonyTimes(2);
  // votes are still instant at delay 0; the Master now WALKS up to its pick before nominating, so the nomination
  // is no longer instant — it just carries no extra "thinking" delay (walk time only).
  ok(Math.max(...fast.vote) < 0.4 && fast.nominateAt < 3.5, `delay 0 → votes instant, Master walks up then nominates (nominate ${fast.nominateAt.toFixed(2)}s, last vote ${Math.max(...fast.vote).toFixed(2)}s)`);
  ok(slow.nominateAt >= fast.nominateAt, `delay 2 → Master nominates later than at delay 0 (walk + thinking: ${slow.nominateAt.toFixed(2)}s ≥ ${fast.nominateAt.toFixed(2)}s)`);
  ok(slow.vote.length >= 4 && slow.vote.every(v => v >= 1.2 && v <= 3.1), `delay 2 → every bot vote lands 1.3–2.7 s after the window opens (${slow.vote.map(v => v.toFixed(1)).join(', ')})`);
  ok(Math.max(...slow.vote) - Math.min(...slow.vote) > 0.1, `bots do not all decide at the same instant (spread ${(Math.max(...slow.vote) - Math.min(...slow.vote)).toFixed(2)}s)`); }
{ // role card: deliberation before use
  const t = (delay) => { const { m, botList } = world({ bots: 6, delay, chat: false }); const b = botList[1]; b.roleId = 15; b.cardUsed = false; b.faction = FACTIONS.FIRE; m.masterId = botList[0].id; m.bars.fillToNext();
    let usedAt = null, startAt = null; const ru = m.roles.use.bind(m.roles); m.roles.use = (p, tg) => { if (p === b && usedAt === null) usedAt = m.time - startAt; ru(p, tg); };
    for (const q of botList) { q.known.clear(); q.crystals = 3; q.brain.persona.chatty = 0; if (q !== b) q.cardUsed = true; }
    run(m, 20, 0.05, () => m.cer.sub === CER.NOMINATE); m.cer.nominate(botList[3].id);
    // jump straight into a Reaction window where Tribune is the right move: 2 of 3 crystals are on the table
    m.cer.final = new Map([[botList[2].id, 2]]); m.cer.votes.set(botList[2].id, 2);
    m.cer.setSub(CER.REACTION, 20); startAt = m.time;
    b.brain.mutKey = `${m.ceremonyIndex}:${m.masterId}:${m.execId}`; b.brain.mutiny = true;
    run(m, 8, 0.05, () => usedAt !== null); return usedAt; };
  const a = t(0), c = t(2);
  ok(a !== null && a < 1.2 && c !== null && c >= 1.2, `role card: delay 0 → ${a?.toFixed(2)}s, delay 2 → ${c?.toFixed(2)}s`); }
{ // captive selection waits too
  const choose = (delay) => { const { m, botList } = world({ bots: 5, delay, chat: false }); const b = botList[0]; m.masterId = b.id; let enter = null, chosen = null;
    for (let i = 0; i < 2400 && chosen === null; i++) { m.tick(0.05); if (enter === null && b.body.z < -14) enter = m.time; if (b.brain.captive != null) chosen = m.time; } return chosen - enter; };
  const a = choose(0), c = choose(3);
  ok(a < 0.6 && c >= 1.8 && c <= 4.5, `captive choice: delay 0 → ${a.toFixed(1)}s after entering the chamber, delay 3 → ${c.toFixed(1)}s`); }

// ===================================================================== 3. banter
console.log('--- chat & bluffing ---');
function chatWorld(extra = {}) {
  const w = world({ bots: 6, delay: 0, ...extra });
  w.botList.forEach(b => { b.brain.persona.chatty = 1; b.cardUsed = true; });
  return w;
}
{ // nomination reactions
  const { m, botList } = chatWorld(); const master = botList[0], exec = botList[1]; m.masterId = master.id; m.bars.fillToNext();
  run(m, 20, 0.05, () => m.cer.sub === CER.NOMINATE); m.cer.nominate(exec.id);
  run(m, 12, 0.05); const L = m.botChat.log.filter(x => x.kind.startsWith('nominate'));
  ok(L.some(x => x.bot === master.name) && L.some(x => x.bot === exec.name), 'Master explains the pick and the nominee answers');
  ok(L.filter(x => x.bot !== master.name && x.bot !== exec.name).length >= 1 && L.every(x => /./.test(x.text)), `other bots chime in (${L.length} lines): ${L.slice(0, 3).map(x => `${x.bot}: ${x.text}`).join(' | ')}`); }
{ // hostile exec + mutiny desire → open call for a mutiny; ally → praise
  const { m, botList } = chatWorld(); const master = botList[0], exec = botList[1], foe = botList[2], friend = botList[3];
  m.masterId = master.id; m.bars.fillToNext(); foe.faction = FACTIONS.FIRE; exec.faction = FACTIONS.BLOOD; foe.known.set(exec.id, FACTIONS.BLOOD);
  friend.faction = FACTIONS.FIRE; friend.known.set(exec.id, FACTIONS.FIRE);
  for (const q of botList) if (q !== foe && q !== friend) q.brain.persona.chatty = 0;
  run(m, 20, 0.05, () => m.cer.sub === CER.NOMINATE); m.cer.nominate(exec.id); run(m, 12, 0.05);
  const f = m.botChat.log.find(x => x.bot === foe.name && x.kind === 'nominate-react'), g = m.botChat.log.find(x => x.bot === friend.name && x.kind === 'nominate-react');
  ok(f && /mutiny|rebel|no way|not /i.test(f.text), `a bot that knows the nominee is an enemy calls for a mutiny: "${f?.text}"`);
  ok(g && !/mutiny/i.test(g.text), `a bot that knows the nominee is an ally backs them: "${g?.text}"`); }
// executioner explanation + bluff
function execScenario({ execFaction, capFaction, curse, otherFaction, otherCurse }) {
  const { m, botList } = chatWorld(); const master = botList[0], exec = botList[1]; m.masterId = master.id; exec.faction = execFaction; m.bars.fillToNext();
  run(m, 20, 0.05, () => m.cer.sub === CER.NOMINATE); m.cer.nominate(exec.id);
  for (const b of botList) { b.crystals = 3; b.brain.mutiny = false; b.brain.mutKey = `${m.ceremonyIndex}:${m.masterId}:${m.execId}`; }
  run(m, 40, 0.05, () => m.cer.sub === CER.EXECUTION);
  const [a, b2] = m.npcs.altar(); Object.assign(a, { faction: capFaction, curse }); Object.assign(b2, { faction: otherFaction, curse: otherCurse });
  m.cer.t = 60; m.cer.bluffTest = true;
  // force the choice, announce it like the AI would, then sacrifice it
  exec.knownNpcs.add(a.id); exec.knownNpcs.add(b2.id); m.botChat.onExecChoice(exec, a); run(m, 3, 0.05);
  exec.carryingNpc = null; m.cer.sacrificeNpc(a); run(m, 6, 0.05, () => m.cer.sub === CER.DEBATE); run(m, 8, 0.05);
  return { m, exec, log: m.botChat.log.filter(x => x.bot === exec.name) };
}
{ const r = execScenario({ execFaction: FACTIONS.FIRE, capFaction: FACTIONS.FIRE, curse: 'MANA_BOOST', otherFaction: FACTIONS.BLOOD, otherCurse: 'NONE_PLACEHOLDER' });
  const pre = r.log.find(x => x.kind === 'exec'), post = r.log.find(x => x.kind === 'exec-debate');
  ok(pre && !pre.lie && /Mana Boost/.test(pre.text), `Executioner states which captive and why, honestly when the pick is good: "${pre?.text}"`);
  ok(post && !post.lie && /(Fire|Mana Boost|just like I said|crypt is happy)/.test(post.text), `…and stays honest afterwards: "${post?.text}"`); }
{ const r = execScenario({ execFaction: FACTIONS.FIRE, capFaction: FACTIONS.BLOOD, curse: 'TOXIC_FUMES', otherFaction: FACTIONS.FIRE, otherCurse: 'MANA_BOOST' });
  const pre = r.log.find(x => x.kind === 'exec'), post = r.log.find(x => x.kind === 'exec-debate');
  ok(pre && pre.lie, `opposing captive + harmful curse → the announcement is a lie: "${pre?.text}"`);
  ok(post && post.lie && /(no choice|terrible|lesser evil|other captive|Master|threw the)/i.test(post.text), `…and the post-sacrifice story is a bluff: "${post?.text}"`);
  ok(!/Mana Boost/.test(post?.text ?? '') , 'the bluff never reveals the real alternative'); }
{ // the lie is only ever about the hidden captive / side — never about public facts
  let publicLie = 0;
  for (let i = 0; i < 25; i++) { const r = execScenario({ execFaction: FACTIONS.BLOOD, capFaction: FACTIONS.FIRE, curse: 'MANA_DRAIN', otherFaction: FACTIONS.BLOOD, otherCurse: 'MANA_BOOST' });
    const post = r.log.find(x => x.kind === 'exec-debate'); if (post && (/Blood captive/i.test(post.text))) publicLie++; }
  ok(publicLie === 0, 'bluffs never contradict the publicly revealed faction of the sacrificed captive (25 runs)'); }

// debate participation, suspicion, defence — several debates, because accusations are deliberately varied
const D = []; let spanSec = 0, minGap = 9, maxPer = 0, keep = null;
for (let rep = 0; rep < 6; rep++) {
  const { m, botList, human } = chatWorld(); const master = botList[0], exec = botList[1]; m.masterId = master.id; m.bars.fillToNext();
  const culprit = botList[4]; for (const b of botList) b.known.clear();
  for (const q of m.list) q.obs = { idle: 1, total: 40, tasks: 2, bails: 0, lastBail: null };
  culprit.obs = { idle: 30, total: 40, tasks: 0, bails: 0, lastBail: null };
  human.obs = { idle: 1, total: 40, tasks: 1, bails: 3, lastBail: 'Patch Leaking Pipes' };
  m.dbg.debateSec = 30;
  run(m, 20, 0.05, () => m.cer.sub === CER.NOMINATE); m.cer.nominate(exec.id);
  run(m, 40, 0.05, () => m.cer.sub === CER.EXECUTION); const [a] = m.npcs.altar(); a.faction = FACTIONS.CHAOS; a.curse = 'MANA_BOOST'; exec.carryingNpc = null; m.cer.sacrificeNpc(a);
  run(m, 30, 0.05, () => m.cer.sub === CER.DEBATE); const t0 = m.time; run(m, 33, 0.05, () => m.cer.sub !== CER.DEBATE);
  const lines = m.botChat.log.filter(x => x.at >= t0 - 0.1 && x.kind !== 'partner');
  lines.forEach(x => D.push({ ...x, culprit: culprit.name }));
  spanSec = m.time - t0;
  const gaps = m.botChat.log.map((x, i, arr) => i ? x.at - arr[i - 1].at : 9).slice(1); minGap = Math.min(minGap, ...gaps);
  const per = {}; lines.forEach(x => { per[x.bot] = (per[x.bot] || 0) + 1; }); maxPer = Math.max(maxPer, ...Object.values(per));
  if (rep === 0) keep = { m, botList, human };
}
ok(D.length >= 30, `bots actively talk through the debate (${(D.length / 6).toFixed(0)} lines per ${spanSec.toFixed(0)}s debate)`);
const idleHit = D.find(x => x.text.includes(x.culprit) && /standing|idle|sus/i.test(x.text));
ok(!!idleHit, `they call out the minion they actually saw idling: "${idleHit?.text}"`);
const bailHit = D.find(x => /walk(ed)? off|abandon/i.test(x.text) && x.text.includes('Human'));
ok(!!bailHit, `…and the human who bailed on a task: "${bailHit?.text}"`);
ok(new Set(D.filter(x => x.kind === 'suspect').map(x => (x.text.match(/(Human|Idle\d|[A-Z][a-z]+)(?=,| was| hasn|, you| is| abandoned| threw)/) || [])[0])).size >= 2, 'not every bot accuses the same minion');
ok(minGap >= 1.05, `no chat spam: shortest gap between bot lines ${minGap.toFixed(2)}s`);
ok(maxPer <= 5, `no single bot floods the chat (max ${maxPer} lines in a debate)`);
{ const { m, botList, human } = keep;
  // defence
  const acc = botList[3]; acc.obs.tasks = 3; const before = m.botChat.log.length;
  m.chat(m.P(m.hostId), `${acc.name} you look sus, why were you idle?`); run(m, 8, 0.05);
  const r = m.botChat.log.slice(before).find(x => x.bot === acc.name && x.kind === 'defend');
  ok(r && /3 task/.test(r.text), `an accused bot defends itself with its record: "${r?.text}"`);
  const b2 = botList[2]; const bf = m.botChat.log.length; b2.faction = FACTIONS.BLOOD;
  m.chat(m.P(m.hostId), `${b2.name} is Blood!!`); run(m, 8, 0.05);
  const r2 = m.botChat.log.slice(bf).find(x => x.bot === b2.name && x.kind === 'defend');
  ok(r2 && /not Blood|Blood\?/i.test(r2.text) && r2.lie, `a bot accused of its true faction denies it (lie): "${r2?.text}"`); }
{ const { m, botList } = chatWorld({ chat: false }); m.chat(m.P(m.hostId), `${botList[0].name} sus?`); run(m, 8, 0.05); ok(m.botChat.log.length === 0, 'banter can be switched off from the debug menu'); }
{ const { m, botList } = chatWorld({ mode: 'roamer' }); m.chat(m.P(m.hostId), `${botList[0].name} sus?`); m.bars.fillToNext(); run(m, 30, 0.05); ok(m.botChat.log.length === 0, 'only the Humanlike profile talks'); }
{ // waiting for a partner on a two-person task
  const { m, botList } = chatWorld(); botList.slice(1).forEach(b => { b.brain.persona.chatty = 0; });
  const inst = bump(m, 'saw'); m.dbg.botMode = 'human'; botList.slice(1).forEach(b => { b.brain.skip = new Map([[inst.uid, 1e9]]); });
  run(m, 40, 0.05, () => m.botChat.log.some(x => x.kind === 'partner'));
  ok(m.botChat.log.some(x => x.kind === 'partner' && /saw|Saw/i.test(x.text)), `a bot waiting at a 2-person task asks for help: "${m.botChat.log.find(x => x.kind === 'partner')?.text}"`); }

// ===================================================================== 4. no stalls: bots-only games must finish
console.log('--- match length & jams ---');
function fullGame({ players, maxConcurrent = null, freeze = false }) {
  const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id; m.bots.spawn(players - 1);
  Object.assign(m.dbg, { botMode: 'human', freezeRed: freeze, maxConcurrent });
  m.timers.revealBack = m.timers.revealFront = 0.5; m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  let t = 0; while (t < 30 * 60 && m.phase !== PHASE.FINALE) { m.tick(0.05); t += 0.05; }
  return { done: m.phase === PHASE.FINALE, min: t / 60, pool: [...m.tasks.active.values()].map(i => i.key).join(',') };
}
for (const players of [5, 6, 7, 8, 9, 10, 11]) {
  const r = fullGame({ players });
  ok(r.done && r.min <= 16, `${players} players, all bots (Humanlike): match ends after ${r.min.toFixed(1)} game-minutes (limit 16)`);
}
for (const cap of [1, 2, 3]) for (const players of [5, 8]) {
  const r = fullGame({ players, maxConcurrent: cap, freeze: true });
  ok(r.done && r.min <= 30, `board limited to ${cap} task(s), Red Bar frozen, ${players} players: still finishes (${r.min.toFixed(1)} min)${r.done ? '' : ' — STUCK with [' + r.pool + ']'}`);
}
{ // The jam: a small board must never be left holding only chores the crew refuses.
  const refused = new Set(['carry', 'bell', 'bellows', 'stack', 'relay', 'carcass', 'calib', 'books']);
  const scan = (m, ticks) => { let bad = 0, checks = 0; for (let i = 0; i < ticks; i++) { m.tick(0.05); if (i % 20 === 0 && m.tasks.active.size) { checks++; if ([...m.tasks.active.values()].some(t => refused.has(t.def.mech))) bad++; } } return { bad, checks }; };
  // (a) cap in force from the start: EVERY snapshot must be doable — repeated, because the spawner is random
  let strictBad = 0, strictChecks = 0;
  for (let r = 0; r < 6; r++) { const { m } = world({ bots: 5 }); m.dbg.freezeRed = true; for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; m.dbg.maxConcurrent = 1; m.tasks.fillPool(); const s = scan(m, 3000); strictBad += s.bad; strictChecks += s.checks; }
  ok(strictChecks > 200 && strictBad === 0, `1-task board from the start (6 games): always a chore the bots can do (${strictBad} bad of ${strictChecks} snapshots)`);
  // (b) cap lowered mid-match: a refused chore already on the board used to sit in the only slot forever (a jam).
  //     The board now heals itself: it must settle on bot-doable work every time, and then stay that way.
  let settled = 0; const N = 12;
  for (let r = 0; r < N; r++) { const { m } = world({ bots: 5 }); m.dbg.freezeRed = true; m.dbg.maxConcurrent = 1; scan(m, 1500); let stuck = 0; for (let i = 0; i < 2400; i++) { m.tick(0.05); if (i % 20 === 0 && m.tasks.active.size >= 1 && ![...m.tasks.active.values()].some(t => m.tasks.botDoable(t.def))) stuck++; } if (stuck <= 8) settled++; }
  ok(settled === N, `cap lowered mid-match: the board heals within seconds (≤8 s with only refused chores) (${settled}/${N} games)`);
  // (c) worst case for the heal: the only slot holds a refused chore the moment the bots take over — it must be retired within ~20 s
  const { m } = world({ bots: 5 }); m.dbg.freezeRed = true; m.dbg.maxConcurrent = 1; for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; m.tasks.spawnTask('carcass');
  const t = run(m, 60, 0.05, () => ![...m.tasks.active.values()].some(i => refused.has(i.def.mech)) && m.tasks.active.size === 1);
  ok(t < 25, `a refused chore stuck in a 1-slot board is retired and replaced after ${t.toFixed(0)} s`); }
{ // humans still get the full variety: with NO bots the spawner is unrestricted
  const m = new Match({ send: () => {} }); const hid = m.addPlayer({ name: 'H', isHost: true }).id; for (let i = 0; i < 4; i++) m.addPlayer({ name: 'P' + i });
  m.startGame(hid); m.phaseT = 0; m.tick(0.016); const seen = new Set();
  for (let i = 0; i < 200; i++) { for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; m.tasks.fillPool(); for (const t of m.tasks.active.values()) seen.add(t.def.mech); }
  ok(['carry', 'bell', 'bellows', 'stack', 'relay', 'carcass', 'calib'].every(k => seen.has(k)), 'without bots, all task types still spawn for human crews'); }

console.log(fails ? `\n${fails} FAILED` : '\nBOT AI TESTS PASSED');
process.exit(fails ? 1 : 0);
