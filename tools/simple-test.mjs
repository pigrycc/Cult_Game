// Simplified Mode — server rules (no network).
import { Match } from '../src/server/Match.js';
import { PHASE, CER, FACTIONS, SIMPLE_ROLE_IDS, SIMPLE_CURSES, ROLE_BY_ID } from '../src/shared/constants.js';
import { LEVER_SPOTS } from '../src/shared/map.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const sent = [];
function mk(n = 7, dbg = {}) {
  const m = new Match({ send: (pid, msg) => sent.push({ pid, msg }) });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  for (const id of ids) m.P(id).isBot = false;
  m.debug.run(m.P(ids[0]), 'simplified', { on: true });
  Object.assign(m.dbg, dbg);
  m.timers.phaseTransitionBufferSeconds = 0;
  m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016);
  return { m, ids, P: i => m.P(ids[i]) };
}
const step = (m, s = 0.05, n = 1) => { for (let i = 0; i < n; i++) m.tick(s); };
const skip = m => { m.cer.t = 0; step(m); };
/** work → ceremony → ELIMINATE */
function toEliminate(m) { m.bars.fillToNext(); skip(m); return m.cer.sub === CER.ELIMINATE; }
function toVote(m, pickFirst = true) {
  toEliminate(m);
  const mm = m.P(m.masterId), n = m.npcs.line()[0];
  m.cer.pullLever(mm, n.id, { bot: true });
  if (m.cer.sub === CER.RESULT) skip(m);
  const ex = m.eligibleExec()[0]; if (pickFirst) m.cer.nominate(ex.id);
  return m.cer.sub === CER.VOTE;
}
const voters = m => m.list.filter(p => m.cer.isVoter(p));
const chore = (m, p) => m.tasks.forceComplete(m.tasks.spawnTask('soot'), [p]);
const giveRole = (p, id) => { p.roleId = id; p.cardUsed = false; p.roleRevealed = false; };

// ---- 1. lobby-only toggle, clean start
{ const m = new Match({ send: () => {} }); const h = m.addPlayer({ name: 'H', isHost: true });
  m.debug.run(h, 'simplified', { on: true }); ok(m.dbg.simplified === true, 'Simplified Mode can be switched on in the lobby');
  for (let i = 0; i < 5; i++) m.addPlayer({ name: 'x' + i }); m.list.forEach(p => { p.isBot = false; });
  m.startGame(h.id); m.debug.run(h, 'simplified', { on: false });
  ok(m.dbg.simplified === true && m.simple === true, 'the toggle is locked while a match is running'); }
{ sent.length = 0; const { m } = mk();
  ok(m.simple && m.list.every(p => p.roleId == null), 'nobody starts with a role card');
  ok(m.list.every(p => p.crystals === 0), 'everyone starts with 0 Mana Crystals');
  const rv = sent.find(s => s.msg.t === 'reveal'); ok(rv && rv.msg.simple === true && rv.msg.roleId == null, 'the reveal shows the faction only');
  ok(m.npcs.chamber().length === 0, 'no captives in the Selection Chamber (no fetch walk)');
  m.addCrystals(m.list[0], 3); ok(m.list[0].crystals === 0, 'the crystal economy is disabled'); }

// ---- 2. role drops from chores, discard, expenditure
{ sent.length = 0; const { m, P } = mk(7, { roleDropPct: 100, yellowMul: 0 }); const p = P(2);
  chore(m, p);
  ok(SIMPLE_ROLE_IDS.includes(p.roleId) && sent.some(s => s.pid === p.id && s.msg.t === 'roleDrop' && s.msg.roleId === p.roleId), `a finished task drops a card from the Simplified pool (${ROLE_BY_ID[p.roleId]?.name})`);
  const first = p.roleId; chore(m, p);
  ok(p.roleId === first, 'a player who already holds a card gets no second one');
  ok(m.discardRole(p) && p.roleId == null, 'holding Q discards an unused card (slot empty again)');
  chore(m, p); ok(p.roleId != null, 'an empty slot can find a new card');
  p.cardUsed = true; ok(!m.discardRole(p) && p.roleId != null, 'a USED card cannot be discarded');
  const used = p.roleId; chore(m, p); ok(p.roleId === used, 'a used card blocks new drops for the rest of the match');
  const q = P(3); m.dbg.roleDropPct = 0; for (let i = 0; i < 20; i++) chore(m, q);
  ok(q.roleId == null, '0 % drop chance never gives a card');
  m.dbg.roleDropPct = 100; const held = new Set(); for (const r of m.list) { r.roleId = null; r.cardUsed = false; chore(m, r); held.add(r.roleId); }
  ok(held.size === m.list.length, `cards in play are unique while the pool lasts (${[...held].join(',')})`); }

