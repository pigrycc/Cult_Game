// ============================================================================
//  CEREMONY — Master & Executioner, Mutiny (Mana Crystal rebellion), portal
//  execution, NPC curses, milestone events and the debate window.
//
//  ANNOUNCE(3s) → teleport to the rune circle, barriers up, Red Bar frozen
//   └▶ NOMINATE  (Master LMB-taps an eligible minion; Grey Eminence/Embalmer)
//       └▶ VOTE  ("Do you agree?"  Yes / 1 / 2 / 3 crystals; VOTE-window roles)
//           └▶ COUNT    (sequential reveal vs threshold)
//               └▶ REACTION (Instigator, Pacifier, Tribune, Machiavellian, Fanatic)
//                   ├─ success → crystals lost, top rebel = new Master → NOMINATE
//                   └─ fail    → EXECUTION (Executioner lifts & throws 1 captive)
//                                 └▶ CURSE (glyph effect) → EVENT (milestone) → DEBATE
//                                      → exhaustion, barriers drop → WORK
// ============================================================================
import { PHASE, CER, CURSES, FACTIONS, MILESTONE_EVENTS, FACTION_INFO, ceilHalf, ROLE_BY_ID } from '../shared/constants.js';
import { ceremonyCircle, MASTER_SPOT, PORTAL, LEVER_SPOTS } from '../shared/map.js';
import { pick, shuffle, dist2 } from './util.js';

export class Ceremony {
  constructor(m) { this.m = m; this.reset(); }

  reset() {
    this.sub = null; this.t = 0; this.mode = null; this.milestone = 0; this.eventKey = null;
    this.resetRebellion();
    this.reveal = []; this.result = null; this.presidingMaster = null; this.chaosSacrificed = false; this.lastSacrifice = null;
    this.summary = null; this.after = null; this.blindHoldUntil = null;
  }

  resetRebellion() {
    this.votes = new Map(); this.final = new Map();
    this.sealed = new Set(); this.provoked = new Set(); this.doubled = new Set(); this.pacified = new Set();
    this.anarchy = false; this.tribune = false; this.machi = null; this.fanatical = null; this.nominatedBy = null;
    this.reveal = []; this.result = null; this.eminence = false;
    // Simplified Mode vote modifiers (all played during the single Mutiny Vote window)
    this.instig = new Set(); this.puppet = new Set(); this.loyal = false; this.tiebreak = false; this.usurper = null;
    this.forceOutcome = null; this.jailer = null;
  }

  get M() { return this.m.P(this.m.masterId); }
  get E() { return this.m.P(this.m.execId); }

  // --------------------------------------------------------------- entry
  begin(milestoneNum) {
    const m = this.m;
    m.ceremonyIndex = milestoneNum;
    this.milestone = milestoneNum;
    const isFinal = milestoneNum >= m.bars.M;
    const raw = isFinal ? 'FINAL' : (m.dbg.forcedEvent || m.track[milestoneNum - 1] || 'EMPTY');
    // Simplified Mode: milestone events are off unless the debug toggle turns them on (the final tally always happens)
    this.eventKey = m.simple && raw !== 'FINAL' && (!m.dbg.simpleEvents || raw === 'RENEWAL') ? 'EMPTY' : raw;
    this.chaosSacrificed = false; this.lastSacrifice = null;
    this.voteDone = false; this.skipVote = false; this.levers = [false, false, false]; this.leversShown = false;
    m.log(`Milestone ${milestoneNum}/${m.bars.M} reached — the ceremony begins (event: ${eventNameOf(this.eventKey)}).`, 'ceremony');
    m.setPhase(PHASE.CEREMONY);
    for (const p of m.list) { p.gagged = false; m.releaseHold(p, 'silent'); }
    m.bigAll('Well Done — Execution in 3 sec', `Milestone ${milestoneNum}/${m.bars.M} reached • The Red Bar is frozen`, 3, '#ffe28a');
    m.fx('milestone');
    this.setSub(CER.ANNOUNCE, m.timers.announce);
  }

  /**
   * Phase-transition buffer: show an outcome summary card to everyone for
   * timers.phaseTransitionBufferSeconds, then continue with `next`. 0 = skip (debug).
   * summary = { icon, title, color, lines: [string] }
   */
  pause(summary, next) {
    const b = +this.m.timers.phaseTransitionBufferSeconds || 0;
    this.m.log(`${summary.icon || ''} ${summary.title}${summary.lines?.length ? ' — ' + summary.lines.join('; ') : ''}`, 'ceremony');
    if (b <= 0) { this.summary = null; return next(); }
    this.summary = summary; this.after = next;
    this.setSub(CER.RESULT, b, summary.kind || null);
  }

  crystalSnapshot() { return new Map(this.m.list.map(p => [p.id, p.crystals])); }
  crystalDeltas(before) {
    const out = [];
    for (const p of this.m.list) {
      const d = p.crystals - (before.get(p.id) ?? p.crystals);
      if (d) out.push(`${p.name}: ${d > 0 ? '+' : ''}${d} 💎 (now ${p.crystals})`);
    }
    return out;
  }

  setSub(s, t, mode = null) {
    this.sub = s; this.t = t; this.mode = mode; this.subStart = this.m.time;
    this.seq = (this.seq || 0) + 1;              // identifies this timed window for the client countdown audio
    this.applyFreeze();
  }

