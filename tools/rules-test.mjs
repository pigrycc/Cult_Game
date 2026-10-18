// Rule-level assertions on the authoritative Match (no network).
import { Match } from '../src/server/Match.js';
import { PHASE, CER, ROLE_BY_ID, ROLES, roleCard, FACTION_OBJECTIVE } from '../src/shared/constants.js';
import { BOT_NAMES } from '../src/server/Bots.js';
import { Countdown, countdownSources } from '../src/client/countdown.js';
import { matchAffectingOverrides, clearSavedMatchOverrides } from '../src/client/overrides.js';

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
// --- role cards
ok(!ROLE_BY_ID[7] && ROLES.length === 20, 'Dungeon Look-Out removed (20 roles)');
ok(roleCard(15, { threshold: 5 }).text.includes('3 crystals instead of 5'), 'Tribune text is dynamic (5 → 3)');
ok(roleCard(17).text === 'A chosen player may use their character ability a second time.', 'Mentor copy');
ok(ROLES.every(r => roleCard(r.id, { threshold: 3 }).when.length > 0), 'every role has an activation condition');
ok(['fire', 'blood', 'chaos'].every(f => FACTION_OBJECTIVE[f]), 'faction objectives');
{ const { m } = mk(11); ok(new Set(m.list.map(p => p.roleId)).size === 11 && !m.list.some(p => p.roleId === 7), '11 unique roles, none is #7'); }
// --- vote turnout, exhausted guardrail, appointment fx, vision handover
{ const sent = []; const m = new Match({ send: (pid, msg) => sent.push([pid, msg]) });
  const ids = []; for (let i = 0; i < 7; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016);
  ok(sent.some(([, x]) => x.t === 'fx' && x.type === 'appoint' && x.office === 'master'), 'first Master gets the pillar of light');
  toVote(m);
  const tired = m.list.find(p => p.id !== m.masterId); m.exhaustedQueue = [tired.id]; m.refreshExhausted();
  tired.body.x = m.P(m.masterId).body.x + 1;
  m.cer.lmb(m.P(m.masterId), tired.id);
  ok(sent.some(([pid, x]) => pid === m.masterId && x.t === 'errorFlash' && /exhausted/.test(x.text)) && m.cer.sub === CER.NOMINATE, 'nominating an exhausted minion → error flash');
  const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id);
  ok(sent.some(([pid, x]) => pid === ex.id && x.t === 'big' && x.text.includes('YOU HAVE BEEN APPOINTED')), 'executioner banner');
  ok(sent.some(([, x]) => x.t === 'big' && x.avatars?.length === 2), 'nomination banner carries both avatars');
  const voters = m.list.filter(p => m.cer.isVoter(p));
  voters.forEach((v, i) => m.cer.vote(v, i < 3 ? 1 : 0));
  ok(m.cer.t <= 0.5, 'full turnout closes the vote early');
  step(m, 0.1, 6); ok(m.cer.sub === CER.COUNT, '… and resolves to the count');
  until(m, CER.RESULT); const nm = m.P(m.masterId);
  ok(m.npcs.altar().every(n => nm.knownNpcs.has(n.id)), 'new Master inherits glyph vision of the altar captives'); }
// --- curse resolution line & sudden death
{ const { m } = mk(); toVote(m); const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id); until(m, CER.EXECUTION);
  const [a] = m.npcs.altar(); a.curse = 'MANA_DRAIN'; m.cer.sacrificeNpc(a);
  ok(/Mana Drain: Executioner .* lost 1 Mana Crystal/.test(m.cer.lastSacrifice.resolution), 'resolution line for Mana Drain'); }
{ const { m } = mk(5); m.phase = PHASE.CEREMONY; m.cer.milestone = 4; m.tally = { fire: 1, blood: 3, chaos: 0 };
  const v = m.list.find(p => p.id !== m.chaosLeaderId && p.id !== m.masterId);
  m.cer.throwLiving(v); ok(m.phase === PHASE.CEREMONY && m.cer.sub === CER.RESULT, 'sudden death waits for the living-sacrifice outcome card');
  m.cer.t = 0; step(m); ok(m.phase === PHASE.FINALE && m.winner === 'blood', 'Blood 3:1 after ceremony 4 of 5 → mathematical win'); }
{ const { m } = mk(5); m.phase = PHASE.CEREMONY; m.cer.milestone = 4; m.tally = { fire: 2, blood: 2, chaos: 0 };
  m.cer.throwLiving(m.list.find(p => p.id !== m.chaosLeaderId && p.id !== m.masterId)); m.cer.t = 0; step(m);
  ok(m.phase !== PHASE.FINALE, 'no sudden death when the result is still open'); }
