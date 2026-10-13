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
import { ceremonyCircle, MASTER_SPOT, PORTAL } from '../shared/map.js';
import { pick, shuffle, dist2 } from './util.js';

export class Ceremony {
  constructor(m) { this.m = m; this.reset(); }

  reset() {
    this.sub = null; this.t = 0; this.mode = null; this.milestone = 0; this.eventKey = null;
    this.resetRebellion();
    this.reveal = []; this.result = null; this.presidingMaster = null; this.chaosSacrificed = false; this.lastSacrifice = null;
    this.summary = null; this.after = null;
  }

  resetRebellion() {
    this.votes = new Map(); this.final = new Map();
    this.sealed = new Set(); this.provoked = new Set(); this.doubled = new Set(); this.pacified = new Set();
    this.anarchy = false; this.tribune = false; this.machi = null; this.fanatical = null; this.nominatedBy = null;
    this.reveal = []; this.result = null; this.eminence = false;
  }

  get M() { return this.m.P(this.m.masterId); }
  get E() { return this.m.P(this.m.execId); }

  // --------------------------------------------------------------- entry
  begin(milestoneNum) {
    const m = this.m;
    m.ceremonyIndex = milestoneNum;
    this.milestone = milestoneNum;
    const isFinal = milestoneNum >= m.bars.M;
    this.eventKey = isFinal ? 'FINAL' : (m.dbg.forcedEvent || m.track[milestoneNum - 1] || 'EMPTY');
    this.chaosSacrificed = false; this.lastSacrifice = null;
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
    this.m.log(`${summary.icon || ''} ${summary.title}${summary.lines?.length ? ' — ' + summary.lines.join('; ') : ''}`);
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
    this.applyFreeze();
  }

