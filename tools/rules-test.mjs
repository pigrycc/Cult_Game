// Rule-level assertions on the authoritative Match (no network).
import { Match } from '../src/server/Match.js';
import { PHASE, CER } from '../src/shared/constants.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
function mk(n = 7) {
  const m = new Match({ send: () => {} });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  for (const id of ids) m.P(id).isBot = false; // humans: no bot brain
  m.startGame(ids[0]);
  m.phaseT = 0; m.tick(0.016);           // → WORK
  return { m, ids, P: i => m.P(ids[i]) };
}
const step = (m, s = 0.1, n = 1) => { for (let i = 0; i < n; i++) m.tick(s); };
function until(m, sub, max = 12) { for (let i = 0; i < max && !(m.phase === PHASE.CEREMONY && m.cer.sub === sub); i++) { m.cer.t = 0; step(m); } return m.cer.sub === sub; }
function toVote(m) { m.bars.fillToNext(); m.cer.t = 0; step(m); /* assemble → NOMINATE */ }

// --- basic flow
{ const { m } = mk(); ok(m.phase === PHASE.WORK, 'reaches work phase'); ok(m.npcs.chamber().length === 3, '3 captives seated');
  const roles = new Set(m.list.map(p => p.roleId)); ok(roles.size === m.list.length, 'roles unique');
  const f = m.list.reduce((a, p) => (a[p.faction] = (a[p.faction] || 0) + 1, a), {}); ok(f.fire === 4 && f.blood === 2 && f.chaos === 1, '7p composition 4/2/1'); }
// --- explosion
{ const { m } = mk(); m.bars.red = m.bars.next - 0.0001; step(m, 2); ok(m.phase === PHASE.FINALE && m.winner === 'nobody', 'red first → crypt explodes'); }
// --- rebellion success & new master = top contributor, crystals lost
{ const { m } = mk(); toVote(m);
  ok(m.cer.sub === CER.NOMINATE, 'nominate sub-state');
  const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id);
  const voters = m.list.filter(p => m.cer.isVoter(p));
  m.cer.vote(voters[0], 2); m.cer.vote(voters[1], 1);
  m.cer.t = 0; step(m); ok(m.cer.sub === CER.COUNT, 'count'); m.cer.t = 0; step(m); ok(m.cer.sub === CER.REACTION, 'reaction');
  m.cer.t = 0; step(m);
  ok(m.cer.sub === CER.RESULT && m.cer.summary?.title.includes('succeeds'), 'rebellion outcome card (buffer)');
  ok(m.masterId === voters[0].id, 'top rebel becomes master'); ok(voters[0].crystals === 1 && voters[1].crystals === 2, 'rebel crystals lost');
  ok(until(m, CER.NOMINATE, 1), 'phase 2 replays after the buffer'); }
// --- rebellion fail keeps crystals; Pacifier & Instigator & Tribune
{ const { m, P } = mk(); toVote(m);
  const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id);
  const v = m.list.filter(p => m.cer.isVoter(p));
  m.cer.vote(v[0], 1); m.cer.vote(v[1], 1); m.cer.vote(v[2], 1);
  m.cer.t = 0; step(m); m.cer.t = 0; step(m);
  const pac = v[3]; pac.roleId = 4; pac.cardUsed = false;
  m.roles.use(pac, [v[0].id]); ok(m.cer.pacified.has(v[0].id) && pac.roleRevealed, 'Pacifier pacifies + reveals');
  ok(m.cer.total() === 2, 'total after pacify = 2');
  const ins = v[4]; ins.roleId = 2; m.roles.use(ins, [v[1].id]); ok(m.cer.total() === 3, 'Instigator doubles → 3');
  const om = m.masterId; m.cer.t = 0; step(m); ok(m.masterId !== om && v[1].crystals === 2, 'rebellion succeeds at threshold 3'); ok(v[0].crystals === 3, 'pacified rebel keeps crystals'); }