// --- shove coins, immunity, coin pickup hold
{ const { m } = mk(); const [a, b] = m.list.filter(p => p.id !== m.masterId);
  b.gold = 20; m.dbg.shoveDropPct = 50; Object.assign(a.body, { x: 0, z: 6, yaw: 0 }); Object.assign(b.body, { x: 0, z: 5 });
  m.shove(a, b.id);
  const coins = [...m.tasks.coins.values()];
  ok(b.gold === 10 && coins.reduce((s, c) => s + c.amount, 0) === 10 && coins.length === 10, 'shove drops 50% as individual coins');
  a.shoveCd = 0; b.body.ragdoll = 0; Object.assign(b.body, { x: 0, z: 5, vx: 0, vz: 0 }); m.shove(a, b.id);
  ok(b.gold === 10, 'same attacker cannot shove again during immunity');
  const c = coins[0]; Object.assign(a.body, { x: c.x, z: c.z + 1, ragdoll: 0 }); a.frozen = false;
  m.tasks.use(a, 'coin:' + c.id); ok(a.hold && m.tasks.coins.has(c.id), 'coin pickup is a hold');
  step(m, 0.1, 8); ok(!m.tasks.coins.has(c.id) && a.gold === c.amount, 'coin collected after holding E'); }
// --- bot names, sprint toggle
{ const m = new Match({ send: () => {} }); m.addPlayer({ name: 'H', isHost: true }); m.bots.spawn(6);
  ok(m.list.filter(p => p.isBot).every(p => BOT_NAMES.includes(p.name)) && new Set(m.list.map(p => p.name)).size === 7, 'bots get unique thematic names'); }
{ const { m, P } = mk(); m.dbg.noSprint = true; const p = P(0); Object.assign(p.body, { x: 0, z: 0, vx: 0, vz: 0, ragdoll: 0 }); p.frozen = false;
  for (let i = 0; i < 30; i++) m.simulate(p, { fwd: 1, strafe: 0, yaw: 0, pitch: 0, sprint: true }, 1 / 60);
  ok(Math.hypot(p.body.vx, p.body.vz) < 4.5, 'disable sprint caps speed at walking pace'); }
// --- lobby cleanup: no debuff survives the trip back to the lobby
{ const { m } = mk(7); const [a, b, c] = m.list;
  // pile on everything
  a.fumesT = 40; a.muted = true; a.mutedSince = 3; a.gagged = true; a.immuneChaos = true; a.hasKey = true; a.ghost = true; a.cardUsed = true; a.roleRevealed = true;
  a.crystals = 0; a.gold = 33; a.blind = true; a.frozen = true; a.shoveCd = 3; a.shoveImmuneUntil = 99; a.lastShovedBy = b.id; a.publicNot = 'fire'; a.slipCd = 2; a.servedMaster = 4;
  b.ridingOn = c.id; c.rider = b.id; b.body.ragdoll = 2; b.body.vx = 5; c.exhausted = true; m.exhaustedQueue = [c.id];
  b.heldItem = m.tasks.makeItem('sandbag', 0, 0.5, 0).id; b.body.spin = 9; c.fumesT = 12;
  m.tally = { fire: 3, blood: 1, chaos: 2 }; m.winner = 'fire';
  m.endMatch('fire', 'test'); m.returnToLobby(m.hostId);
  const neutral = p => !p.fumesT && !p.muted && !p.gagged && !p.immuneChaos && !p.hasKey && !p.ghost && !p.cardUsed && !p.roleRevealed &&
    p.crystals === 3 && p.gold === 0 && !p.blind && !p.frozen && !p.shoveCd && !p.shoveImmuneUntil && p.lastShovedBy === null && !p.publicNot &&
    !p.slipCd && !p.servedMaster && !p.exhausted && !p.ridingOn && !p.rider && !p.carriedBy && !p.heldItem && !p.heldTool && !p.hold &&
    p.body.ragdoll === 0 && p.body.vx === 0 && p.body.spin === 0 && p.faction === null && p.roleId === null && p.known.size === 0 && p.knownNpcs.size === 0;
  ok(m.phase === PHASE.LOBBY && m.list.every(neutral), 'every status effect / debuff / overlay flag is purged in the lobby');
  ok(m.list.every(p => m.speedMul(p) === 1), 'speed modifiers back to 1.0');
  ok(m.exhaustedQueue.length === 0 && m.tally.fire === 0 && m.winner === null && m.masterId === null && m.items === undefined, 'match-level state reset');
  const st = Object.values(m.list).map(p => ({ fumes: p.fumesT, blind: p.blind })); ok(st.every(x => x.fumes === 0 && !x.blind), 'state packet shows no fumes / blind');
  // and a fresh match starts clean as well
  m.list.forEach(p => { p.fumesT = 30; p.muted = true; }); m.startGame(m.hostId);
  ok(m.list.every(p => p.fumesT === 0 && !p.muted), 'a new match also starts without leftover debuffs'); }
{ const m = new Match({ send: () => {} }); const ids = []; for (let i = 0; i < 6; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016); m.removePlayer(ids[3]); m.endMatch('fire', 't'); m.returnToLobby(m.hostId);
  ok(m.players.size === 5 && !m.P(ids[3]), 'players who disconnected mid-match are not carried into the next lobby'); }
