// ============================================================================
//  ROLE CARDS (Boon of the Deities) — 21 single-use abilities.
//  Activation is validated against the current timing window, the card state
//  and each target filter; on success the server broadcasts
//  RPC_BroadcastRoleRevealed(player_id, role_id) and the role icon becomes
//  permanently public above that minion's nameplate.
// ============================================================================
import { ROLE_BY_ID, PHASE, CER, FACTION_INFO } from '../shared/constants.js';
import { wallsBetween } from '../shared/physics.js';
import { dist2 } from './util.js';

export class Roles {
  constructor(m) { this.m = m; }

  windowsNow() {
    const m = this.m, w = new Set();
    if (m.simple) { if (m.phase === PHASE.CEREMONY && m.cer.sub === CER.VOTE) w.add('VOTE'); return w; }   // ONE shared window
    if (m.phase === PHASE.WORK) { w.add('WORK'); w.add('ANY'); }
    if (m.phase === PHASE.CEREMONY) {
      w.add('ANY');
      const s = m.cer.sub;
      if (s === CER.DEBATE) w.add('DEBATE');
      if (s === CER.NOMINATE) w.add('NOMINATE');
      if (s === CER.VOTE) w.add('VOTE');
      if (s === CER.REACTION) w.add('REACTION');
    }
    return w;
  }

  /** Is the card usable right now? (Used by the HUD to grey/animate the ability button.) */
  check(p) {
    const m = this.m, r = ROLE_BY_ID[p.roleId];
    if (!r) return { ok: false, reason: 'No role' };
    if (p.cardUsed) return { ok: false, reason: 'Card already used' };
    if (p.ghost) return { ok: false, reason: 'Ghosts cannot use cards' };
    const w = this.windowsNow();
    if (!r.windows.some(x => w.has(x))) return { ok: false, reason: 'Not the right moment: ' + r.windows.join('/') };
    if (r.simple) {
      const sc = this.simpleCheck(p, r);
      if (sc) return { ok: false, reason: sc };
      return { ok: true };
    }
    if (r.requiresMasterNotVisited && (m.npcs.masterVisited || m.npcs.spyActive)) return { ok: false, reason: 'The Master already visited the Selection Chamber' };
    if (r.requiresChaosSacrifice && !m.cer.chaosSacrificed) return { ok: false, reason: 'No Chaos captive was sacrificed this ceremony' };
    if (r.cost && p.crystals < r.cost) return { ok: false, reason: `Requires ${r.cost} Mana Crystal` };
    if (r.id === 2 || r.id === 4) if (!m.cer.rebels().length) return { ok: false, reason: 'Nobody is rebelling' };
    if (r.id === 8 && !m.list.some(q => q.exhausted)) return { ok: false, reason: 'Nobody is exhausted' };
    if (r.id === 17 && !m.list.some(q => q.cardUsed && q.id !== p.id)) return { ok: false, reason: 'No used cards to flip' };
    if (r.id === 11 && m.npcs.chamber().length >= 4) return { ok: false, reason: 'The cell is full' };
    return { ok: true };
  }

  /** Extra preconditions of the Simplified cards (null = usable). */
  simpleCheck(p, r, forCopy = false) {
    const m = this.m, cer = m.cer;
    if (r.needsVoter && !cer.isVoter(p)) return 'Only a voter can use this (not the Master or Executioner)';
    const has = f => m.list.some(t => this.validTarget(p, f, t));
    for (const tg of r.targets || []) if (!has(tg.filter)) return 'No valid target right now';
    if (r.id === 112 && !m.npcs.altar().length) return 'There are no captives at the portal';
    if (r.id === 113) {
      if (forCopy) return 'The Mirror Mage cannot copy itself';
      if (!this.copyable(p).length) return 'No used role card to copy yet';
    }
    return null;
  }
  /** Role ids the Mirror Mage may copy right now (already used this match and usable at this moment). */
  copyable(p) {
    const m = this.m;
    return [...(m.usedRoles || [])].filter(id => id !== 113 && ROLE_BY_ID[id]?.simple && !this.simpleCheck(p, ROLE_BY_ID[id], true));
  }

  validTarget(p, filter, t) {
    const m = this.m;
    if (!t) return false;
    switch (filter) {
      case 'voter': return m.cer.isVoter(t);
      case 'eligible_exec_new': return t.id !== m.execId && m.eligibleExec().includes(t);
      case 'not_exhausted': return !t.ghost && !t.exhausted;
      case 'other': return t.id !== p.id && !t.ghost;
      case 'other_los': return t.id !== p.id && !t.ghost && dist2(p.body, t.body) < 30 && wallsBetween(p.body.x, p.body.z, t.body.x, t.body.z, 1) === 0;
      case 'rebel': return (m.cer.final.get(t.id) || 0) > 0 && !m.cer.pacified.has(t.id);
      case 'exhausted': return t.exhausted;
      case 'eligible_exec': return m.eligibleExec().includes(t);
      case 'used_card': return t.cardUsed && t.id !== p.id;
      case 'duo': return t.id === m.masterId || t.id === m.execId;
      case 'any': return !t.ghost;
      default: return false;
    }
  }