// ---- 3. elimination by lever
{ const { m } = mk();
  ok(toEliminate(m), 'a milestone goes straight to the lever elimination');
  const line = m.npcs.line(), mm = m.P(m.masterId);
  ok(line.length === 3, '3 captives spawn in front of the portal');
  const others = m.list.filter(p => p.id !== mm.id);
  ok(others.every(p => p.frozen) && !mm.frozen, 'everyone but the Master is frozen');
  ok(line.every(n => m.npcs.authorized(mm, n)) && others.every(p => line.every(n => !m.npcs.authorized(p, n))), 'only the Master can read the captives\u2019 glyphs');
  Object.assign(mm.body, { x: 20, z: 20 }); ok(!m.cer.pullLever(mm, line[0].id), 'the lever must be in reach');
  Object.assign(mm.body, { x: LEVER_SPOTS[line[1].spot].x, z: LEVER_SPOTS[line[1].spot].z });
  ok(!m.cer.pullLever(others[0], line[1].id), 'only the Master can pull a lever');
  ok(m.cer.pullLever(mm, line[1].id), 'the Master pulls the lever next to a captive');
  ok(line[1].state === 'abyss' && m.npcs.altar().length === 2, 'its trapdoor opens: the captive falls, 2 remain');
  ok(m.cer.sub === CER.NOMINATE, 'then the Master nominates an Executioner'); }
{ const { m } = mk(7, { eliminateSec: 5 }); toEliminate(m);
  ok(Math.abs(m.cer.t - 5) < 0.2, 'the elimination timer comes from the debug setting');
  step(m, 0.1, 55); ok(m.npcs.line().length === 0 && m.npcs.altar().length === 2, 'timeout: one captive is dropped at random'); }

// ---- 4. the vote
{ const { m } = mk(); ok(toVote(m), 'nomination opens the APPROVE / MUTINY vote');
  const v = voters(m), mm = m.masterId, ex = m.execId;
  v.forEach((p, i) => m.cer.vote(p, i < 2 ? 1 : 0)); step(m, 0.1, 60);
  ok(m.cer.lastVote?.simple && !m.cer.lastVote.success && m.masterId === mm && m.cer.sub === CER.EXECUTION, `minority mutiny fails → execution (${m.cer.lastVote?.why})`);
  ok(m.execId === ex, 'the nominated Executioner executes'); }
{ const { m } = mk(7); toVote(m); const v = voters(m);                      // 5 voters → force 2-2 with one canceled
  const pac = v[4]; giveRole(v[0], 102); v.forEach((p, i) => m.cer.vote(p, i < 2 ? 1 : 0));
  m.roles.use(v[0], [pac.id]); m.cer.t = 0; step(m);
  ok(m.cer.lastVote && m.cer.lastVote.mutiny === 2 && m.cer.lastVote.approve === 2 && !m.cer.lastVote.success, 'Pacifier cancels a vote; a tie defaults to APPROVE'); }
{ const { m } = mk(7); toVote(m); const v = voters(m), oldM = m.masterId, oldE = m.execId;
  v.forEach((p, i) => m.cer.vote(p, i < 3 ? 1 : 0)); m.cer.t = 0; step(m);
  ok(m.cer.lastVote.success && m.masterId !== oldM && m.masterId !== oldE, 'strict MUTINY majority overthrows both — a random new Master');
  ok(!m.P(m.masterId).exhausted, 'the new Master is an eligible (non-exhausted) minion');
  ok(m.cer.sub === CER.NOMINATE && m.cer.skipVote, 'the new Master picks a new Executioner…');
  m.cer.nominate(m.eligibleExec()[0].id); if (m.cer.sub === CER.RESULT) skip(m);
  ok(m.cer.sub === CER.EXECUTION, '…and it goes straight to the execution (only one vote per milestone)'); }
{ const { m } = mk(9); toVote(m); const v = voters(m);
  m.exhaustedQueue = v.slice(0, 5).map(p => p.id); m.refreshExhausted();
  v.forEach(p => m.cer.vote(p, 1)); m.cer.t = 0; step(m);
  ok(m.cer.lastVote.success && !m.P(m.masterId).exhausted, 'the random Master skips exhausted minions'); }