// --- mutiny tie-break uses the modified (effective) crystal count
function mutiny(votes, setup) {
  const { m } = mk(8); toVote(m); const ex = m.eligibleExec()[0]; m.cer.nominate(ex.id);
  const v = m.list.filter(p => m.cer.isVoter(p)); m.dbg.mutinyThreshold = 1;
  votes.forEach((n, i) => m.cer.vote(v[i], n));
  step(m, 0.1, 8); m.cer.t = 0; step(m); // count
  if (setup) setup(m, v);
  m.cer.t = 0; step(m); m.cer.t = 0; step(m);
  return { m, v };
}
{ // raw tie (1 vs 1 vs 1) – A is doubled by the Rebellion Instigator → A must win every time
  let wins = 0; for (let i = 0; i < 12; i++) { const { m, v } = mutiny([1, 1, 1], (m, v) => m.cer.doubled.add(v[0].id)); if (m.masterId === v[0].id) wins++; }
  ok(wins === 12, 'raw tie + doubling → doubled player always becomes Master (12/12)'); }
{ // 2 raw (not doubled) vs 1 raw doubled → effective 2 vs 2 → either may win, nobody else
  const seen = new Set(); for (let i = 0; i < 40; i++) { const { m, v } = mutiny([2, 1, 0], (m, v) => m.cer.doubled.add(v[1].id)); seen.add(m.masterId === v[0].id ? 'A' : m.masterId === v[1].id ? 'B' : 'other'); }
  ok(seen.has('A') && seen.has('B') && !seen.has('other'), 'effective tie (2 vs 1×2) is settled by lot between exactly those two'); }
{ // 3 raw vs 2 raw doubled (=4) → the doubled player wins even though the raw count is lower
  let wins = 0; for (let i = 0; i < 12; i++) { const { m, v } = mutiny([3, 2, 0], (m, v) => m.cer.doubled.add(v[1].id)); if (m.masterId === v[1].id) wins++; }
  ok(wins === 12, 'highest MODIFIED total wins even with a lower raw count (2×2=4 beats 3)'); }
{ // pacified rebel counts for nothing → cannot take the staff
  let bad = 0; for (let i = 0; i < 12; i++) { const { m, v } = mutiny([3, 1, 0], (m, v) => m.cer.pacified.add(v[0].id)); if (m.masterId === v[0].id) bad++; }
  ok(bad === 0, 'pacified rebel (0 effective) never becomes Master'); }
{ const { m, v } = mutiny([1, 1, 0], (m, v) => m.cer.doubled.add(v[0].id)); ok(m.cer.summary && /counts as 2/.test(m.cer.summary.lines.join(' ')), 'outcome card shows the doubled value'); }
// --- countdown audio: last 5 seconds, escalating 5 → 0
function playCountdown({ total, rate = 1, packetHz = 10, fps = 60, mutate = null, extra = 0 }) {
  const ticks = []; let now = 0; const cd = new Countdown(n => ticks.push([+(now / 1000).toFixed(2), n]));
  let simLeft = total, nextPacket = 0, srv = 0;
  for (let step = 0; now <= (total / rate + 1.5 + extra) * 1000; step++) {
    now = step * (1000 / fps);
    if (now >= nextPacket) { if (mutate) { const r = mutate(now / 1000, simLeft); if (r !== undefined) simLeft = r; } cd.sample('w', Math.max(0, +simLeft.toFixed(1)), now, rate, +srv.toFixed(2)); nextPacket += 1000 / packetHz; }
    cd.update(now);
    simLeft -= (rate / fps); srv += rate / fps;
  }
  return ticks;
}
{ const t = playCountdown({ total: 8 });
  ok(t.map(x => x[1]).join() === '5,4,3,2,1,0', 'countdown ticks 5,4,3,2,1 then the final 0 (once each)');
  ok(t.every(([at, n]) => Math.abs(at - (8 - n)) < 0.12), 'ticks land on the second boundaries (±0.1 s)'); }
{ const t = playCountdown({ total: 5 }); ok(t.map(x => x[1]).join() === '5,4,3,2,1,0', 'a 5 s window (reaction) ticks the whole way'); }
{ const t = playCountdown({ total: 40, rate: 8 }); ok(t.map(x => x[1]).join() === '5,4,3,2,1,0' && Math.abs(t[0][0] - 35 / 8) < 0.15, 'honours the host time scale (×8)'); }
{ const t = playCountdown({ total: 12, mutate: (sec, left) => (sec > 3 && left > 1 ? 0.5 : undefined) });
  ok(t.length === 0, 'a window cut short (everyone voted) plays no ticks and no time-up tone'); }
{ const t = playCountdown({ total: 4, extra: 10, mutate: (sec, left) => (sec > 1 && sec < 1.15 ? 9 : undefined) });
  ok(t.map(x => x[1]).join().endsWith('5,4,3,2,1,0'), 'a window the host extends restarts the 5…0 cue'); }
{ // renderer stalls: frames/packets handled in bursts ~every 0.9 s – every second must still be announced and the time-up tone must still play
  const ticks = []; let now = 0; const cd = new Countdown(n => ticks.push(n)); let srv = 0;
  for (let batch = 0; batch < 12; batch++) {
    now += 900;                                   // the main thread was blocked for 0.9 s
    for (let k = 9; k >= 0; k--) { const s = srv + (9 - k) * 0.1; const left = 8 - s; if (left >= 0) cd.sample('w', +left.toFixed(1), now, 1, +s.toFixed(2)); }
    srv += 0.9; cd.update(now);
  }
  const have = new Set(ticks);
  ok(have.has(0) && ticks.every((n, i) => !i || n < ticks[i - 1]) && ticks.length >= 4, `stalled client (0.9 s hitches) still plays the cue in order and ends with time-up (${ticks.join(',')})`); }
{ // next window starts before the local clock reaches 0 → the finished window must still play its time-up tone
  const ticks = []; const cd = new Countdown(n => ticks.push(n));
  cd.sample('a', 3, 0, 1, 0); for (let ms = 0; ms <= 2950; ms += 50) cd.update(ms);
  cd.sample('b', 6, 2950, 1, 2.95); ok(ticks.join() === '3,2,1,0', `time-up tone is not lost when the next window arrives first (${ticks.join()})`); }
{ const ticks = []; const cd = new Countdown(n => ticks.push(n)); cd.sample(null, null, 0); cd.update(100); ok(ticks.length === 0, 'no countdown while nothing is timed (infinite debate / frozen)'); }
{ const SUBS = new Set([CER.VOTE, CER.DEBATE]); const base = { phase: 'STATE_CEREMONY', you: { id: 1 }, spy: {}, bars: {} };
  ok(countdownSources({ ...base, cer: { sub: CER.VOTE, seq: 7, t: 4, infinite: false } }, SUBS).window?.key === 'cer:7', 'vote window is a countdown source');
  ok(countdownSources({ ...base, cer: { sub: CER.DEBATE, seq: 8, t: 4, infinite: true } }, SUBS).window === null, 'infinite debate is not');
  ok(countdownSources({ ...base, cer: { sub: CER.RESULT, seq: 9, t: 2 } }, SUBS).window === null, 'outcome-card pauses are not'); }