  use(p, targetIds = [], copyId = null) {
    const m = this.m, r = ROLE_BY_ID[p.roleId];
    const c = this.check(p);
    if (!c.ok) return m.toast(p.id, `Cannot use ${r?.name ?? 'card'}: ${c.reason}`, 'warn');
    // Mirror Mage: the effect (and targets) of an already-used card
    let eff = r;
    if (r.id === 113) {
      eff = ROLE_BY_ID[copyId];
      if (!eff || !this.copyable(p).includes(eff.id)) return m.toast(p.id, 'Mirror Mage: pick a role card that was already used this match.', 'warn');
    }
    const T = (eff.targets || []).map((spec, i) => m.P(targetIds[i]));
    for (let i = 0; i < (eff.targets || []).length; i++) {
      if (!this.validTarget(p, eff.targets[i].filter, T[i])) return m.toast(p.id, `Invalid target for "${eff.targets[i].label}".`, 'warn');
    }
    this.m.toastTap = [];                                   // capture the public announcement the ability makes (= "what just happened")
    if (eff !== r) m.toastAll(`🪞 ${p.name}, the Mirror Mage, copies ${eff.icon} ${eff.name}!`);
    const err = eff.simple ? this.applySimple(p, eff, T) : this.apply(p, r, T);
    const said = this.m.toastTap; this.m.toastTap = null;
    if (err) return m.toast(p.id, err, 'warn');
    p.cardUsed = true;
    p.roleRevealed = true;
    // RPC_BroadcastRoleRevealed(player_id, role_id)
    for (const q of m.list) m.send(q.id, { t: 'roleRevealed', id: p.id, roleId: r.id, name: p.name });
    m.fx('chime', { id: p.id });
    (m.usedRoles ||= new Set()).add(r.id);
    // Game log, verbose: 1) what the revealed ability does, 2) how and on whom it was just used.
    m.log(`${r.icon} ${r.name} — ${r.desc}`, 'role');
    const on = T.filter(Boolean).map(t => t.name);
    const outcome = said.length ? said.join(' ') : '';
    m.log(`${p.name} revealed ${r.icon} ${r.name}${on.length ? ' and used it on ' + on.join(' and ') : ' and activated it'}${outcome ? ' — ' + outcome : '.'}`, 'ability');
  }

  /** Simplified Mode effects — all played during the Mutiny Vote. Returns an error string or null. */
  applySimple(p, r, T) {
    const m = this.m, cer = m.cer, t = T[0];
    switch (r.id) {
      case 101: cer.instig.add(p.id); m.toastAll(`📯 ${p.name}'s vote counts as 2 votes in this voting!`); break;
      case 102: cer.pacified.add(t.id); m.toastAll(`🕊️ ${t.name}'s vote is canceled in this voting.`); break;
      case 103: cer.replaceExec(t, p); break;
      case 104: cer.forceOutcome = 'chef'; cer.t = 0; m.toastAll(`🍲 ${p.name}, the Old Chef, overthrows the Master & Executioner — no count!`); break;
      case 105: cer.loyal = true; m.toastAll(`🛡️ ${p.name}, the Loyalist, blocks the mutiny — the duo stays in power regardless of votes.`); break;
      case 106: m.exhaustedQueue = m.exhaustedQueue.filter(id => id !== t.id); m.refreshExhausted(); m.toastAll(`⚱️ ${t.name} is no longer Exhausted.`); break;
      case 107: t.cardUsed = false; m.toastAll(`🧙 ${p.name} restores ${t.name}'s used card — they may use it again.`); break;
      case 108: cer.usurper = p.id; m.toastAll(`🗡️ ${p.name} is a Usurper: if this mutiny succeeds, THEY become the new Master.`); break;
      case 109: if (cer.puppet.has(t.id)) cer.puppet.delete(t.id); else cer.puppet.add(t.id); m.toastAll(`🪆 ${p.name} pulls the strings — ${t.name}'s vote is flipped.`); break;
      case 110:
        if (!m.exhaustedQueue.includes(t.id)) m.exhaustedQueue.push(t.id);
        m.refreshExhausted(); m.toastAll(`⏳ ${p.name}, the Taskmaster, exhausts ${t.name}.`); break;
      case 111: t.immuneChaos = true; m.toastAll(`🕯️ ${p.name} blesses ${t.name} — Chaos Immunity for the rest of the match.`); break;
      case 112: cer.jailerOffer(p); m.toastAll(`🗝️ ${p.name}, the Jailer, inspects the captives…`); break;
      case 114: cer.tiebreak = true; m.toastAll(`⚖️ ${p.name}, the Tiebreaker: a tie in this vote counts as a successful mutiny.`); break;
      default: return 'Unknown role.';
    }
    return null;
  }