// ---- 5. role cards (all in the vote window)
const roleCase = (id, setup) => { const ctx = mk(7); toVote(ctx.m); const v = voters(ctx.m); giveRole(v[0], id); return { ...ctx, v, caster: v[0], ...(setup ? setup(ctx.m, v) : {}) }; };
{ const { m, P } = mk(); const p = P(1); giveRole(p, 101);
  ok(!m.roles.check(p).ok, 'cards cannot be used during the Work Phase');
  toEliminate(m); ok(!m.roles.check(p).ok, '…nor during the lever elimination'); }
{ const { m, v, caster } = roleCase(101); m.roles.use(caster, []);
  v.forEach((p, i) => m.cer.vote(p, p === caster ? 1 : i <= 2 ? 1 : 0));    // caster + v1 + v2 = 3 mutiny voters, v3 v4 approve → 4 vs 2 with ×2
  m.cer.t = 0; step(m); ok(m.cer.lastVote.mutiny === 4 && m.cer.lastVote.approve === 2, 'Rebellion Instigator: own vote counts as 2'); }
{ const { m, v, caster } = roleCase(109); v.forEach((p, i) => m.cer.vote(p, i < 2 ? 1 : 0)); m.roles.use(caster, [v[4].id]); m.cer.t = 0; step(m);
  ok(m.cer.lastVote.success && m.cer.lastVote.rows.find(r => r.id === v[4].id).flipped, 'Puppet Master flips a vote (2+1 → mutiny wins 3–2)'); }
{ const { m, v, caster } = roleCase(105); const mm = m.masterId; v.forEach(p => m.cer.vote(p, 1)); m.roles.use(caster, []); m.cer.t = 0; step(m);
  ok(!m.cer.lastVote.success && m.masterId === mm, 'Loyalist blocks a unanimous mutiny'); }
{ const { m, caster } = roleCase(104); const mm = m.masterId; m.roles.use(caster, []); step(m);
  ok(m.cer.lastVote?.success && m.masterId !== mm && m.cer.sub === CER.NOMINATE, 'Old Chef overthrows immediately, no count'); }
{ const { m, v, caster } = roleCase(114); m.roles.use(caster, []); v.forEach((p, i) => m.cer.vote(p, i < 2 ? 1 : 0));
  m.cer.pacified.add(v[4].id); m.cer.t = 0; step(m); ok(m.cer.lastVote.success && m.cer.lastVote.mutiny === m.cer.lastVote.approve, 'Tiebreaker: a tie is a successful mutiny'); }
{ const { m, v, caster } = roleCase(108); m.roles.use(caster, []); v.forEach(p => m.cer.vote(p, 1)); m.cer.t = 0; step(m);
  ok(m.masterId === caster.id, 'Usurper: the caster becomes the new Master'); }
{ const { m, caster } = roleCase(103); const old = m.execId; const nx = m.eligibleExec().find(p => p.id !== old && p !== caster);
  m.roles.use(caster, [nx.id]); ok(m.execId === nx.id && m.cer.isVoter(m.P(old)) && m.cer.sub === CER.VOTE, 'Grey Eminence replaces the Executioner; the vote goes on'); }
{ const { m, v, caster } = roleCase(106); m.exhaustedQueue = [v[2].id]; m.refreshExhausted(); m.roles.use(caster, [v[2].id]);
  ok(!v[2].exhausted, 'Embalmer removes Exhaustion'); }
{ const { m, v, caster } = roleCase(110); m.roles.use(caster, [v[3].id]); ok(v[3].exhausted, 'Taskmaster exhausts a player immediately'); }
{ const { m, v, caster } = roleCase(111); const ch = m.list.find(p => p.faction === FACTIONS.CHAOS);
  ok(m.roles.validTarget(caster, 'any', ch), 'Exorcist may target a Chaos player (bluff)'); m.roles.use(caster, [v[1].id]); ok(v[1].immuneChaos, 'Exorcist grants Chaos Immunity'); }
{ const { m, v, caster } = roleCase(107); giveRole(v[1], 105); v[1].cardUsed = true; m.roles.use(caster, [v[1].id]);
  ok(!v[1].cardUsed && caster.cardUsed, 'Dark Mentor restores a used card'); }
{ sent.length = 0; const { m, caster } = roleCase(112); const before = m.npcs.altar().map(n => n.id);
  m.roles.use(caster, []); const off = sent.find(s => s.pid === caster.id && s.msg.t === 'jailerOffer');
  ok(off && off.msg.captives.length === 2 && off.msg.captives.every(c => c.faction), 'Jailer privately sees the captives\u2019 factions');
  m.cer.jailerReply(caster, true); const now = m.npcs.altar();
  ok(now.length === 3 && now.every(n => !before.includes(n.id)), 'RESPAWN: 3 brand-new captives');
  ok(now.every(n => !m.npcs.authorized(caster, n)) && now.every(n => m.npcs.authorized(m.P(m.masterId), n)), 'the Jailer does not know the new ones; the Master does'); }
{ const { m, v, caster } = roleCase(113); ok(!m.roles.check(caster).ok, 'Mirror Mage needs an already-used card');
  giveRole(v[1], 114); m.roles.use(v[1], []); caster.cardUsed = false;
  m.cer.tiebreak = false; m.roles.use(caster, [], 114); ok(m.cer.tiebreak && caster.cardUsed, 'Mirror Mage copies and triggers a used card'); }
{ const { m, v } = roleCase(101); const mm = m.P(m.masterId); giveRole(mm, 101); ok(!m.roles.check(mm).ok, 'Rebellion Instigator needs a vote (not the Master)'); }