// --- work-phase collapse countdown (Red Bar → next milestone)
{ const { m } = mk(7);
  for (const warm of [0, 0.7, 13.37]) {
    const { m: mm } = mk(7); for (let i = 0; i < Math.round(warm / 0.01); i++) mm.tick(0.01);
    const eta = mm.bars.collapseEta(); let t = 0; while (mm.phase === PHASE.WORK && t < 120) { mm.tick(0.01); t += 0.01; }
    ok(mm.phase === PHASE.FINALE && Math.abs(t - eta) < 0.05, `collapse ETA predicts the explosion (predicted ${eta.toFixed(2)}s, took ${t.toFixed(2)}s)`);
  }
  m.dbg.freezeRed = true; ok(m.bars.collapseEta() === null && m.bars.serialize().eta === null, 'no ETA while the Red Bar is frozen'); }
// --- forgotten debug overrides are made visible / can be reset in one go
{ const none = matchAffectingOverrides({ freezeRed: false, debateInfinite: false, timeScale: 1, yellowMul: 1, maxConcurrent: null, workSec: null, holdMul: 1, redX: null });
  ok(none.length === 0, 'a normal match shows no override warning');
  const bad = matchAffectingOverrides({ freezeRed: true, debateInfinite: true, timeScale: 0.2, yellowMul: 0, maxConcurrent: 1, workSec: 600, holdMul: 5 });
  ok(bad.length === 7 && bad.some(o => /endless debate/.test(o.label)) && bad.some(o => /impossible/.test(o.label)) && bad.some(o => /slow-motion/.test(o.label)), 'every match-stopping override is flagged (7 of 7)');
  const saved = clearSavedMatchOverrides({ freeze_red: { on: true }, debate_timer: { infinite: true }, yellow_mul: { m: 0 }, timescale: { s: 8 }, max_concurrent: { n: 1 }, red_tick: {}, bot_mode: { mode: 'human' }, set_timers: { timers: { vote: 9 }, workSec: 600, holdMul: 5, debateSec: 99 } });
  ok(!saved.freeze_red && !saved.debate_timer && !saved.yellow_mul && !saved.timescale && !saved.max_concurrent && !saved.set_timers.workSec && !saved.set_timers.holdMul && saved.bot_mode && saved.set_timers.timers.vote === 9, 'clearing saved overrides removes the match-stoppers but keeps unrelated settings (bots, timers)');
  const { m, P } = mk(7);
  Object.assign(m.dbg, { freezeRed: true, debateInfinite: true, yellowMul: 0, maxConcurrent: 1, workSec: 600, holdMul: 5, debateSec: 99 }); m.timeScale = 0.1;
  m.debug.run(P(0), 'reset_overrides', {});
  ok(!m.dbg.freezeRed && !m.dbg.debateInfinite && m.dbg.yellowMul === 1 && m.dbg.maxConcurrent === null && m.dbg.workSec === null && m.dbg.holdMul === 1 && m.dbg.debateSec === null && m.timeScale === 1, 'server "Reset to normal" restores every match-affecting value'); }
