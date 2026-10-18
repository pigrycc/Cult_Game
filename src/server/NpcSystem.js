// ============================================================================
//  NPC CAPTIVES — two-layer runic glyph (colour = faction, shape = curse) and
//  Fog-of-War authorisation. Glyph data is ONLY serialised to clients that are
//  authorised to see it (server-side filtering → no memory snooping).
//
//  Authorised viewers:
//   • Master of Ceremonies while inside the Selection Chamber (persists)
//   • Executioner for altar captives during the Execution step (persists)
//   • Oubliette Spy for the ONE captive they peek at
//   • Prison key holders (Call of the Abyss) for captives in the Prison
//   • Anyone at the Prison spyhole for captives rejected by an Executioner
//   • Everyone, once a captive has been sacrificed (public tally)
//   • Debug God Mode
// ============================================================================
import { CURSES, CORE_CURSES, EXTENDED_CURSES, SIMPLE_CURSES, FACTIONS, PHASE, CER } from '../shared/constants.js';
import { NPC_SEATS, ALTAR_SPOTS, PRISON_SPOTS, PORTAL, LINE_SPOTS, roomAt } from '../shared/map.js';
import { weighted, pick, dist2, shuffle } from './util.js';

let NID = 1;

export class NpcSystem {
  constructor(match) { this.m = match; this.reset(); }

  reset() {
    this.npcs = new Map();
    this.masterVisited = false;
    this.spyActive = false; this.spyId = null; this.spyT = 0; this.spyPeeked = null;
    this.prisonCount = 0;
  }

  draw(forced = null) {
    const faction = forced?.faction || weighted([[FACTIONS.FIRE, 40], [FACTIONS.BLOOD, 40], [FACTIONS.CHAOS, 20]]);
    // Mandatory curse: there are no "vanilla" captives. Forced (debug) curses must be valid glyphs.
    const pool = this.m.simple ? SIMPLE_CURSES : this.m.dbg.extendedCurses ? [...CORE_CURSES, ...EXTENDED_CURSES] : CORE_CURSES;
    const curse = forced?.curse && CURSES[forced.curse] ? forced.curse : this.rollCurse(pool);
    const n = { id: NID++, faction, curse, state: 'reserve', x: 0, y: 0, z: 0, carrier: null, discard: null, round: this.m.ceremonyIndex };
    this.npcs.set(n.id, n);
    return n;
  }

  /**
   * Pick a curse from the eligible pool. The debug "curse odds" map (dbg.curseWeights, per-glyph relative weights) lets a
   * host tilt the odds of each curse individually; a weight of 0 excludes that curse. Unset → uniform (every key weight 1).
   * If every eligible curse is weighted 0 we fall back to a uniform pick so a captive always gets a valid glyph.
   */
  rollCurse(pool) {
    const w = this.m.dbg.curseWeights;
    if (!w) return pick(pool);
    const entries = pool.map(k => [k, Math.max(0, +w[k] ?? 1)]);
    if (entries.every(e => e[1] <= 0)) return pick(pool);
    return weighted(entries);
  }

  seat(n, i) { const s = NPC_SEATS[i]; Object.assign(n, { state: 'chamber', x: s.x, y: 0.5, z: s.z, seat: i }); }

  chamber() { return [...this.npcs.values()].filter(n => n.state === 'chamber'); }
  altar() { return [...this.npcs.values()].filter(n => n.state === 'altar'); }

  beginRound() {
    this.masterVisited = false;
    this.spyActive = false; this.spyId = null; this.spyPeeked = null;
    if (this.m.simple) return;                                    // Simplified Mode: captives appear at the portal during the ceremony
    if (this.chamber().length + this.altar().length > 0) return; // resumed (debug)
    const forced = this.m.dbg.forcedNpcs;
    for (let i = 0; i < 3; i++) this.seat(this.draw(forced?.[i]), i);
  }