// --- Anarchist / Tribune thresholds
{ const { m } = mk(10); toVote(m); const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id);
  ok(m.cer.threshold === 5, '10p threshold 5'); m.cer.tribune = true; ok(m.cer.threshold === 3, 'tribune halves (ceil)'); m.cer.tribune = false; m.cer.anarchy = true; ok(m.cer.threshold === 1, 'anarchy = 1'); }
// --- Grey Eminence & Old Chef & Embalmer windows
{ const { m } = mk(); toVote(m); const ge = m.list.find(p => p.id !== m.masterId); ge.roleId = 13; ge.cardUsed = false;
  const t = m.eligibleExec().find(p => p !== ge); m.roles.use(ge, [t.id]); ok(m.execId === t.id && m.cer.sub === CER.VOTE, 'Grey Eminence appoints executioner');
  const chef = m.list.find(p => p.id !== m.masterId && p !== ge && p !== t); chef.roleId = 14; chef.cardUsed = false; const old = m.masterId;
  m.roles.use(chef, []); ok(m.masterId !== old && m.cer.sub === CER.RESULT && until(m, CER.NOMINATE, 1), 'Old Chef dethrones (outcome card, then nomination)'); }
// --- Execution, sacrifice tally, prison discard, glyph fog of war
{ const { m } = mk(); toVote(m); const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id);
  ok(until(m, CER.EXECUTION), 'execution after failed/no rebellion');
  const [a] = m.npcs.altar(); a.curse = 'MANA_BOOST'; const before = ex.crystals;
  const other = m.list.find(p => p.id !== ex.id && p.id !== m.masterId);
  ok(!m.npcs.serialize(other).find(n => n.id === a.id).faction, 'bystander sees [Unknown Captive]');
  ok(!!m.npcs.serialize(ex).find(n => n.id === a.id).faction, 'executioner sees glyph');
  m.cer.sacrificeNpc(a); ok(Object.values(m.tally).reduce((x, y) => x + y) === 1, 'tally +1');
  ok(ex.crystals === before + 1, 'mana boost'); ok(m.npcs.npcs.get(a.id).state === 'sacrificed', 'sacrificed');
  ok([...m.npcs.npcs.values()].some(n => n.state === 'prison' && n.discard === 'exec'), 'other captive → prison (exec)');
  ok(!!m.npcs.serialize(other).find(n => n.state === 'prison'), 'prison captive replicated');
  ok(m.cer.sub === CER.RESULT && m.cer.summary.lines.some(l => l.includes('+1')), 'sacrifice outcome card shows mana gain');
  ok(m.cer.t === 3, 'buffer = 3 s');
  ok(until(m, CER.DEBATE), 'debate after empty milestone');
  m.cer.t = 0; step(m); ok(m.phase === PHASE.WORK && ex.exhausted, 'back to work, executioner exhausted'); }
// --- Toxic fumes transfers staff to least-served
{ const { m } = mk(); toVote(m); const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id); until(m, CER.EXECUTION);
  const oldM = m.masterId; const [a] = m.npcs.altar(); a.curse = 'TOXIC_FUMES'; m.cer.sacrificeNpc(a);
  ok(m.masterId !== oldM && m.P(oldM).exhausted && m.P(oldM).fumesT > 0 && ex.fumesT > 0, 'toxic fumes: staff moves, both intoxicated, old master exhausted'); }
