// Regression tests for the "feedback round" batch (v0.9.14):
//   - debug voice range slider affects proximity falloff
//   - Toxic Fumes never passes the staff to an Exhausted minion unless all eligible are exhausted
//   - Jailer RESPAWN spawns 2 fresh captives (Simplified)
//   - collect source items exist as visible world props BEFORE pickup (and survive a drop)
//   - bot Master walks up to its target before nominating the Executioner
//   - co-op station interaction pings the paired partner
//   node tools/feedback-round-test.mjs
import { Match } from '../src/server/Match.js';
import { CER, FACTIONS } from '../src/shared/constants.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function makeMatch(nBots = 0, nHumans = 5) {
  const sent = [];
  const m = new Match({ send: (id, msg) => sent.push({ id, msg }) });
  const hid = m.addPlayer({ name: 'Host', isHost: true }).id;
  if (nBots) m.bots.spawn(nBots);
  for (let i = 0; m.players.size < nHumans; i++) m.addPlayer({ name: 'P' + i });
  m.startGame(hid); m.phaseT = 0; m.tick(0.016);
  return { m, hid, sent };
}

// ---------------------------------------------------------------- 1. voice range debug slider
{
  const { m } = makeMatch(0, 5);
  const [sp, l] = m.list;
  sp.body.x = 0; sp.body.z = 0; l.body.x = 10; l.body.z = 0;      // 10 units apart, clear line of sight assumed by test positions
  m.dbg.voiceRange = 20;
  const far = m.voiceGain(sp, l).gain;
  m.dbg.voiceRange = 8;                                            // shrink the radius below the distance
  const muted = m.voiceGain(sp, l).gain;
  m.dbg.voiceRange = 40;                                           // widen it → louder than the default 20
  const wide = m.voiceGain(sp, l).gain;
  ok(far > 0, `at range 20 a listener 10 units away still hears the speaker (gain ${far.toFixed(2)})`);
  ok(muted === 0, 'shrinking the debug voice range to 8 cuts off a listener 10 units away');
  ok(wide > far, `widening the range to 40 makes the same listener louder (${wide.toFixed(2)} > ${far.toFixed(2)})`);
}

// ---------------------------------------------------------------- 2. Toxic Fumes avoids Exhausted minions
{
  const { m } = makeMatch(0, 6);
  const cer = m.cer;
  cer.master = null; // (unused) — toxicFumes reads m via this.M/this.E
  // make everyone a candidate, then exhaust all but one eligible minion
  const old = m.P(m.masterId);
  const others = m.living.filter(p => p.id !== old.id && p.id !== m.execId);
  // exhaust every eligible candidate except exactly one
  const keepFresh = others[0];
  for (const p of others.slice(1)) { m.exhaustedQueue.push(p.id); }
  m.refreshExhausted();
  cer.toxicFumes();
  ok(m.masterId === keepFresh.id, 'Toxic Fumes hands the staff to the only non-exhausted eligible minion');

  // now exhaust EVERYONE eligible → it must still appoint someone (fallback), not hang
  const { m: m2 } = makeMatch(0, 6);
  const old2 = m2.P(m2.masterId);
  const elig2 = m2.living.filter(p => p.id !== old2.id && p.id !== m2.execId);
  for (const p of elig2) m2.exhaustedQueue.push(p.id);
  m2.refreshExhausted();
  const prevMaster = m2.masterId;
  m2.cer.toxicFumes();
  ok(m2.masterId && elig2.some(p => p.id === m2.masterId) && m2.masterId !== prevMaster,
     'when every eligible minion is exhausted, Toxic Fumes still passes the staff (no deadlock)');
}

// ---------------------------------------------------------------- 3. collect items are visible world props before pickup
{
  const { m } = makeMatch(0, 5);
  m.dbg.maxConcurrent = 0;
  for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t);
  const inst = m.tasks.spawnTask('specimens');
  const propsBefore = [...m.tasks.items.values()].filter(i => i.taskUid === inst.uid && !i.heldBy);
  ok(propsBefore.length === 3, `3 Glowing Specimen props exist in the world before anyone picks them up (${propsBefore.length})`);
  ok(propsBefore.every(i => i.type === 'specimen'), 'the pre-spawned props are the correct item type');

  // scrap too
  for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t);
  const scrapInst = m.tasks.spawnTask('scrap');
  const scrapProps = [...m.tasks.items.values()].filter(i => i.taskUid === scrapInst.uid && !i.heldBy);
  ok(scrapProps.length === 3 && scrapProps.every(i => i.type === 'scrap'), 'Scrap Metal also pre-spawns as 3 visible props');

  // a picked-up collect item that is dropped loose stays in the world (not deleted)
  const p = m.list[0];
  const it = scrapProps[0];
  it.heldBy = p.id; p.heldItem = it.id; scrapInst.data.carrier = p.id;
  m.tasks.dropItem(p);
  ok(m.tasks.items.has(it.id) && !m.tasks.items.get(it.id).heldBy, 'dropping a collect item leaves it on the floor (still visible), not vanished');
  ok(scrapInst.data.carrier === null, 'dropping frees the carrier slot so the task can continue');
}