  apply(p, r, T) {
    const m = this.m, cer = m.cer;
    switch (r.id) {
      case 1: // Mana Thief
        if (T[0].crystals < 1) return `${T[0].name} has no crystals.`;
        m.addCrystals(T[0], -1); m.addCrystals(p, 1);
        m.toastAll(`🫳 ${p.name} stole a Mana Crystal from ${T[0].name}!`); break;
      case 2: cer.doubled.add(T[0].id); m.toastAll(`📯 ${T[0].name}'s crystals count DOUBLE!`); break;
      case 3: m.addCrystals(p, -1); m.toastAll(`🔨 ${p.name} is the Rune Master — they recover 1 crystal after every successful rebellion.`); break;
      case 4: cer.pacified.add(T[0].id); m.toastAll(`🕊️ ${T[0].name}'s crystals were pacified and returned.`); break;
      case 5: m.addCrystals(p, 2); m.toastAll(`⚗️ ${p.name} drew 2 Mana Crystals from the altar reserves.`); break;
      case 6:
        if (T[0] === T[1]) return 'Pick two different players.';
        for (const t of T) { cer.sealed.add(t.id); cer.votes.set(t.id, 0); }
        m.toastAll(`🤫 ${T[0].name} and ${T[1].name} are sealed — they cannot rebel.`); break;
      case 8: {
        const [a, b] = T;
        if (b.exhausted || a === b) return 'The receiver must be a different, non-exhausted player.';
        m.exhaustedQueue = m.exhaustedQueue.map(id => (id === a.id ? b.id : id)); m.refreshExhausted();
        m.toastAll(`⚱️ Exhaustion moved from ${a.name} to ${b.name}.`); break;
      }
      case 9: m.npcs.startSpy(p); break;
      case 10: cer.machi = p.id; m.toastAll(`🎭 ${p.name} plays the Machiavellian.`); break;
      case 11: if (!m.npcs.addPrisoner()) return 'No room in the cell.'; m.toastAll('🧳 A fourth captive was smuggled into the Selection Chamber.'); break;
      case 12:
        if (T[0] === T[1]) return 'Pick two different players.';
        for (const t of T) cer.provoked.add(t.id);
        m.toastAll(`📢 ${T[0].name} and ${T[1].name} MUST play at least 1 crystal.`); break;
      case 13: m.toastAll(`🩶 Grey Eminence ${p.name} appoints the Executioner!`); cer.nominate(T[0].id, p); break;
      case 14: m.toastAll(`🍲 ${p.name}, the Old Chef, dethrones the Master!`); cer.dethrone(true); break;
      case 15: cer.tribune = true; m.toastAll(`⚖️ Tribune of the People: the threshold is halved (${cer.threshold}).`); break;
      case 16: m.npcs.exorcise(); m.toastAll('📜 The Exorcist purged the cell — a new pool of captives was drawn.'); break;
      case 17: T[0].cardUsed = false; m.toastAll(`🧙 ${p.name} flipped ${T[0].name}'s card face down — they may use it again.`); break;
      case 18: {
        const [g1, g2, rec] = T;
        if (g1 === g2) return 'Pick two different givers.';
        for (const g of [g1, g2]) if (g !== rec && g.crystals > 0) { m.addCrystals(g, -1); m.addCrystals(rec, 1); }
        m.toastAll(`💀 ${g1.name} and ${g2.name} hand a crystal to ${rec.name}.`); break;
      }
      case 19: {
        const payer = T[0], partner = m.P(payer.id === m.masterId ? m.execId : m.masterId);
        if (!partner) return 'The duo is not complete yet.';
        if (payer.crystals < 1) return `${payer.name} has no crystals.`;
        m.addCrystals(payer, -1); m.addCrystals(partner, 1);
        m.toastAll(`🪙 ${payer.name} pays a tithe crystal to ${partner.name}.`); break;
      }
      case 20:
        cer.anarchy = true;
        for (const [id, v] of cer.votes) cer.votes.set(id, Math.min(1, v));
        m.toastAll('🏴 Anarchy! A single crystal overthrows power — nobody may pitch in more than 1.'); break;
      case 21:
        if (!cer.isVoter(T[0]) || T[0].crystals < 1) return 'That player cannot join the rebellion.';
        cer.fanaticalOffer(p, T[0]); m.toastAll(`🔥 ${p.name} goads ${T[0].name} to go ALL-IN!`); break;
      default: return 'Unknown role.';
    }
    return null;
  }

  tick() { /* timed effects (look-out, spy window) are ticked by their owners */ }
}