  applyFreeze() {
    const m = this.m, s = this.sub, mode = this.mode;
    const free = new Set();
    let blindAllBut = null;
    if (s === CER.ANNOUNCE || s === CER.DEBATE || (s === CER.EVENT && mode === 'LIVING')) m.list.forEach(p => free.add(p.id));
    if ([CER.NOMINATE, CER.VOTE, CER.COUNT, CER.REACTION].includes(s)) free.add(m.masterId);
    if (s === CER.EXECUTION) { free.add(m.execId); free.add(m.masterId); }
    if (s === CER.CURSE) {
      if (mode === 'eye') { free.add(m.execId); blindAllBut = m.execId; }
      if (mode === 'abyss') free.add(m.masterId);
      if (mode === 'initiation') { free.add(m.chaosLeaderId); blindAllBut = m.chaosLeaderId; }
    }
    if (s === CER.EVENT && ['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(mode)) {
      free.add(m.masterId);
      if (mode === 'INSPECTION') blindAllBut = m.masterId;
    }
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
    if (this.t <= 0) this.timeout();
  }

  timeout() {
    const m = this.m;
    switch (this.sub) {
      case CER.ANNOUNCE: this.assemble(); break;
      case CER.NOMINATE: {
        const forced = m.dbg.forcedDuo?.exec;
        const el = m.eligibleExec();
        const t = (forced && m.P(forced)) ? m.P(forced) : (el.length ? pick(el) : pick(m.living.filter(p => p.id !== m.masterId)));
        if (t) { m.toastAll(`Time's up — the crypt nominates ${t.name}.`); this.nominate(t.id); }
        break;
      }
      case CER.VOTE: this.count(); break;
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
        if (this.mode === 'eye') { const c = this.slapCandidates(m.execId); if (c.length) this.eyeReveal(pick(c)); else this.startEvent(); }
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
    m.npcs.prepareCeremony();
    const others = m.list.filter(p => p.id !== m.masterId);
    const spots = ceremonyCircle(Math.max(others.length, 1));
    others.forEach((p, i) => m.teleport(p, spots[i].x, spots[i].z, spots[i].yaw));
    const mm = this.M;
    if (mm) m.teleport(mm, MASTER_SPOT.x, MASTER_SPOT.z, 0);
    this.startNomination();
  }

  startNomination() {
    const m = this.m;
    this.resetRebellion();
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
    m.log(`${this.M?.name} nominated ${t.name} as Executioner${byEminence ? ' (Grey Eminence)' : ''}.`);
    this.setSub(CER.VOTE, m.timers.vote);
    const by = byEminence && byEminence !== true ? byEminence : this.M;
    const pair = [m.av(by), m.av(t)];
    for (const p of m.list) {
      if (p.id === t.id) continue;
      if (this.isVoter(p)) m.big(p.id, `${by?.name ?? '?'} nominated ${t.name} as Executioner`, 'Do you agree? Choose below — crystals are only spent if the mutiny succeeds', 2.5, '#ffd75e', pair);
      else m.big(p.id, `${by?.name ?? '?'} nominated ${t.name} as Executioner`, 'The crew is deciding whether to rebel...', 2.5, '#ffd75e', pair);
    }
    m.appoint(t, 'exec', by);
    this.nominatedBy = by?.id ?? null;
    return true;
  }

  isVoter(p) { return p && !p.ghost && p.id !== this.m.masterId && p.id !== this.m.execId; }

  vote(p, amount) {
    if (this.sub !== CER.VOTE || !this.isVoter(p)) return;
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
    if (voters.length && voters.every(q => this.votes.has(q.id) || this.sealed.has(q.id))) this.t = Math.min(this.t, 0.5);
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

  total() {
    let s = 0;
    for (const [id, v] of this.final) { if (this.pacified.has(id)) continue; s += v * (this.doubled.has(id) ? 2 : 1); }
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
    // Highest raw contribution becomes the new Master (tie → random). Muted minions cannot run for Master.
    const cands = rebels.filter(r => !r.muted);
    const pool = cands.length ? cands : rebels;
    const best = Math.max(...pool.map(r => this.final.get(r.id)));
    const newMaster = pick(pool.filter(r => this.final.get(r.id) === best));
    for (const r of rebels) {
      const v = this.final.get(r.id);
      m.addCrystals(r, -v);                                  // lost permanently
      if (r.roleId === 3 && r.roleRevealed) m.addCrystals(r, 1);   // Rune Master recovers 1
      if (this.machi === r.id && r.id !== newMaster.id) { m.addCrystals(r, v); m.toast(r.id, '🎭 Machiavellian: your crystals return to your pouch.'); }
    }
    const lossLines = rebels.map(r => `${r.name}: −${this.final.get(r.id)} 💎 played (now ${r.crystals})`);
    m.masterId = newMaster.id; newMaster.servedMaster++;
    m.execId = null;
    this.grantAltarVision(newMaster);
    m.fx('rebellion');
    m.bigAll('REBELLION SUCCEEDS!', `${total}/${th} crystals • ${newMaster.name} seizes the ceremonial staff. The old duo is spared exhaustion.`, 3.5, '#ff5c5c');
    m.log(`Rebellion succeeded (${total}/${th}). ${newMaster.name} is the new Master.`);
    // Swap places: old master into the circle, new master to the centre
    if (oldMaster) m.teleport(oldMaster, newMaster.body.x, newMaster.body.z, newMaster.body.yaw);
    m.teleport(newMaster, MASTER_SPOT.x, MASTER_SPOT.z, 0);
    m.appoint(newMaster, 'master');
    this.pause({
      icon: '⚔️', color: '#ff6b6b', title: `Rebellion succeeds (${total}/${th} 💎)`,
      lines: [`${oldMaster?.name ?? '?'} is overthrown — ${newMaster.name} seizes the staff`, ...lossLines, 'The old duo is spared exhaustion • a new nomination follows'],
    }, () => this.startNomination());
  }

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
    this.pause({
      icon: F.icon, color: F.color, kind: 'sacrifice', glyph: { faction: n.faction, curse: n.curse },
      title: `${this.E?.name ?? 'The Executioner'} fed a ${F.short} captive to the portal`,
      lines: [`Curse triggered: ${C.name}`, this.lastSacrifice.resolution, ...deltas,
        `Altar: 🔥 ${m.tally.fire} • 🩸 ${m.tally.blood} • 🔮 ${m.tally.chaos}`],
    }, () => this.startInteractiveCurse(n.curse));
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
      case 'EYE_OF_TRUTH': return `Insight Eye: Executioner ${en} may strike one minion to privately learn their cult.`;
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
      case 'EYE_OF_TRUTH':
        if (e) { this.setSub(CER.CURSE, m.timers.eye, 'eye'); m.big(e.id, '👁️ Insight Eye', 'Strike one minion (LMB) to learn their cult!', 3, '#7fe0ff'); return; }
        break;
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
    const cands = m.living.filter(p => p.id !== old.id && p.id !== m.execId && !p.muted);
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
    const e = this.E; if (!e || !t) return this.startEvent();
    e.known.set(t.id, t.faction);
    this.m.send(e.id, { t: 'label', id: t.id, text: `${FACTION_INFO[t.faction].icon} ${FACTION_INFO[t.faction].name}`, color: FACTION_INFO[t.faction].color, dur: 3 });
    this.m.fx('slap', { x: t.body.x, z: t.body.z });
    this.setResolution(`Insight Eye: Executioner ${e.name} privately learned ${t.name}'s cult.`);
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
    m.endMatch(f, `Mathematical victory after the Living Sacrifice — Fire ${T.fire} • Blood ${T.blood} • Chaos ${T.chaos} with ${remaining} sacrifice${remaining === 1 ? '' : 's'} left: ${FACTION_INFO[f].name} can no longer be caught.`);
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
    m.bigAll('DEBATE', 'Global voice in the Sanctuary • Justify, accuse, plan. New hazards when the timer ends.', 3, '#ffe28a');
  }

  end() {
    const m = this.m;
    m.applyExhaustion(this.presidingMaster, m.execId);
    m.log(`Ceremony ${this.milestone} ended.`);
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
        if (this.mode === 'eye' && p.id === m.execId && t.id !== p.id) this.eyeReveal(t);
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
      sub: this.sub, t: Math.max(0, +this.t.toFixed(1)), mode: this.mode, milestone: this.milestone, eventKey: this.eventKey,
      infinite: this.sub === CER.DEBATE && m.dbg.debateInfinite,
      voted: [...this.votes.keys()], myVote: this.votes.get(viewer.id) ?? null,
      voter: this.isVoter(viewer),
      reveal: showAmounts || this.result ? this.reveal.map(r => ({ ...r, doubled: this.doubled.has(r.id), pacified: this.pacified.has(r.id) })) : [],
      threshold: this.threshold, total: showAmounts ? this.total() : null, result: this.result,
      sealed: [...this.sealed], provoked: [...this.provoked], anarchy: this.anarchy, tribune: this.tribune,
      lastSacrifice: this.lastSacrifice, chaosSacrificed: this.chaosSacrificed,
      summary: this.sub === CER.RESULT ? this.summary : null, nominatedBy: this.nominatedBy ?? null,
    };
  }
}