  masterEntered(p) {
    if (!this.masterVisited) {
      this.masterVisited = true;
      this.m.toast(p.id, 'Inspect the captives (aim at them) — LMB to lift one, carry it to the altar by the portal.');
    }
    for (const n of this.chamber()) p.knownNpcs.add(n.id);
  }

  // ---------------------------------------------------------- roles
  startSpy(p) {
    this.spyActive = true; this.spyId = p.id; this.spyT = this.m.timers.spyWindow; this.spyPeeked = null; this.spyN = (this.spyN || 0) + 1;
    this.m.toast(p.id, '🕳️ The grate opens for you for 15 s. E on a captive to peek, LMB on it to drop it through the trapdoor.');
    const m = this.m.P(this.m.masterId);
    if (m) this.m.toast(m.id, '🕳️ The Oubliette Spy is inside the Selection Chamber — the grate stays shut for you until they leave.', 'warn');
  }
  addPrisoner() {
    const used = new Set(this.chamber().map(n => n.seat));
    const free = [0, 1, 2, 3].find(i => !used.has(i));
    if (free === undefined) return false;
    this.seat(this.draw(), free);
    return true;
  }
  exorcise() {
    for (const n of this.chamber()) this.toPrison(n, 'exorcist');
    for (let i = 0; i < 3; i++) this.seat(this.draw(), i);
  }

  toPrison(n, kind) {
    const s = PRISON_SPOTS[this.prisonCount++ % PRISON_SPOTS.length];
    Object.assign(n, { state: 'prison', x: s.x, y: 0.5, z: s.z, carrier: null, discard: kind, round: this.m.ceremonyIndex });
    this.m.fx('trapdoor');
  }

  // ---------------------------------------------------------- per-tick
  tick(dt) {
    if (this.spyActive) {
      this.spyT -= dt;
      if (this.spyT <= 0) {
        this.spyActive = false;
        const s = this.m.P(this.spyId);
        if (s && roomAt(s.body.x, s.body.z) === 'selection') { this.m.teleport(s, 0, -12.4, 0); this.m.toast(s.id, 'Time is up — you were ejected from the Selection Chamber.'); }
        const m = this.m.P(this.m.masterId);
        if (m) this.m.toast(m.id, 'The Selection Chamber grate is open for you again.');
      }
    }
    const m = this.m.P(this.m.masterId);
    if (m && roomAt(m.body.x, m.body.z) === 'selection') for (const n of this.chamber()) m.knownNpcs.add(n.id);
    for (const n of this.npcs.values()) {
      if (n.state !== 'carried') continue;
      const c = this.m.P(n.carrier);
      if (!c) { n.state = 'ground'; continue; }
      Object.assign(n, { x: c.body.x, y: c.body.y + 1.35, z: c.body.z });
    }
  }

  // ---------------------------------------------------------- interactions
  /** E on an NPC: Spy peek. */
  inspect(p, id) {
    const n = this.npcs.get(id);
    if (!n || dist2(p.body, n) > 2.6) return;
    if (this.spyActive && p.id === this.spyId && n.state === 'chamber') {
      if (this.spyPeeked && this.spyPeeked !== n.id) return this.m.toast(p.id, 'You may peek at only ONE captive.', 'warn');
      this.spyPeeked = n.id; p.knownNpcs.add(n.id);
      this.m.toast(p.id, 'You peek under the sack... LMB on it to drop it through the trapdoor, or leave it.');
    }
  }