  applyFreeze() {
    const m = this.m, s = this.sub, mode = this.mode;
    const free = new Set();
    let blindAllBut = null;
    if (s === CER.ANNOUNCE || s === CER.DEBATE || (s === CER.EVENT && mode === 'LIVING')) m.list.forEach(p => free.add(p.id));
    if ([CER.ELIMINATE, CER.NOMINATE, CER.VOTE, CER.COUNT, CER.REACTION].includes(s)) free.add(m.masterId);
    if (s === CER.EXECUTION) { free.add(m.execId); free.add(m.masterId); }
    if (s === CER.CURSE) {
      if (mode === 'eye') { free.add(this.eyeHolder()); blindAllBut = this.eyeHolder(); }
      if (mode === 'abyss') free.add(m.masterId);
      if (mode === 'initiation') { free.add(m.chaosLeaderId); blindAllBut = m.chaosLeaderId; }
    }
    if (s === CER.EVENT && ['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(mode)) {
      free.add(m.masterId);
      if (mode === 'INSPECTION') blindAllBut = m.masterId;
    }
    // Dark Initiation blackout buffer: hold everyone-but-the-Leader blind for a moment after the conversion so the
    // Leader's walk back to their spot is never seen (persists into the result card until blindHoldUntil passes).
    if (this.blindHoldUntil && m.time < this.blindHoldUntil) blindAllBut = m.chaosLeaderId;
    for (const p of m.list) {
      p.frozen = !free.has(p.id);
      p.blind = blindAllBut != null && p.id !== blindAllBut;
      if (p.frozen) { p.body.vx = p.body.vz = 0; }
    }
  }

  // --------------------------------------------------------------- tick
  tick(dt) {
    if (!(this.sub === CER.DEBATE && this.m.dbg.debateInfinite)) this.t -= dt;
    if (this.sub === CER.REACTION && this.fanatical && this.fanatical.pending && this.t <= 0.05) this.fanaticalReply(this.m.P(this.fanatical.target), false);
    // lift the Dark Initiation blackout the instant it expires (re-applies freeze/vision for this sub-state)
    if (this.blindHoldUntil && this.m.time >= this.blindHoldUntil) { this.blindHoldUntil = null; this.applyFreeze(); }
    if (this.t <= 0) this.timeout();
  }

  timeout() {
    const m = this.m;
    switch (this.sub) {
      case CER.ANNOUNCE: this.assemble(); break;
      case CER.ELIMINATE: { const n = pick(m.npcs.line()); if (n) this.eliminate(n, true); else this.startNomination(); break; }
      case CER.NOMINATE: {
        const forced = m.dbg.forcedDuo?.exec;
        const el = m.eligibleExec();
        const t = (forced && m.P(forced)) ? m.P(forced) : (el.length ? pick(el) : pick(m.living.filter(p => p.id !== m.masterId)));
        if (t) { m.toastAll(`Time's up — the crypt nominates ${t.name}.`); this.nominate(t.id); }
        break;
      }
      case CER.VOTE: if (m.simple) this.resolveSimple(); else this.count(); break;
      case CER.COUNT: this.setSub(CER.REACTION, m.timers.reaction); m.bigAll('REACTION TIME', 'Abilities that alter the rebellion may be revealed now [G]', 2.5, '#ff9de2'); break;
      case CER.REACTION: this.resolveRebellion(); break;
      case CER.EXECUTION: {
        const e = this.E;
        let n = e && e.carryingNpc ? m.npcs.npcs.get(e.carryingNpc) : null;
        if (e) e.carryingNpc = null;
        if (!n) n = pick(m.npcs.altar());
        if (n) { m.toastAll('The Executioner hesitated — the portal takes a captive by itself!', 'warn'); this.sacrificeNpc(n); }
        else this.startEvent();
        break;
      }
      case CER.CURSE:
        if (this.mode === 'eye') { const c = this.slapCandidates(this.eyeHolder()); if (c.length) this.eyeReveal(pick(c)); else this.startEvent(); }
        else if (this.mode === 'abyss') { const c = this.slapCandidates(m.masterId); if (c.length) this.giveKey(pick(c)); else this.startEvent(); }
        else if (this.mode === 'initiation') { const c = this.initiationCandidates(); if (c.length) this.convert(pick(c)); else this.startEvent(); }
        else this.startEvent();
        break;
      case CER.EVENT:
        if (this.mode === 'INSPECTION' || this.mode === 'MUTENESS' || this.mode === 'FLOGGING') {
          const c = this.slapCandidates(m.masterId);
          if (c.length) this.eventSlap(pick(c)); else this.startDebate();
        } else if (this.mode === 'LIVING') {
          const mm = this.M;
          let v = mm && mm.carryingPlayer ? m.P(mm.carryingPlayer) : null;
          if (!v) v = pick(this.slapCandidates(m.masterId));
          if (v) { m.toastAll('The portal hungers — it drags in a living minion!', 'warn'); this.throwLiving(v); } else this.startDebate();
        } else this.startDebate();
        break;
      case CER.DEBATE: this.end(); break;
      case CER.RESULT: { const fn = this.after; this.after = null; this.summary = null; if (fn) fn(); break; }
      default: break;
    }
  }

  // --------------------------------------------------------------- assembly
  assemble() {
    const m = this.m;
    if (!m.simple) m.npcs.prepareCeremony();          // Simplified Mode spawns its 3 captives at the portal instead
    const others = m.list.filter(p => p.id !== m.masterId);
    const spots = ceremonyCircle(Math.max(others.length, 1));
    others.forEach((p, i) => { m.teleport(p, spots[i].x, spots[i].z, spots[i].yaw); p.cerSpot = { x: spots[i].x, z: spots[i].z, yaw: spots[i].yaw }; });
    const mm = this.M;
    if (mm) { m.teleport(mm, MASTER_SPOT.x, MASTER_SPOT.z, 0); mm.cerSpot = { x: MASTER_SPOT.x, z: MASTER_SPOT.z, yaw: 0 }; }
    if (m.simple) return this.startElimination();
    this.startNomination();
  }

  // --------------------------------------------------------------- Simplified Mode: lever elimination (3 → 2)
  startElimination() {
    const m = this.m, mm = this.M;
    const line = m.npcs.spawnLine();
    if (mm) for (const n of line) mm.knownNpcs.add(n.id);        // ONLY the Master can read the glyphs
    this.levers = [false, false, false]; this.leversShown = true;
    this.setSub(CER.ELIMINATE, Math.max(1, +m.dbg.eliminateSec || 20));
    m.bigAll(`${mm?.name ?? '?'} decides which captive falls`, 'Three captives stand on trapdoors. The Master pulls ONE lever — everyone else is frozen.', 3.5, '#c58bff', mm ? [m.av(mm)] : null);
    if (mm) m.toast(mm.id, '👁️ Only you can read the glyphs: aim at a captive to read it, then walk to its lever and press E to drop it into the abyss.');
  }

  /** Master pulls the lever next to a captive → its trapdoor opens. Bots skip the walk. */
  pullLever(p, npcId, { bot = false } = {}) {
    const m = this.m;
    if (this.sub !== CER.ELIMINATE || !p || p.id !== m.masterId) return false;
    const n = m.npcs.npcs.get(npcId);
    if (!n || n.state !== 'line') return false;
    if (!bot && dist2(p.body, LEVER_SPOTS[n.spot]) > 2.8) { m.toast(p.id, 'Walk up to the lever first.'); return false; }
    this.eliminate(n, false);
    return true;
  }

  eliminate(n, auto) {
    const m = this.m, mm = this.M;
    this.levers[n.spot] = true;
    m.npcs.toAbyss(n); m.npcs.lineToAltar();
    m.log(auto ? 'Time ran out — the crypt dropped a random captive into the abyss.' : `${mm?.name ?? 'The Master'} pulled a lever: a captive fell into the abyss.`, 'ceremony');
    this.pause({ icon: '🕳️', color: '#c58bff', title: auto ? "Time's up — a trapdoor opens at random" : `${mm?.name ?? 'The Master'} pulled a lever`,
      lines: ['A captive fell into the abyss — 2 remain in front of the portal.', `${mm?.name ?? 'The Master'} now nominates the Executioner.`] }, () => this.startNomination());
  }

  startNomination(skipVote = false) {
    const m = this.m;
    this.resetRebellion();
    this.skipVote = !!skipVote;
    m.execId = null;
    this.setSub(CER.NOMINATE, m.timers.nominate);
    const mm = this.M;
    m.bigAll(`${mm?.name ?? '?'} is the Master of Ceremonies`, `${mm?.name ?? '?'} — choose an executioner (LMB on a minion)`, m.timers.nominate, '#ffd75e', mm ? [m.av(mm)] : null);
    if (mm) m.toast(mm.id, 'Aim at an eligible minion and press LMB to nominate your Executioner. (💤 exhausted / 🤐 muted / 👻 ghosts are not eligible)');
    if (m.dbg.forcedDuo?.exec && m.P(m.dbg.forcedDuo.exec) && m.dbg.forcedDuo.exec !== m.masterId) this.nominate(m.dbg.forcedDuo.exec);
  }

  nominate(id, byEminence = false) {
    const m = this.m;
    const t = m.P(id);
    if (!t || t.ghost || id === m.masterId) return false;
    m.execId = id;
    this.eminence = byEminence;
    m.fx('nominate', { id });
    m.log(`${this.M?.name} nominated ${t.name} as Executioner${byEminence ? ' (Grey Eminence)' : ''}.`, 'ceremony');
    if (m.simple && this.skipVote) {                        // ONE mutiny vote per milestone: the new duo goes straight to work
      m.appoint(t, 'exec', this.M); this.nominatedBy = m.masterId;
      return this.pause({ icon: '🪓', color: '#ff8a6a', title: `${t.name} is the new Executioner`, lines: ['Only one mutiny vote per milestone — straight to the execution.'] }, () => this.startExecution()) ?? true;
    }
    this.setSub(CER.VOTE, m.timers.vote);
    const by = byEminence && byEminence !== true ? byEminence : this.M;
    const pair = [m.av(by), m.av(t)];
    for (const p of m.list) {
      if (p.id === t.id) continue;
      if (this.isVoter(p) && m.simple) m.big(p.id, `${by?.name ?? '?'} nominated ${t.name} as Executioner`, 'APPROVE or MUTINY? Role cards can be played now [G]', 2.5, '#ffd75e', pair);
      else if (this.isVoter(p)) m.big(p.id, `${by?.name ?? '?'} nominated ${t.name} as Executioner`, 'Do you agree? Choose below — crystals are only spent if the mutiny succeeds', 2.5, '#ffd75e', pair);
      else m.big(p.id, `${by?.name ?? '?'} nominated ${t.name} as Executioner`, 'The crew is deciding whether to rebel...', 2.5, '#ffd75e', pair);
    }
    m.appoint(t, 'exec', by);
    this.nominatedBy = by?.id ?? null;
    m.botChat.onNomination(this.M, t, by);
    return true;
  }

  isVoter(p) { return p && !p.ghost && p.id !== this.m.masterId && p.id !== this.m.execId; }

  vote(p, amount) {
    if (this.sub !== CER.VOTE || !this.isVoter(p)) return;
    if (this.m.simple) { this.votes.set(p.id, (amount | 0) > 0 ? 1 : 0); return this.checkTurnout(); }   // 0 = APPROVE, 1 = MUTINY
    amount = Math.max(0, Math.min(3, amount | 0));
    if (this.sealed.has(p.id) && amount > 0) return this.m.toast(p.id, '🤫 You are sealed — you cannot play crystals this time.', 'warn');
    if (this.anarchy) amount = Math.min(1, amount);
    if (amount > p.crystals && !p.infiniteMana) return this.m.toast(p.id, 'Not enough Mana Crystals.', 'warn');
    this.votes.set(p.id, amount);
    this.checkTurnout();
  }

  /** Every eligible voter has decided (sealed minions count as decided) → close the window early. */
  checkTurnout() {
    if (this.sub !== CER.VOTE) return;
    const voters = this.m.list.filter(q => this.isVoter(q));
    if (voters.length && voters.every(q => this.votes.has(q.id) || this.sealed.has(q.id))) this.t = Math.min(this.t, this.m.simple ? 4 : 0.5);   // simplified: a few seconds left for role cards
  }

  get baseThreshold() {
    const m = this.m;
    if (this.anarchy) return 1;
    return m.dbg.mutinyThreshold ?? m.balance.threshold;
  }
  get threshold() { return this.tribune ? ceilHalf(this.baseThreshold) : this.baseThreshold; }

  count() {
    const m = this.m;
    this.final = new Map();
    for (const p of m.list) {
      if (!this.isVoter(p)) continue;
      let v = this.votes.get(p.id) ?? 0;
      if (this.sealed.has(p.id)) v = 0;
      if (this.provoked.has(p.id) && (p.crystals >= 1 || p.infiniteMana)) v = Math.max(1, v);
      if (this.anarchy) v = Math.min(1, v);
      if (!p.infiniteMana) v = Math.min(v, p.crystals);
      this.final.set(p.id, v);
    }
    this.reveal = [...this.final.entries()].map(([id, v]) => ({ id, name: m.P(id).name, amount: v }));
    this.setSub(CER.COUNT, Math.max(m.timers.count, 0.4 * this.reveal.length + 1));
    m.fx('count');
  }

  /** Crystals a minion counts for AFTER role abilities (Instigator ×2, Pacifier → 0). */
  effective(id) {
    if (this.pacified.has(id)) return 0;
    return (this.final.get(id) || 0) * (this.doubled.has(id) ? 2 : 1);
  }
  total() {
    let s = 0;
    for (const id of this.final.keys()) s += this.effective(id);
    return s;
  }
  rebels() { return [...this.final.entries()].filter(([id, v]) => v > 0 && !this.pacified.has(id)).map(([id]) => this.m.P(id)); }

  resolveRebellion() {
    const m = this.m;
    const total = this.total(), th = this.threshold;
    const success = total > 0 && total >= th;
    this.result = { total, threshold: th, success };
    if (!success) {
      m.bigAll(total > 0 ? 'The Rebellion Fails' : 'The Crew Agrees', `${total}/${th} crystals — crystals return to their owners. ${this.E?.name} will execute.`, 3, '#c0c0c0');
      const rebelsF = this.rebels();
      return this.pause({
        icon: total > 0 ? '🛡️' : '🤝', color: '#d0d0d0', title: total > 0 ? `Rebellion fails (${total}/${th} 💎)` : `The crew agrees (0/${th} 💎)`,
        lines: [
          ...(rebelsF.length ? [`Rebels: ${rebelsF.map(r => `${r.name} (${this.final.get(r.id)})`).join(', ')} — crystals returned`] : ['Nobody played a crystal']),
          `${this.M?.name} stays Master • ${this.E?.name} will execute`,
        ],
      }, () => this.startExecution());
    }
    const rebels = this.rebels();
    const oldMaster = this.M;
    // The highest EFFECTIVE contribution (after role abilities such as the Instigator's doubling) takes
    // the staff; only a tie of effective totals is settled at random. Muted minions cannot run for Master.
    const cands = rebels.filter(r => !r.muted);
    const pool = cands.length ? cands : rebels;
    const best = Math.max(...pool.map(r => this.effective(r.id)));
    const leaders = pool.filter(r => this.effective(r.id) === best);
    const newMaster = pick(leaders);
    const tieLine = leaders.length > 1 ? [`Tie at ${best} effective 💎 between ${leaders.map(l => l.name).join(' & ')} — settled by lot`] : [];
    for (const r of rebels) {
      const v = this.final.get(r.id);
      m.addCrystals(r, -v);                                  // lost permanently
      if (r.roleId === 3 && r.roleRevealed) m.addCrystals(r, 1);   // Rune Master recovers 1
      if (this.machi === r.id && r.id !== newMaster.id) { m.addCrystals(r, v); m.toast(r.id, '🎭 Machiavellian: your crystals return to your pouch.'); }
    }
    const lossLines = rebels.map(r => {
      const raw = this.final.get(r.id), eff = this.effective(r.id);
      return `${r.name}: −${raw} 💎 played${eff !== raw ? ` (×2 → counts as ${eff})` : ''} (now ${r.crystals})`;
    });
    m.masterId = newMaster.id; newMaster.servedMaster++;
    m.execId = null;
    this.grantAltarVision(newMaster);
    m.fx('rebellion');
    m.bigAll('REBELLION SUCCEEDS!', `${total}/${th} crystals • ${newMaster.name} seizes the ceremonial staff. The old duo is spared exhaustion.`, 3.5, '#ff5c5c');
    m.log(`Rebellion succeeded (${total}/${th}). ${newMaster.name} is the new Master.`, 'ceremony');
    // Swap places: old master into the circle, new master to the centre
    if (oldMaster) m.teleport(oldMaster, newMaster.body.x, newMaster.body.z, newMaster.body.yaw);
    m.teleport(newMaster, MASTER_SPOT.x, MASTER_SPOT.z, 0);
    m.appoint(newMaster, 'master');
    this.pause({
      icon: '⚔️', color: '#ff6b6b', title: `Rebellion succeeds (${total}/${th} 💎)`,
      lines: [`${oldMaster?.name ?? '?'} is overthrown — ${newMaster.name} seizes the staff`, ...tieLine, ...lossLines, 'The old duo is spared exhaustion • a new nomination follows'],
    }, () => this.startNomination());
  }

  // --------------------------------------------------------------- Simplified Mode: APPROVE vs MUTINY
  /** Weighted tally after the vote modifiers (unvoted = APPROVE; Pacifier → 0, Instigator → 2, Puppet Master flips). */
  simpleTally() {
    let mut = 0, app = 0; const rows = [];
    for (const p of this.m.list) {
      if (!this.isVoter(p)) continue;
      let v = this.votes.get(p.id) ?? 0;
      const flipped = this.puppet.has(p.id); if (flipped) v = 1 - v;
      const w = this.pacified.has(p.id) ? 0 : this.instig.has(p.id) ? 2 : 1;
      if (v) mut += w; else app += w;
      rows.push({ id: p.id, name: p.name, mutiny: !!v, w, flipped, voted: this.votes.has(p.id) });
    }
    return { mut, app, rows };
  }

  resolveSimple() {
    const m = this.m;
    if (this.sub !== CER.VOTE) return;
    this.voteDone = true;
    if (this.jailer?.pending) this.jailer.pending = false;            // no answer from the Jailer = keep
    const T = this.simpleTally(), chef = this.forceOutcome === 'chef';
    let success, why;
    if (this.loyal) { success = false; why = '🛡️ The Loyalist blocked the mutiny — the duo stays in power'; }
    else if (chef) { success = true; why = '🍲 The Old Chef overthrew the duo without counting votes'; }
    else if (T.mut > T.app) { success = true; why = `Strict majority for MUTINY (${T.mut} vs ${T.app})`; }
    else if (T.mut === T.app && this.tiebreak) { success = true; why = `Tie ${T.mut}–${T.app} — ⚖️ the Tiebreaker turns it into a mutiny`; }
    else { success = false; why = T.mut === T.app ? `Tie ${T.mut}–${T.app} — a tie defaults to APPROVE` : `APPROVE wins (${T.app} vs ${T.mut})`; }
    this.result = this.lastVote = { simple: true, mutiny: T.mut, approve: T.app, success, why, rows: T.rows, milestone: this.milestone };
    const votes = chef ? [] : [`Votes: ${T.rows.map(r => `${r.name} ${r.mutiny ? '⚔️' : '🤝'}${r.w === 2 ? '×2' : ''}${r.w === 0 ? ' (canceled)' : ''}${r.flipped ? ' (flipped)' : ''}`).join(' • ')}`];
    m.log(`Mutiny vote: ${why}.`, 'ceremony');
    if (!success) {
      m.bigAll(this.loyal ? 'The Loyalist holds the line' : 'The crew APPROVES', `${why}. ${this.E?.name ?? '?'} will execute.`, 3, '#c0c0c0');
      return this.pause({ icon: this.loyal ? '🛡️' : '🤝', color: '#d0d0d0', title: why, lines: [...votes, `${this.M?.name ?? '?'} stays Master • ${this.E?.name ?? '?'} will execute`] }, () => this.startExecution());
    }
    this.overthrowSimple(why, votes);
  }

  /** Overthrow: the Usurper (if played) or a RANDOM eligible minion takes the staff, nominates, and goes straight to the execution. */
  overthrowSimple(why, lines = []) {
    const m = this.m, oldM = this.M, oldE = this.E;
    const us = this.usurper != null ? m.P(this.usurper) : null;
    let nm = us && !us.ghost && us.id !== oldM?.id ? us : null;
    if (!nm) {
      const pool = m.living.filter(p => p.id !== oldM?.id && p.id !== oldE?.id && !p.exhausted && !p.muted);
      nm = pick(pool.length ? pool : m.living.filter(p => p.id !== oldM?.id));
    }
    if (!nm) return this.startExecution();
    m.masterId = nm.id; nm.servedMaster++; m.execId = null;
    this.grantAltarVision(nm);
    if (oldM) m.teleport(oldM, nm.body.x, nm.body.z, nm.body.yaw);
    m.teleport(nm, MASTER_SPOT.x, MASTER_SPOT.z, 0);
    m.appoint(nm, 'master'); m.fx('rebellion');
    m.bigAll('MUTINY SUCCEEDS!', `${oldM?.name ?? '?'} & ${oldE?.name ?? '?'} are overthrown • ${nm.name} takes the staff${us && nm === us ? ' (🗡️ Usurper)' : ' (chosen at random)'}.`, 3.5, '#ff5c5c');
    m.log(`Mutiny succeeded. ${nm.name} is the new Master${us && nm === us ? ' (Usurper)' : ''}.`, 'ceremony');
    this.pause({ icon: '⚔️', color: '#ff6b6b', title: `Mutiny succeeds — ${why}`,
      lines: [...lines, `${oldM?.name ?? '?'} & ${oldE?.name ?? '?'} are overthrown`, `${nm.name} is the new Master${us && nm === us ? ' — the Usurper seized the staff' : ' (random eligible minion)'}`, 'One vote per milestone: the new Master picks an Executioner and the execution follows directly'] },
    () => this.startNomination(true));
  }

  /** Grey Eminence (simplified): the current Executioner is cancelled, the caster names a new one; voting continues. */
  replaceExec(t, by) {
    const m = this.m, old = this.E;
    m.execId = t.id;
    for (const S of [this.pacified, this.puppet, this.instig]) S.delete(t.id);
    this.votes.delete(t.id);
    this.nominatedBy = by.id;
    m.appoint(t, 'exec', by); m.fx('nominate', { id: t.id });
    this.t = Math.max(this.t, 6);
    m.toastAll(`🩶 ${by.name} cancels ${old?.name ?? 'the'} Executioner — ${t.name} is the new Executioner. Keep voting!`);
  }

  /** Jailer: private look at the captives' FACTIONS, then KEEP or RESPAWN 3 unknown ones. */
  jailerOffer(p) {
    const m = this.m;
    this.jailer = { id: p.id, pending: true };
    m.send(p.id, { t: 'jailerOffer', captives: m.npcs.altar().map(n => ({ id: n.id, faction: n.faction })) });
  }
  jailerReply(p, respawn) {
    const m = this.m, j = this.jailer;
    if (!j || !j.pending || !p || p.id !== j.id) return;
    j.pending = false;
    if (respawn && this.sub === CER.VOTE) {
      const fresh = m.npcs.spawnLine('altar', 2);              // Simplified Jailer: 2 fresh captives (matches the 2 that would remain)
      this.levers = [false, false, false];
      const mm = this.M; if (mm) for (const n of fresh) mm.knownNpcs.add(n.id);
      m.fx('trapdoor');
      m.toastAll('🗝️ The Jailer sent the captives into the abyss — 2 new captives stand at the portal.');
    } else m.toast(p.id, '🗝️ You keep the current captives.');
  }

  /** Simplified Insight Eye is used by the Master (who presided over the sacrifice); classic: the Executioner. */
  eyeHolder() { return this.m.simple ? (this.presidingMaster ?? this.m.masterId) : this.m.execId; }

  /** A new Master inherits full inspection of the captives queued on the altar by the predecessor. */
  grantAltarVision(p) {
    if (!p) return;
    for (const n of this.m.npcs.altar()) p.knownNpcs.add(n.id);
    if (this.m.npcs.altar().length) this.m.toast(p.id, "👁️ You inherit your predecessor's captives — aim at them to read their glyphs.");
  }

  // --------------------------------------------------------------- role hooks
  dethrone(byChef) {
    const m = this.m;
    const old = this.M;
    const cands = m.living.filter(p => p.id !== m.masterId && !p.muted);
    const least = Math.min(...cands.map(p => p.servedMaster));
    const nm = pick(cands.filter(p => p.servedMaster === least));
    if (!nm) return;
    m.masterId = nm.id; nm.servedMaster++;
    this.grantAltarVision(nm);
    if (old) m.teleport(old, nm.body.x, nm.body.z, nm.body.yaw);
    m.teleport(nm, MASTER_SPOT.x, MASTER_SPOT.z, 0);
    m.appoint(nm, 'master');
    m.bigAll(`${nm.name} takes the staff!`, byChef ? '🍲 The Old Chef dethroned the Master — a new nomination begins.' : '', 3, '#ffd75e');
    this.pause({ icon: '🍲', color: '#ffd75e', title: 'The Master is dethroned', lines: [`${old?.name ?? '?'} loses the staff without a rebellion`, `${nm.name} (fewest turns as Master) nominates a new Executioner`] }, () => this.startNomination());
  }

  fanaticalOffer(caster, target) {
    this.fanatical = { caster: caster.id, target: target.id, pending: true };
    this.m.send(target.id, { t: 'fanaticalOffer', from: caster.name, crystals: target.crystals });
  }
  fanaticalReply(p, accept) {
    const f = this.fanatical;
    if (!f || !f.pending || !p || p.id !== f.target) return;
    f.pending = false;
    const caster = this.m.P(f.caster);
    if (accept && this.sub === CER.REACTION && p.crystals > 0) {
      const all = this.anarchy ? 1 : p.crystals;
      this.final.set(p.id, all);
      const r = this.reveal.find(x => x.id === p.id); if (r) r.amount = all; else this.reveal.push({ id: p.id, name: p.name, amount: all });
      this.m.toastAll(`🔥 ${p.name} throws ALL ${all} crystals into the rebellion!`);
    } else if (caster) {
      caster.cardUsed = false;
      this.m.toast(caster.id, `${p.name} refused — your Fanatical Instigator card flips face down again.`);
    }
  }

  // --------------------------------------------------------------- execution
  startExecution() {
    const m = this.m;
    this.presidingMaster = m.masterId;
    this.setSub(CER.EXECUTION, m.timers.execution);
    const e = this.E;
    if (e) for (const n of m.npcs.altar()) e.knownNpcs.add(n.id);
    m.bigAll(`${e?.name ?? '?'} must feed ONE captive to the portal`, 'The other drops into the Prison of the Rejected', 3, '#c58bff');
    if (e) m.toast(e.id, '🪓 You are the Executioner: aim at a captive on the altar to read its glyph, LMB to lift, walk to the portal, LMB to throw.');
  }

  sacrificeNpc(n) {
    const m = this.m;
    n.state = 'sacrificed'; n.carrier = null;
    m.tally[n.faction]++;
    m.npcs.rejectRemaining();
    this.lastSacrifice = { faction: n.faction, curse: n.curse, id: n.id };
    m.botChat.onSacrifice(n);
    m.sacrificeLog.push({ milestone: this.milestone, faction: n.faction, curse: n.curse, master: this.M?.name, exec: this.E?.name });
    if (n.faction === FACTIONS.CHAOS) this.chaosSacrificed = true;
    for (const p of m.list) if (p.muted && p.mutedSince < m.ceremonyIndex) p.muted = false;  // muteness lasts until the next sacrifice
    m.fx('portal_burst', { faction: n.faction });
    const C = CURSES[n.curse];
    m.bigAll(`${FACTION_INFO[n.faction].icon} A ${FACTION_INFO[n.faction].short} captive is devoured!`, `Stigma: ${C.name} — ${C.desc}`, 3.5, FACTION_INFO[n.faction].color);
    const before = this.crystalSnapshot();
    this.lastSacrifice.resolution = this.applyCurse(n.curse);
    const deltas = this.crystalDeltas(before);
    const F = FACTION_INFO[n.faction];
    // Mathematical sudden death: once a sacrifice lands, a non-final milestone may already be mathematically decided
    // (Fire or Blood lead every rival by more than the sacrifices left to come). Simplified Mode has no Living Sacrifice
    // ritual to carry this check, so run it right here after the portal resolves — but never pre-empt the FINAL tally.
    // (Classic keeps its existing Living-Sacrifice-only check so its flow is unchanged.)
    const lock = m.simple && this.milestone < m.bars.M ? this.lockedWinner() : null;
    this.pause({
      icon: F.icon, color: F.color, kind: 'sacrifice', glyph: { faction: n.faction, curse: n.curse },
      title: `${this.E?.name ?? 'The Executioner'} fed a ${F.short} captive to the portal`,
      lines: [`Curse triggered: ${C.name}`, this.lastSacrifice.resolution, ...deltas,
        `Altar: 🔥 ${m.tally.fire} • 🩸 ${m.tally.blood} • 🔮 ${m.tally.chaos}`,
        ...(lock ? [`${FACTION_INFO[lock].icon} ${FACTION_INFO[lock].name} can no longer be caught — sudden death!`] : [])],
    }, () => { if (lock && this.checkSuddenDeath()) return; this.startInteractiveCurse(n.curse); });
  }

  /**
   * Immediate curse effects. Returns ONE resolution line describing what happened and
   * who was impacted (shown on the outcome card and under the Debate status).
   * Interactive curses return a pending line that is replaced once they resolve.
   */
  applyCurse(curse) {
    const m = this.m, e = this.E, en = e?.name ?? 'the Executioner';
    switch (curse) {
      case 'MANA_BOOST':
        if (e) { m.addCrystals(e, 1); m.toast(e.id, '+1 Mana Crystal!'); }
        return `Mana Boost: Executioner ${en} gained 1 Mana Crystal (now ${e?.crystals ?? 0}).`;
      case 'MANA_DRAIN': {
        const had = e?.crystals ?? 0;
        if (e) { m.addCrystals(e, -1); m.toast(e.id, '-1 Mana Crystal (drained).', 'warn'); }
        return had > 0 ? `Mana Drain: Executioner ${en} lost 1 Mana Crystal (now ${e.crystals}).` : `Mana Drain: Executioner ${en} had no crystal to lose.`;
      }
      case 'GAGGING_SEAL':
        if (e) { e.gagged = true; m.toastAll(`🔇 ${e.name} is gagged until the next ceremony.`); }
        return `Gagging Seal: Executioner ${en} is gagged (no voice or chat) until the next ceremony.`;
      case 'TOXIC_FUMES': return this.toxicFumes();
      case 'EYE_OF_TRUTH': return m.simple ? `Insight Eye: Master ${this.M?.name ?? '?'} may strike one minion to privately learn their cult.` : `Insight Eye: Executioner ${en} may strike one minion to privately learn their cult.`;
      case 'CALL_OF_ABYSS': return `Call of the Abyss: Master ${this.M?.name ?? '?'} hands the Prison key to one minion.`;
      case 'DARK_INITIATION': return 'Dark Initiation: the Chaos Leader acts in the dark…';
      default: return `${CURSES[curse]?.name ?? curse}: no effect.`;
    }
  }
  setResolution(text) { if (this.lastSacrifice) this.lastSacrifice.resolution = text; }

  /** Interactive curses (strike a target) — otherwise straight to the milestone event. */
  startInteractiveCurse(curse) {
    const m = this.m, e = this.E, mm = this.M;
    switch (curse) {
      case 'EYE_OF_TRUTH': {
        const h = m.P(this.eyeHolder());
        if (h) { this.setSub(CER.CURSE, m.timers.eye, 'eye'); m.big(h.id, '👁️ Insight Eye', 'Strike one minion (LMB) to learn their cult!', 3, '#7fe0ff'); return; }
        break;
      }
      case 'CALL_OF_ABYSS':
        if (mm) { this.setSub(CER.CURSE, m.timers.abyss, 'abyss'); m.bigAll('🗝️ Call of the Abyss', `${mm.name} hands the Prison key to one minion (LMB)`, 3, '#7fe0ff'); return; }
        break;
      case 'DARK_INITIATION': {
        const L = m.P(m.chaosLeaderId);
        if (L && !L.ghost && this.initiationCandidates().length) {
          this.setSub(CER.CURSE, m.timers.initiation, 'initiation');
          m.big(L.id, '🔮 Dark Initiation', 'Everyone is blind. Walk up to a minion and slap them (LMB) to convert them to Chaos.', 4, '#b06bff');
          for (const p of m.list) if (p.id !== L.id) m.big(p.id, '🔮 Dark Initiation', 'Something stirs in the dark...', 3, '#b06bff');
          return;
        }
        break;
      }
      default: break;
    }
    this.startEvent();
  }

  toxicFumes() {
    const m = this.m, old = this.M, e = this.E;
    m.fx('fumes', { id: old?.id });
    if (!old) return 'Toxic Fumes: there was no Master to choke.';
    const base = m.living.filter(p => p.id !== old.id && p.id !== m.execId && !p.muted);
    const fresh = base.filter(p => !p.exhausted);     // never pass the staff to an Exhausted minion unless everyone eligible is exhausted
    const cands = fresh.length ? fresh : base;
    const least = Math.min(...cands.map(p => p.servedMaster));
    const nm = pick(cands.filter(p => p.servedMaster === least));
    if (!m.exhaustedQueue.includes(old.id)) m.exhaustedQueue.push(old.id);
    m.refreshExhausted();
    for (const p of [old, e]) if (p) { p.fumesT = m.timers.fumes; m.ragdoll(p, 1.6, 2.5); }
    if (nm) { m.masterId = nm.id; nm.servedMaster++; m.appoint(nm, 'master'); }
    m.bigAll('☠️ TOXIC FUMES!', `${old.name} chokes and loses the staff${nm ? ' → ' + nm.name + ' (least service) is the new Master' : ''}. Both deciders are intoxicated.`, 4, '#7dff7d');
    return `Toxic Fumes: Master ${old.name} was overthrown${nm ? ' (' + nm.name + ' takes the staff)' : ''} and exhausted; ${old.name} and ${e?.name ?? '?'} afflicted with drunkenness.`;
  }

  slapCandidates(byId) { return this.m.living.filter(p => p.id !== byId); }
  initiationCandidates() { return this.m.living.filter(p => p.id !== this.m.chaosLeaderId && p.faction !== FACTIONS.CHAOS && !p.immuneChaos); }

  eyeReveal(t) {
    const e = this.m.P(this.eyeHolder()); if (!e || !t) return this.startEvent();
    e.known.set(t.id, t.faction);
    this.m.send(e.id, { t: 'label', id: t.id, text: `${FACTION_INFO[t.faction].icon} ${FACTION_INFO[t.faction].name}`, color: FACTION_INFO[t.faction].color, dur: 3 });
    this.m.fx('slap', { x: t.body.x, z: t.body.z });
    this.setResolution(`Insight Eye: ${this.m.simple ? 'Master' : 'Executioner'} ${e.name} privately learned ${t.name}'s cult.`);
    this.pause({ icon: '👁️', color: '#7fe0ff', title: 'The Insight Eye closes', lines: [`${e.name} privately learned one minion's cult.`] }, () => this.startEvent());
  }
  giveKey(t) {
    t.hasKey = true;
    this.setResolution(`Call of the Abyss: ${t.name} received the Prison key from Master ${this.M?.name ?? '?'}.`);
    this.m.toastAll(`🗝️ ${t.name} received the Prison key.`);
    this.m.toast(t.id, 'You hold the Prison key: the bars of the Prison of the Rejected open for you. Inspect the rejected captives there.');
    this.m.fx('slap', { x: t.body.x, z: t.body.z });
    this.pause({ icon: '🗝️', color: '#7fe0ff', title: 'Call of the Abyss', lines: [`${t.name} now holds the Prison key and may inspect the rejected captives.`] }, () => this.startEvent());
  }
  convert(t) {
    const m = this.m, L = m.P(m.chaosLeaderId);
    if (!t || !L) return this.startEvent();
    t.faction = FACTIONS.CHAOS;
    this.setResolution('Dark Initiation: the Chaos Leader secretly initiated someone in the dark.');
    const chaos = m.list.filter(p => p.faction === FACTIONS.CHAOS);
    for (const a of chaos) for (const b of chaos) if (a !== b) a.known.set(b.id, FACTIONS.CHAOS);
    m.send(t.id, { t: 'converted', leader: L.name });
    m.send(L.id, { t: 'label', id: t.id, text: '🔮 Converted!', color: '#b06bff', dur: 3 });
    // Stealth: snap the Chaos Leader back to their circle spot and keep everyone else blind for ~2 s longer, so nobody
    // sees the Leader walk back and works out who they are.
    if (L.cerSpot) m.teleport(L, L.cerSpot.x, L.cerSpot.z, L.cerSpot.yaw);
    this.blindHoldUntil = m.time + 2;                 // extra blackout buffer (consulted by applyFreeze during the result card)
    this.pause({ icon: '🔮', color: '#b06bff', title: 'The darkness recedes…', lines: ['Something has changed in the circle. Nobody saw what.'] }, () => this.startEvent());
  }

  // --------------------------------------------------------------- milestone events
  startEvent() {
    const m = this.m, key = this.eventKey, ev = MILESTONE_EVENTS[key], mm = this.M;
    switch (key) {
      case 'INSPECTION':
        this.setSub(CER.EVENT, m.timers.inspection, key);
        m.big(mm?.id, '🔍 Robe Inspection', 'Strike a player (LMB) to reveal their cult. Only you will know.', 4, '#ffd75e');
        break;
      case 'MUTENESS':
        this.setSub(CER.EVENT, m.timers.muteness, key);
        m.bigAll('🤐 Curse of Muteness', `${mm?.name} slaps one minion (LMB) — cursed until the next sacrifice. A cursed player cannot be nominated Master/Executioner during the next sacrifice.`, 4, '#ffd75e');
        break;
      case 'FLOGGING':
        this.setSub(CER.EVENT, m.timers.flogging, key);
        m.bigAll('⛓️ Flogging', `${mm?.name} takes the whip — the flogged minion publicly reveals one cult they are NOT.`, 4, '#ffd75e');
        break;
      case 'RENEWAL': {
        const before = this.crystalSnapshot();
        for (const p of m.living) if (p.crystals < 3) p.crystals = 3;
        m.bigAll('💎 Mana Renewal', 'Everyone with fewer than 3 Mana Crystals refills to 3.', 3, '#7fe0ff');
        const d = this.crystalDeltas(before);
        return this.pause({ icon: '💎', color: '#7fe0ff', kind: 'event', title: 'Mana Renewal', lines: d.length ? d : ['Everyone already had 3 or more crystals'] }, () => this.startDebate());
      }
      case 'LIVING':
        this.setSub(CER.EVENT, m.timers.living, key);
        m.big(mm?.id, '🐙 Living Sacrifice Ritual', 'Chase a minion, LMB to lift them, LMB at the portal to throw them in. If it is the Chaos Leader — Chaos wins!', 4, '#ff6b6b');
        for (const p of m.list) if (p.id !== m.masterId) m.big(p.id, '🐙 Living Sacrifice Ritual', `RUN! ${mm?.name} hunts a living sacrifice.`, 3, '#ff6b6b');
        break;
      case 'FINAL': return this.finalize();
      case 'EMPTY': if (m.simple) return this.startDebate();
      // falls through
      default:
        this.pause({ icon: ev?.icon ?? '⚪', color: '#dddddd', kind: 'event', title: `${ev?.name ?? 'Empty'} milestone`, lines: ['No special event — the debate begins.'] }, () => this.startDebate());
    }
  }

  eventSlap(t) {
    const m = this.m, mm = this.M;
    m.fx('slap', { x: t.body.x, z: t.body.z, whip: this.mode === 'FLOGGING' });
    let sum;
    if (this.mode === 'INSPECTION') {
      mm.known.set(t.id, t.faction); t.immuneChaos = true;
      m.send(mm.id, { t: 'label', id: t.id, text: `${FACTION_INFO[t.faction].icon} ${FACTION_INFO[t.faction].name}`, color: FACTION_INFO[t.faction].color, dur: 3 });
      m.toastAll(`🔍 ${mm.name} inspected ${t.name}'s robe.`);
      sum = { icon: '🔍', title: 'Robe Inspection', lines: [`${mm.name} searched ${t.name}'s robe — the result is known only to the Master.`, `${t.name} is now immune to Chaos.`] };
    } else if (this.mode === 'MUTENESS') {
      t.muted = true; t.mutedSince = m.ceremonyIndex;
      m.toastAll(`🤐 ${t.name} is cursed with muteness.`);
      sum = { icon: '🤐', title: 'Curse of Muteness', lines: [`${t.name} cannot speak until the next sacrifice`, `${t.name} cannot be nominated Master/Executioner during the next sacrifice`] };
    } else if (this.mode === 'FLOGGING') {
      const not = pick(Object.values(FACTIONS).filter(f => f !== t.faction));
      t.publicNot = not; t.immuneChaos = true;
      for (const p of m.list) m.send(p.id, { t: 'label', id: t.id, text: `I'm not ${FACTION_INFO[not].name}!`, color: '#fff', dur: 4 });
      m.toastAll(`⛓️ ${t.name} is NOT ${FACTION_INFO[not].name}.`);
      sum = { icon: '⛓️', title: 'Flogging', lines: [`${t.name} is NOT ${FACTION_INFO[not].name} (public evidence)`, `${t.name} is now immune to Chaos.`] };
    }
    this.pause({ color: '#ffd75e', kind: 'event', ...sum }, () => this.startDebate());
  }

  liftLiving(mm, v) {
    if (!v || v.ghost || v.carriedBy || mm.carryingPlayer || dist2(mm.body, v.body) > 2.4) return;
    this.m.releaseAll(v);
    mm.carryingPlayer = v.id; v.carriedBy = mm.id;
    this.m.toast(v.id, `${mm.name} lifted you above their head! You are helpless...`, 'warn');
  }

  throwLiving(v) {
    const m = this.m;
    const mm = this.M;
    if (mm) mm.carryingPlayer = null;
    v.carriedBy = null;
    m.fx('portal_burst', { faction: v.faction });
    if (v.id === m.chaosLeaderId) {
      m.bigAll('🔮 THE CHAOS LEADER ENTERS THE ABYSS', 'Sudden death — the Cult of Chaos wins!', 5, '#b06bff');
      return m.endMatch(FACTIONS.CHAOS, `${v.name}, the Chaos Leader, was thrown into the portal as a Living Sacrifice.`);
    }
    v.ghost = true;
    v.hasKey = v.hasKey; // ghosts keep tasks only
    if (m.exhaustedQueue.includes(v.id)) { m.exhaustedQueue = m.exhaustedQueue.filter(id => id !== v.id); m.refreshExhausted(); }
    m.teleport(v, 0, 8.5, 0);
    m.bigAll(`👻 ${v.name} was sacrificed alive`, 'They return as a ghost: they may still work, but can hold no office.', 3.5, '#bbb');
    const lock = this.lockedWinner();
    this.pause({ icon: '👻', color: '#bbbbbb', kind: 'event', title: 'Living Sacrifice', lines: [`${mm?.name ?? 'The Master'} threw ${v.name} into the portal — they were NOT the Chaos Leader.`, `${v.name} returns as a ghost: may work, cannot hold office.`,
      ...(lock ? [`${FACTION_INFO[lock].icon} ${FACTION_INFO[lock].name} can no longer be caught — sudden death!`] : [])] },
    () => this.checkSuddenDeath() || this.startDebate());
  }

  /**
   * Mathematical sudden death. Checked strictly AFTER the Living Sacrifice resolved (a non-Leader
   * player was fed to the portal — Chaos' instant-win path is gone). One sacrifice remains per
   * remaining milestone; if Fire or Blood leads every rival by more than the sacrifices still to
   * come, nobody can tie (tie → Chaos) or overtake it.
   */
  lockedWinner() {
    const m = this.m, T = m.tally;
    const remaining = Math.max(0, m.bars.M - this.milestone);
    for (const f of [FACTIONS.FIRE, FACTIONS.BLOOD]) {
      const rival = Math.max(...Object.keys(T).filter(k => k !== f).map(k => T[k]));
      if (T[f] > rival + remaining) return f;
    }
    return null;
  }
  checkSuddenDeath() {
    const f = this.lockedWinner();
    if (!f) return false;
    const m = this.m, T = m.tally, remaining = Math.max(0, m.bars.M - this.milestone);
    m.fx('finale', { winner: f });
    m.endMatch(f, `Mathematical victory — Fire ${T.fire} • Blood ${T.blood} • Chaos ${T.chaos} with ${remaining} sacrifice${remaining === 1 ? '' : 's'} left: ${FACTION_INFO[f].name} can no longer be caught.`);
    return true;
  }

  finalize() {
    const m = this.m, T = m.tally;
    const max = Math.max(T.fire, T.blood, T.chaos);
    const top = Object.keys(T).filter(k => T[k] === max);
    const winner = top.length === 1 ? top[0] : FACTIONS.CHAOS;
    const reason = top.length === 1
      ? `Altar tally — Fire ${T.fire} • Blood ${T.blood} • Chaos ${T.chaos}. ${FACTION_INFO[winner].name} dominates the portal.`
      : `Altar tally — Fire ${T.fire} • Blood ${T.blood} • Chaos ${T.chaos}. A TIE defaults to the Cult of Chaos.`;
    m.fx('finale', { winner });
    m.endMatch(winner, reason);
  }

  // --------------------------------------------------------------- debate & exit
  startDebate() {
    const m = this.m;
    const dur = m.dbg.debateSec ?? m.balance.debate;
    this.setSub(CER.DEBATE, dur);
    m.botChat.onDebateStart();
    m.bigAll('DEBATE', 'Global voice in the Sanctuary • Justify, accuse, plan. New hazards when the timer ends.', 3, '#ffe28a');
  }

  end() {
    const m = this.m;
    m.applyExhaustion(this.presidingMaster, m.execId);
    m.log(`Ceremony ${this.milestone} ended.`, 'ceremony');
    m.execId = null;
    this.sub = null; this.mode = null;
    for (const p of m.list) { p.frozen = false; p.blind = false; if (p.carryingPlayer) { const v = m.P(p.carryingPlayer); if (v) v.carriedBy = null; p.carryingPlayer = null; } }
    m.tasks.addLard();
    m.beginWork(false);
  }

  // --------------------------------------------------------------- LMB routing in ceremony
  lmb(p, targetId) {
    const m = this.m, t = targetId != null ? m.P(targetId) : null;
    const near = t && dist2(p.body, t.body) < 2.8;
    switch (this.sub) {
      case CER.NOMINATE:
        if (p.id !== m.masterId || !t) return;
        if (!m.eligibleExec().includes(t)) {
          const why = t.exhausted ? 'Target is exhausted and cannot serve this round!' : t.muted ? 'Target is cursed with muteness and cannot serve this round!' : t.ghost ? 'Ghosts cannot hold office!' : 'That minion cannot serve as Executioner!';
          return m.errorFlash(p.id, why);
        }
        this.nominate(t.id);
        break;
      case CER.CURSE:
        if (!t || !near || t.ghost) return;
        if (this.mode === 'eye' && p.id === this.eyeHolder() && t.id !== p.id) this.eyeReveal(t);
        if (this.mode === 'abyss' && p.id === m.masterId && t.id !== p.id) this.giveKey(t);
        if (this.mode === 'initiation' && p.id === m.chaosLeaderId) {
          if (!this.initiationCandidates().includes(t)) return m.toast(p.id, `${t.name} resists — immune to Chaos or already converted.`, 'warn');
          this.convert(t);
        }
        break;
      case CER.EVENT:
        if (p.id !== m.masterId) return;
        if (['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(this.mode)) { if (t && near && t.id !== p.id && !t.ghost) this.eventSlap(t); }
        else if (this.mode === 'LIVING') {
          if (p.carryingPlayer) {
            if (m.nearPortal(p, 5.2)) this.throwLiving(m.P(p.carryingPlayer));
            else m.toast(p.id, 'Get closer to the portal!');
          } else if (t && t.id !== p.id) this.liftLiving(p, t);
        }
        break;
      default: break;
    }
  }

  serialize(viewer) {
    const m = this.m;
    const showAmounts = [CER.COUNT, CER.REACTION].includes(this.sub);
    return {
      seq: this.seq || 0, sub: this.sub, t: Math.max(0, +this.t.toFixed(1)), mode: this.mode, milestone: this.milestone, eventKey: this.eventKey,
      infinite: this.sub === CER.DEBATE && m.dbg.debateInfinite,
      voted: [...this.votes.keys()], myVote: this.votes.get(viewer.id) ?? null,
      voter: this.isVoter(viewer),
      reveal: showAmounts || this.result ? this.reveal.map(r => ({ ...r, doubled: this.doubled.has(r.id), pacified: this.pacified.has(r.id) })) : [],
      threshold: this.threshold, total: showAmounts ? this.total() : null, result: this.result,
      sealed: [...this.sealed], provoked: [...this.provoked], anarchy: this.anarchy, tribune: this.tribune,
      lastSacrifice: this.lastSacrifice, chaosSacrificed: this.chaosSacrificed,
      summary: this.sub === CER.RESULT ? this.summary : null, nominatedBy: this.nominatedBy ?? null,
      simple: !!m.simple, levers: m.simple && this.leversShown ? this.levers : null, eyeHolder: this.sub === CER.CURSE ? this.eyeHolder() : null,
      decided: m.simple && this.sub === CER.VOTE ? this.votes.size : undefined,
      voters: m.simple && this.sub === CER.VOTE ? m.list.filter(q => this.isVoter(q)).length : undefined,
    };
  }
}

function eventNameOf(k) { return MILESTONE_EVENTS[k]?.name ?? k; }
