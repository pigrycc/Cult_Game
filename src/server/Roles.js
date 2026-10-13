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
    if (r.requiresMasterNotVisited && (m.npcs.masterVisited || m.npcs.spyActive)) return { ok: false, reason: 'The Master already visited the Selection Chamber' };
    if (r.requiresChaosSacrifice && !m.cer.chaosSacrificed) return { ok: false, reason: 'No Chaos captive was sacrificed this ceremony' };
    if (r.cost && p.crystals < r.cost) return { ok: false, reason: `Requires ${r.cost} Mana Crystal` };
    if (r.id === 2 || r.id === 4) if (!m.cer.rebels().length) return { ok: false, reason: 'Nobody is rebelling' };
    if (r.id === 8 && !m.list.some(q => q.exhausted)) return { ok: false, reason: 'Nobody is exhausted' };
    if (r.id === 17 && !m.list.some(q => q.cardUsed && q.id !== p.id)) return { ok: false, reason: 'No used cards to flip' };
    if (r.id === 11 && m.npcs.chamber().length >= 4) return { ok: false, reason: 'The cell is full' };
    return { ok: true };
  }

  validTarget(p, filter, t) {
    const m = this.m;
    if (!t) return false;
    switch (filter) {
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

  use(p, targetIds = []) {
    const m = this.m, r = ROLE_BY_ID[p.roleId];
    const c = this.check(p);
    if (!c.ok) return m.toast(p.id, `Cannot use ${r?.name ?? 'card'}: ${c.reason}`, 'warn');
    const T = (r.targets || []).map((spec, i) => m.P(targetIds[i]));
    for (let i = 0; i < (r.targets || []).length; i++) {
      if (!this.validTarget(p, r.targets[i].filter, T[i])) return m.toast(p.id, `Invalid target for "${r.targets[i].label}".`, 'warn');
    }
    const err = this.apply(p, r, T);
    if (err) return m.toast(p.id, err, 'warn');
    p.cardUsed = true;
    p.roleRevealed = true;
    // RPC_BroadcastRoleRevealed(player_id, role_id)
    for (const q of m.list) m.send(q.id, { t: 'roleRevealed', id: p.id, roleId: r.id, name: p.name });
    m.fx('chime', { id: p.id });
    m.log(`${p.name} revealed ${r.icon} ${r.name}.`);
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
      case 7: p.lookoutT = m.timers.lookout; m.toast(p.id, '🔭 You see every minion through the walls for 25 s.'); break;
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
      case 13: m.toastAll(`🩶 Grey Eminence ${p.name} appoints the Executioner!`); cer.nominate(T[0].id, true); break;
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