  /** LMB on an NPC. */
  lmb(p, id) {
    const n = this.npcs.get(id);
    if (!n || dist2(p.body, n) > 2.8 || p.carryingNpc || p.heldItem) return false;
    const ph = this.m.phase;
    if (ph === PHASE.WORK) {
      if (this.spyActive && p.id === this.spyId && n.state === 'chamber') {
        if (this.spyPeeked !== n.id) { this.m.toast(p.id, 'Peek at it first (E).'); return true; }
        this.toPrison(n, 'spy');
        this.m.toast(p.id, 'The trapdoor swallows the captive. The Master has no choice now.');
        return true;
      }
      if (p.id === this.m.masterId && (n.state === 'chamber' || n.state === 'ground' || n.state === 'altar')) {
        if (n.state === 'chamber' && this.altar().length + this.carriedCount() >= 2) { this.m.toast(p.id, 'Two captives are already chosen.'); return true; }
        this.carry(p, n); return true;
      }
      return false;
    }
    if (ph === PHASE.CEREMONY && this.m.cer.sub === CER.EXECUTION && p.id === this.m.execId && n.state === 'altar') { this.carry(p, n); return true; }
    return false;
  }

  carriedCount() { return [...this.npcs.values()].filter(n => n.state === 'carried').length; }

  carry(p, n) {
    if (p.heldTool) this.m.tasks.returnTool(p);
    n.state = 'carried'; n.carrier = p.id; p.carryingNpc = n.id;
    p.knownNpcs.add(n.id);
    this.m.fx('lift', { x: n.x, z: n.z });
  }

  /** LMB with nothing targeted while carrying (place on altar / throw into portal). */
  lmbCarrying(p) {
    const n = this.npcs.get(p.carryingNpc);
    if (!n) { p.carryingNpc = null; return; }
    if (this.m.phase === PHASE.WORK) {
      if (!this.deliverToAltar(p, n)) this.dropCarried(p, false);
      return;
    }
    if (this.m.phase === PHASE.CEREMONY && this.m.cer.sub === CER.EXECUTION && p.id === this.m.execId) {
      if (dist2(p.body, PORTAL) < 5.2) { p.carryingNpc = null; this.m.cer.sacrificeNpc(n); }
      else this.m.toast(p.id, 'Walk closer to the portal to throw the captive in.');
    }
  }

  /** Anywhere in the Main Hall (Central Sanctuary) counts as the drop zone — no need to hit an exact trigger by the portal. */
  inMainHall(p) { return roomAt(p.body.x, p.body.z) === 'sanctuary' || dist2(p.body, PORTAL) < 7; }

  /** Work phase: the Master puts a captive down inside the Main Hall → it is registered on the altar. */
  deliverToAltar(p, n) {
    if (this.m.phase !== PHASE.WORK || !this.inMainHall(p)) return false;
    const used = new Set(this.altar().map(a => a.spot));
    const spot = [0, 1, 2, 3].find(i => !used.has(i));
    if (spot === undefined) return false;
    this.placeAltar(n, spot); p.carryingNpc = null;
    const left = 2 - this.altar().length;
    this.m.toast(p.id, left > 0 ? `Captive delivered to the altar. ${left} more to bring.` : 'Both captives are on the altar. Keep working!');
    return true;
  }

  placeAltar(n, spot) { const s = ALTAR_SPOTS[spot ?? 0]; Object.assign(n, { state: 'altar', x: s.x, y: 0.4, z: s.z, carrier: null, spot: spot ?? 0 }); }

  dropCarried(p, toAltar) {
    const n = this.npcs.get(p.carryingNpc); p.carryingNpc = null;
    if (!n) return;
    if (toAltar && this.m.phase === PHASE.CEREMONY) { this.placeAltar(n, this.altar().length); return; }
    if (!toAltar && this.deliverToAltar(p, n)) return;   // dropped anywhere in the Main Hall = delivered
    Object.assign(n, { state: 'ground', x: p.body.x - Math.sin(p.body.yaw) * 0.8, y: 0.3, z: p.body.z - Math.cos(p.body.yaw) * 0.8, carrier: null });
  }