// --- Living sacrifice of Chaos Leader → chaos wins; tie → chaos
{ const { m } = mk(); m.cer.eventKey = 'LIVING'; m.phase = PHASE.CEREMONY; m.cer.startEvent(); const L = m.P(m.chaosLeaderId);
  if (L.id === m.masterId) { m.masterId = m.list.find(p => p !== L).id; }
  m.cer.throwLiving(L); ok(m.phase === PHASE.FINALE && m.winner === 'chaos', 'chaos leader thrown → chaos wins'); }
{ const { m } = mk(); m.tally = { fire: 2, blood: 2, chaos: 1 }; m.cer.finalize(); ok(m.winner === 'chaos', 'tie → chaos'); }
// --- Spy / Smuggler / Exorcist / Thief / Mentor
{ const { m } = mk(); const spy = m.list.find(p => p.id !== m.masterId); spy.roleId = 9; m.roles.use(spy, []); ok(m.npcs.spyActive && !m.gateClosedFor(spy, 'selection_grate') && m.gateClosedFor(m.P(m.masterId), 'selection_grate'), 'spy opens grate only for spy');
  const s2 = m.list.find(p => p.id !== m.masterId && p !== spy); s2.roleId = 11; m.roles.use(s2, []); ok(!s2.cardUsed, 'smuggler blocked during spy window');
  step(m, 1, 16); ok(!m.npcs.spyActive, 'spy window expires'); m.roles.use(s2, []); ok(m.npcs.chamber().length === 4, 'smuggler adds 4th captive');
  const ex = m.list.find(p => p.id !== m.masterId && p !== spy && p !== s2); ex.roleId = 16; m.roles.use(ex, []); ok(m.npcs.chamber().length === 3, 'exorcist redraws 3');
  const th = m.list.find(p => ![spy, s2, ex].includes(p) && p.id !== m.masterId); th.roleId = 1; th.body.x = spy.body.x + 1; th.body.z = spy.body.z; m.roles.use(th, [spy.id]); ok(th.crystals === 4 && spy.crystals === 2, 'mana thief steals 1');
  const mt = m.list.find(p => ![spy, s2, ex, th].includes(p)); mt.roleId = 17; m.roles.use(mt, [spy.id]); ok(!spy.cardUsed, 'dark mentor re-arms card'); }
// --- mandatory curses
{ const { m } = mk(); let bad = 0; const seen = new Set();
  for (let i = 0; i < 400; i++) { const n = m.npcs.draw(); seen.add(n.curse); if (!['MANA_BOOST', 'MANA_DRAIN', 'TOXIC_FUMES', 'EYE_OF_TRUTH', 'GAGGING_SEAL'].includes(n.curse)) bad++; }
  ok(bad === 0 && seen.size === 5, 'every captive carries one of the 5 core curses');
  m.dbg.extendedCurses = true; let ext = 0; for (let i = 0; i < 400; i++) if (['CALL_OF_ABYSS', 'DARK_INITIATION'].includes(m.npcs.draw().curse)) ext++;
  ok(ext > 0, 'extended curse toggle adds Abyss/Initiation');
  ok(m.npcs.draw({ curse: 'NONE' }).curse !== 'NONE', 'forced invalid curse falls back to a real curse'); }
// --- debug timers & buffer skip
{ const { m, P } = mk(); m.debug.run(P(0), 'set_timers', { timers: { vote: 12, revealBack: 2, phaseTransitionBufferSeconds: 0 }, workSec: 30, holdMul: 0.5 });
  ok(m.timers.vote === 12 && m.timers.revealBack === 2 && m.dbg.workSec === 30 && m.dbg.holdMul === 0.5, 'set_timers applies');
  ok(Math.abs(m.bars.tickX - (1 / 6) * 1.5 / 30) < 1e-9, 'work duration drives red tick');
  const pt = [...m.tasks.active.values()].flatMap(t => m.tasks.points(t)).find(q => q.hold && q.need > 0);
  ok(!pt || pt.need < 5, 'hold multiplier applied to points');
  toVote(m); const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id); ok(m.cer.t === 12, 'vote countdown uses override');
  until(m, CER.EXECUTION); m.cer.sacrificeNpc(m.npcs.altar()[0]); ok(m.cer.sub !== CER.RESULT, 'buffer 0 skips outcome card');
  m.debug.run(P(0), 'reset_timers'); ok(m.timers.vote === 6 && m.timers.phaseTransitionBufferSeconds === 3, 'reset timers'); }
console.log(fails ? `\n${fails} FAILED` : '\nALL RULE TESTS PASSED');
process.exit(fails ? 1 : 0);