// ---------------------------------------------------------------- 4. Jailer RESPAWN → 2 fresh captives (Simplified)
{
  const { m } = makeMatch(0, 5);
  m.simple = true;
  m.npcs.spawnLine('altar');
  const before = m.npcs.altar().map(n => n.id);
  m.cer.jailer = { id: m.list[0].id, pending: true };
  m.cer.sub = CER.VOTE;
  m.cer.jailerReply(m.list[0], true);
  const now = m.npcs.altar();
  ok(now.length === 2, `Jailer RESPAWN leaves exactly 2 captives at the portal (${now.length})`);
  ok(now.every(n => !before.includes(n.id)), 'the 2 captives are brand-new (the old ones were sent to the abyss)');
}

// ---------------------------------------------------------------- 5. bot Master walks up before nominating
{
  const { m } = makeMatch(6, 7);
  Object.assign(m.dbg, { botMode: 'human', freezeRed: true });
  const master = m.list.find(p => p.isBot);
  m.masterId = master.id;
  m.bars.fillToNext();
  // advance to NOMINATE
  let t = 0; while (t < 25 && m.cer.sub !== CER.NOMINATE) { m.tick(0.05); t += 0.05; }
  ok(m.cer.sub === CER.NOMINATE, 'reached the NOMINATE step with a bot Master');
  // capture distance to the eventual target at the moment of nomination
  let nominatedAt = null, distAtNom = null;
  const orig = m.cer.nominate.bind(m.cer);
  m.cer.nominate = (id, e) => {
    const tgt = m.P(id); const dx = tgt.body.x - master.body.x, dz = tgt.body.z - master.body.z;
    nominatedAt = t; distAtNom = Math.hypot(dx, dz); return orig(id, e);
  };
  while (t < 40 && nominatedAt === null) { m.tick(0.05); t += 0.05; }
  ok(nominatedAt !== null, 'the bot Master eventually nominates an Executioner');
  ok(distAtNom !== null && distAtNom < 2.4, `the bot Master is standing next to its target when it nominates (dist ${distAtNom?.toFixed(2)} < 2.4)`);
}

// ---------------------------------------------------------------- 6. co-op station pings the partner
{
  const { m, sent } = makeMatch(0, 5);
  m.dbg.maxConcurrent = 0;
  for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t);
  // find a coop task and assign two players as partners
  const coopKey = ['capstan', 'ash', 'calib'].find(k => { try { const i = m.tasks.spawnTask(k); const ok2 = i?.def.type?.startsWith('coop'); if (!ok2) m.tasks.removeTask(i); return ok2; } catch { return false; } });
  for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t);
  const inst = m.tasks.spawnTask(coopKey || 'capstan');
  const [a, b] = m.list;
  inst.kind = 'coop'; inst.assignedTo = [a.id, b.id];
  sent.length = 0;
  m.tasks.pingCoopPartner(a, inst);
  const ping = sent.find(s => s.id === b.id && s.msg.t === 'coopPing');
  ok(!!ping, 'engaging a co-op station sends a coopPing to the paired partner');
  ok(ping && ping.msg.from === a.name && typeof ping.msg.x === 'number', 'the ping names who called and where to go');
  // a partner already working the task is not nagged
  sent.length = 0;
  b.hold = { uid: inst.uid };
  inst.data.pingAt = -99;
  m.tasks.pingCoopPartner(a, inst);
  ok(!sent.some(s => s.msg.t === 'coopPing'), 'no ping is sent when the partner is already on the station');
}

console.log(fails ? `\n${fails} FAILED` : '\nFEEDBACK-ROUND TESTS PASSED');
process.exit(fails ? 1 : 0);