// --- Dark Initiation stealth: the Chaos Leader is snapped back to their spot and a blackout buffer hides the walk
{ const FACT = { FIRE: 'fire', BLOOD: 'blood', CHAOS: 'chaos' };
  const { m, P } = mk();
  const L = P(1), T = P(2);
  m.chaosLeaderId = L.id; L.faction = FACT.CHAOS; T.faction = FACT.FIRE; T.immuneChaos = false;
  m.cer.begin(1); m.cer.assemble();
  ok(L.cerSpot && typeof L.cerSpot.x === 'number', 'the ceremony records every minion\u2019s standing spot (cerSpot)');
  m.cer.setSub(CER.CURSE, 10, 'initiation');
  ok(m.list.filter(p => p.id !== L.id).every(p => p.blind) && !L.blind, 'during Dark Initiation only the Chaos Leader can see');
  const spot = { ...L.cerSpot };
  Object.assign(L.body, { x: spot.x + 6, z: spot.z + 6 });                    // Leader walks off to reach a victim
  m.cer.convert(T);
  ok(T.faction === FACT.CHAOS, 'the chosen player is converted to Chaos');
  ok(Math.hypot(L.body.x - spot.x, L.body.z - spot.z) < 0.01, 'the Leader is auto-teleported back to their original spot');
  ok(m.cer.blindHoldUntil && m.cer.blindHoldUntil > m.time, 'a blackout buffer is armed after the conversion');
  m.cer.tick(0.1);
  ok(m.list.filter(p => p.id !== L.id).every(p => p.blind), 'everyone else stays blind during the ~2 s buffer');
  m.time += 2.1; m.cer.tick(0.1);
  ok(m.list.filter(p => p.id !== L.id).every(p => !p.blind), 'vision is restored once the blackout buffer expires'); }

console.log(fails ? `\n${fails} FAILED` : '\nALL RULE TESTS PASSED');
process.exit(fails ? 1 : 0);