// ---- 6. curses & events
{ const { m } = mk(); const seen = new Set(); for (let i = 0; i < 300; i++) seen.add(m.npcs.draw().curse);
  ok([...seen].every(c => SIMPLE_CURSES.includes(c)) && seen.size === 3, `only the 3 simplified curses spawn (${[...seen].join(', ')})`); }
{ const { m } = mk(); toVote(m); voters(m).forEach(p => m.cer.vote(p, 0)); m.cer.t = 0; step(m);
  const e = m.P(m.execId); const n = m.npcs.altar()[0]; n.curse = 'DARK_INITIATION'; if (e.faction === FACTIONS.CHAOS) e.faction = FACTIONS.FIRE; e.immuneChaos = false;
  m.cer.sacrificeNpc(n); ok(e.faction === FACTIONS.CHAOS, 'Dark Initiation converts the Executioner'); }
{ const { m } = mk(); toVote(m); voters(m).forEach(p => m.cer.vote(p, 0)); m.cer.t = 0; step(m);
  const e = m.P(m.execId); const n = m.npcs.altar()[0]; n.curse = 'DARK_INITIATION'; e.faction = FACTIONS.BLOOD; e.immuneChaos = true;
  m.cer.sacrificeNpc(n); ok(e.faction === FACTIONS.BLOOD, '…unless the Executioner is immune'); }
{ const { m } = mk(); toVote(m); voters(m).forEach(p => m.cer.vote(p, 0)); m.cer.t = 0; step(m);
  const mm = m.P(m.masterId); const n = m.npcs.altar()[0]; n.curse = 'EYE_OF_TRUTH'; m.cer.sacrificeNpc(n);
  ok(m.cer.sub === CER.CURSE && m.cer.mode === 'eye' && m.cer.eyeHolder() === mm.id && !mm.frozen, 'Insight Eye: the MASTER inspects (not the Executioner)');
  const t = m.list.find(p => p.id !== mm.id); m.cer.lmb(mm, t.id); Object.assign(t.body, { x: mm.body.x + 1, z: mm.body.z }); m.cer.lmb(mm, t.id);
  ok(mm.known.get(t.id) === t.faction, 'the Master privately learns that faction'); }
{ const { m } = mk(); toVote(m); voters(m).forEach(p => m.cer.vote(p, 0)); m.cer.t = 0; step(m);
  const old = m.masterId; const n = m.npcs.altar()[0]; n.curse = 'TOXIC_FUMES'; m.cer.sacrificeNpc(n);
  ok(m.masterId !== old && m.P(old).fumesT > 0, 'Toxic Fumes overthrows the Master and makes the duo drunk'); }
{ const { m } = mk(); m.dbg.forcedEvent = 'FLOGGING'; toEliminate(m); ok(m.cer.eventKey === 'EMPTY', 'milestone events are off by default'); }
{ const { m } = mk(7, { simpleEvents: true }); m.dbg.forcedEvent = 'FLOGGING'; toEliminate(m); ok(m.cer.eventKey === 'FLOGGING', '…and can be switched back on from the debug menu'); }

// ---- 7. bots-only Simplified games finish
for (const n of [5, 7, 9, 11]) {
  const m = new Match({ send: () => {} });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id; m.bots.spawn(n - 1);
  Object.assign(m.dbg, { botMode: 'human', simplified: true, roleDropPct: 60 });
  m.timers.revealBack = m.timers.revealFront = 0.5; m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  let t = 0, cards = 0, used = 0, votes = 0, last = null;
  while (t < 30 * 60 && m.phase !== PHASE.FINALE) {
    m.tick(0.05); t += 0.05;
    if (m.cer.lastVote?.simple && m.cer.lastVote !== last) { last = m.cer.lastVote; votes++; }
  }
  cards = m.list.filter(p => p.roleId).length; used = m.usedRoles.size;
  ok(m.phase === PHASE.FINALE && t / 60 <= 20, `${n} Humanlike bots, Simplified Mode: match ends after ${(t / 60).toFixed(1)} min (${votes} votes, ${cards} cards held, ${used} used) — winner ${m.winner}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nSIMPLIFIED MODE TESTS PASSED');
process.exit(fails ? 1 : 0);