  /** Called when the ceremony starts: guarantee 2 captives on the altar; leftovers drop to the Prison. */
  prepareCeremony() {
    const m = this.m.P(this.m.masterId);
    if (m && m.carryingNpc) { const n = this.npcs.get(m.carryingNpc); m.carryingNpc = null; if (n) this.placeAltar(n, this.altar().length); }
    let auto = 0;
    while (this.altar().length < 2) {
      const pool = [...this.npcs.values()].filter(n => n.state === 'chamber' || n.state === 'ground' || n.state === 'carried');
      const n = pool.length ? pick(pool) : (() => { const d = this.draw(this.m.dbg.forcedNpcs?.[auto]); return d; })();
      if (n.carrier) { const c = this.m.P(n.carrier); if (c) c.carryingNpc = null; }
      this.placeAltar(n, this.altar().length); auto++;
    }
    if (auto && m) this.m.toastAll(`The Master brought too few captives — the crypt chose ${auto} at random.`, 'warn');
    for (const n of [...this.npcs.values()]) if (['chamber', 'ground', 'carried'].includes(n.state)) this.toPrison(n, 'master');
    const as = this.altar();
    as.forEach((n, i) => this.placeAltar(n, i));
  }

  forcedLayout(list) { // debug: re-roll the current chamber with given configs
    for (const n of this.chamber()) this.npcs.delete(n.id);
    list.forEach((cfg, i) => { if (i < 4) this.seat(this.draw(cfg), i); });
  }

  /** Remaining altar captive after a sacrifice → Prison (verifiable via spyhole). Simplified Mode: into the abyss. */
  rejectRemaining() { for (const n of this.altar()) { if (this.m.simple) this.toAbyss(n); else this.toPrison(n, 'exec'); } }

  // ---------------------------------------------------------- Simplified Mode: captives on trapdoors at the portal
  line() { return [...this.npcs.values()].filter(n => n.state === 'line'); }
  /** Spawn 3 fresh captives, each on a trapdoor with a lever, directly in front of the portal (state 'line'). */
  spawnLine(state = 'line') {
    for (const n of [...this.npcs.values()]) if (['line', 'altar', 'chamber', 'ground', 'carried'].includes(n.state)) this.toAbyss(n, true);
    const forced = this.m.dbg.forcedNpcs;
    return LINE_SPOTS.map((s, i) => { const n = this.draw(forced?.[i]); Object.assign(n, { state, x: s.x, y: 0, z: s.z, spot: i, carrier: null }); return n; });
  }
  /** A trapdoor opens: the captive falls into the abyss (kept briefly so clients can animate the fall). */
  toAbyss(n, silent = false) {
    if (n.carrier) { const c = this.m.P(n.carrier); if (c) c.carryingNpc = null; }
    Object.assign(n, { state: 'abyss', carrier: null, droppedAt: this.m.time, round: this.m.ceremonyIndex });
    if (!silent) this.m.fx('trapdoor', { x: n.x, z: n.z });
  }
  /** After the Master's choice the two survivors stay where they stand and count as the altar pair. */
  lineToAltar() { for (const n of this.line()) n.state = 'altar'; }

  spyhole(p) {
    const list = [...this.npcs.values()].filter(n => n.state === 'prison' && (n.discard === 'exec' || p.hasKey));
    for (const n of list) p.knownNpcs.add(n.id);
    this.m.send(p.id, { t: 'spyhole', list: list.map(n => ({ id: n.id, faction: n.faction, curse: n.curse, round: n.round, discard: n.discard })) });
  }

  authorized(viewer, n) {
    if (viewer.godMode || n.state === 'sacrificed') return true;
    if (viewer.knownNpcs.has(n.id)) return true;
    if (viewer.hasKey && n.state === 'prison') return true;
    return false;
  }

  serialize(viewer) {
    const out = [];
    for (const n of this.npcs.values()) {
      if (n.state === 'reserve' || n.state === 'sacrificed') continue;
      if (n.state === 'abyss' && this.m.time - (n.droppedAt ?? -99) > 3) continue;   // fall animation over
      const e = { id: n.id, state: n.state, x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2), carrier: n.carrier, spot: n.spot };
      if (this.authorized(viewer, n)) { e.faction = n.faction; e.curse = n.curse; }
      out.push(e);
    }
    return out;
  }
}
