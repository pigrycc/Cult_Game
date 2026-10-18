// ============================================================================
//  SHARED CONSTANTS — factions, roles (1–21), curses, milestone tables, balance.
//  Imported by BOTH the host-authoritative server and the client renderer.
// ============================================================================

export const NET_PORT_DEFAULT = 7777;
export const SERVER_TICK_HZ = 60;     // simulation
export const SNAPSHOT_HZ = 30;        // transform replication
export const STATE_HZ = 10;           // filtered game-state replication
export const MAX_PLAYERS = 11;
export const MIN_PLAYERS = 5;
export const INTERACT_RANGE = 2.2;
export const NPC_INSPECT_RANGE = 2.0;

export const FACTIONS = { FIRE: 'fire', BLOOD: 'blood', CHAOS: 'chaos' };
export const FACTION_INFO = {
  fire:  { name: 'Cult of Fire',  short: 'Fire',  color: '#E67E22', glyph: '#ff8a1c', icon: '🔥' },
  blood: { name: 'Cult of Blood', short: 'Blood', color: '#C0392B', glyph: '#e0193f', icon: '🩸' },
  chaos: { name: 'Cult of Chaos', short: 'Chaos', color: '#9B59B6', glyph: '#9b4dff', icon: '🔮' },
};

export const ROBE_COLORS = [
  '#d9b23a', '#c2412f', '#3b6fc4', '#3f9a4a', '#8a4fb8', '#e07b2c',
  '#2fa3a3', '#d65a9a', '#e8e1cf', '#5b5b66', '#7a4b2a', '#9fc23a',
];

// ---------------------------------------------------------------------------
// Ability timing windows
//   WORK     – work phase
//   DEBATE   – ceremony debate window
//   NOMINATE – "before the Executioner is designated"
//   VOTE     – "right after the Executioner is designated" (agree/mana window)
//   REACTION – "after crystals are announced"
//   ANY      – any in-match moment (work + whole ceremony)
// Target filters (validated on the server):
//   other, other_los, rebel, exhausted, any_other_than_first, used_card, duo, any
// ---------------------------------------------------------------------------
export const ROLES = [
  { id: 1, name: 'Mana Thief', icon: '🫳', windows: ['WORK', 'DEBATE'],
    targets: [{ label: 'Player to rob (line of sight)', filter: 'other_los' }],
    desc: 'Any time in the Work Phase or Debate Window: choose a player within line of sight and steal 1 Mana Crystal from their pouch.' },
  { id: 2, name: 'Rebellion Instigator', icon: '📯', windows: ['REACTION'],
    targets: [{ label: 'Rebel whose crystals count double', filter: 'rebel' }],
    desc: 'Reaction Time: choose a player participating in the rebellion. Each Mana Crystal they played counts DOUBLE toward the threshold.' },
  { id: 3, name: 'Rune Master', icon: '🔨', windows: ['WORK', 'DEBATE'], targets: [], cost: 1,
    desc: 'Work Phase / Debate: permanently discard 1 Mana Crystal to reveal this card. From now on, after every successful rebellion you join, 1 played crystal returns to your pouch.' },
  { id: 4, name: 'Pacifier', icon: '🕊️', windows: ['REACTION'],
    targets: [{ label: 'Rebel to pacify', filter: 'rebel' }],
    desc: 'Reaction Time: choose a rebel. All crystals they played go back into their pocket — they do not count toward this rebellion (and are not lost).' },
  { id: 5, name: 'Essence Collector', icon: '⚗️', windows: ['ANY'], targets: [],
    desc: 'Any time: draw 2 Mana Crystals from the altar reserves directly into your pouch.' },
  { id: 6, name: 'Silence Enchanter', icon: '🤫', windows: ['VOTE'],
    targets: [{ label: 'First player to seal', filter: 'other' }, { label: 'Second player to seal', filter: 'other' }],
    desc: 'Right after the Executioner is nominated: point at two players. They are sealed and cannot play a single crystal in the upcoming rebellion.' },
  { id: 8, name: 'Embalmer', icon: '⚱️', windows: ['NOMINATE'],
    targets: [{ label: 'Exhausted player to cleanse', filter: 'exhausted' }, { label: 'Player who receives Exhaustion', filter: 'other' }],
    desc: 'Before the Executioner is designated: move the "Exhausted" status from an exhausted player onto any other player.' },
  { id: 9, name: 'Oubliette Spy', icon: '🕳️', windows: ['WORK'], targets: [], requiresMasterNotVisited: true,
    desc: 'Work Phase (before the Master visits): the Selection Chamber opens for you for 15 s. Peek at ONE prisoner\'s glyph and optionally drop it through the trapdoor (LMB).' },
  { id: 10, name: 'Machiavellian', icon: '🎭', windows: ['REACTION'], targets: [],
    desc: 'Reaction Time: if this rebellion succeeds but you are NOT named the new Master, all crystals you played return to your pouch.' },
  { id: 11, name: 'Convict Smuggler', icon: '🧳', windows: ['WORK'], targets: [], requiresMasterNotVisited: true,
    desc: 'Before the Master enters the Selection Chamber: an extra prisoner appears (4 instead of 3). The Master brings two and discards two.' },
  { id: 12, name: 'Crowd Provocateur', icon: '📢', windows: ['VOTE'],
    targets: [{ label: 'First player to provoke', filter: 'other' }, { label: 'Second player to provoke', filter: 'other' }],
    desc: 'Right after the Executioner is nominated: point at two players. They MUST play at least 1 Mana Crystal into the rebellion (if they have any).' },
  { id: 13, name: 'Grey Eminence', icon: '🩶', windows: ['NOMINATE'],
    targets: [{ label: 'Your chosen Executioner', filter: 'eligible_exec' }],
    desc: 'Before the Executioner is designated: strip the Master of the choice — YOU appoint the Executioner for this ceremony.' },
  { id: 14, name: 'Old Chef', icon: '🍲', windows: ['VOTE'], targets: [],
    desc: 'Right after the Executioner is nominated: dethrone the Master without a rebellion. The staff passes to the minion who served as Master the fewest times; they nominate anew.' },
  { id: 15, name: 'Tribune of the People', icon: '⚖️', windows: ['REACTION'], targets: [],
    desc: 'Reaction Time: the crystal threshold to overthrow power this turn is halved (rounded up).' },
  { id: 16, name: 'Exorcist of Archives', icon: '📜', windows: ['WORK'], targets: [], requiresMasterNotVisited: true,
    desc: 'Before the Master enters the Selection Chamber: all current prisoners drop through the trapdoor and a fresh pool of 3 is drawn.' },
  { id: 17, name: 'Dark Mentor', icon: '🧙', windows: ['ANY'],
    targets: [{ label: 'Player whose used card is flipped back', filter: 'used_card' }],
    desc: 'Any time: point at a player who already used their card. It flips face down — they may use their ability again.' },
  { id: 18, name: 'Conspiracy Necromancer', icon: '💀', windows: ['DEBATE'], requiresChaosSacrifice: true,
    targets: [{ label: 'First giver', filter: 'other' }, { label: 'Second giver', filter: 'other' }, { label: 'Recipient', filter: 'any' }],
    desc: 'Debate Window after a Chaos prisoner entered the portal: point at two players and one recipient. Both must hand 1 Mana Crystal to the recipient.' },
  { id: 19, name: 'Tithe Collector', icon: '🪙', windows: ['VOTE'],
    targets: [{ label: 'Master or Executioner who pays', filter: 'duo' }],
    desc: 'Right after the Executioner is nominated: choose the Master or the Executioner. They must hand 1 Mana Crystal to their partner.' },
  { id: 20, name: 'Anarchist', icon: '🏴', windows: ['VOTE'], targets: [],
    desc: 'Right after the Executioner is nominated: exactly 1 crystal is enough to overthrow power, but nobody may pitch in more than 1.' },
  { id: 21, name: 'Fanatical Instigator', icon: '🔥', windows: ['REACTION'],
    targets: [{ label: 'Player offered to go all-in', filter: 'other' }],
    desc: 'Reaction Time: point at a player — they may immediately throw ALL their remaining crystals into the rebellion. If they refuse, your card flips back face down.' },
];
// ---------------------------------------------------------------------------
// SIMPLIFIED MODE role pool (ids 101+). No starting cards: they drop from finished chores. Every card is used in the
// same window — the Mutiny Vote — and there is no "when to use" line on the card.
// Target filters: voter, eligible_exec_new, exhausted, not_exhausted, used_card, any
// ---------------------------------------------------------------------------
export const SIMPLE_ROLES = [
  { id: 101, simple: true, name: 'Rebellion Instigator', icon: '📯', windows: ['VOTE'], targets: [], needsVoter: true,
    desc: 'Your vote counts as 2 votes in this voting.' },
  { id: 102, simple: true, name: 'Pacifier', icon: '🕊️', windows: ['VOTE'], targets: [{ label: 'Player whose vote is canceled', filter: 'voter' }],
    desc: 'Choose a player. Their vote is canceled in this voting.' },
  { id: 103, simple: true, name: 'Grey Eminence', icon: '🩶', windows: ['VOTE'], targets: [{ label: 'Your new Executioner', filter: 'eligible_exec_new' }],
    desc: 'Cancel the current Executioner. YOU immediately pick the new Executioner instead.' },
  { id: 104, simple: true, name: 'Old Chef', icon: '🍲', windows: ['VOTE'], targets: [],
    desc: 'Immediately overthrow the Master & Executioner without counting votes.' },
  { id: 105, simple: true, name: 'Loyalist', icon: '🛡️', windows: ['VOTE'], targets: [],
    desc: 'Block the mutiny. The current Master & Executioner stay in power regardless of votes.' },
  { id: 106, simple: true, name: 'Embalmer', icon: '⚱️', windows: ['VOTE'], targets: [{ label: 'Player to cleanse of Exhaustion', filter: 'exhausted' }],
    desc: 'Remove the Exhausted status from any player.' },
  { id: 107, simple: true, name: 'Dark Mentor', icon: '🧙', windows: ['VOTE'], targets: [{ label: 'Player whose used card is restored', filter: 'used_card' }],
    desc: 'Choose a player who already used their role. Restore their card so they can use it again.' },
  { id: 108, simple: true, name: 'Usurper', icon: '🗡️', windows: ['VOTE'], targets: [],
    desc: 'If this mutiny succeeds, YOU become the new Master.' },
  { id: 109, simple: true, name: 'Puppet Master', icon: '🪆', windows: ['VOTE'], targets: [{ label: 'Player whose vote is flipped', filter: 'voter' }],
    desc: 'Choose a player. Flip their vote.' },
  { id: 110, simple: true, name: 'Taskmaster', icon: '⏳', windows: ['VOTE'], targets: [{ label: 'Player who becomes Exhausted', filter: 'not_exhausted' }],
    desc: 'Choose a player. They become Exhausted immediately.' },
  { id: 111, simple: true, name: 'Exorcist', icon: '🕯️', windows: ['VOTE'], targets: [{ label: 'Player who gains Chaos Immunity', filter: 'any' }],
    desc: 'Choose a player. They gain Chaos Immunity for the rest of the match.' },
  { id: 112, simple: true, name: 'Jailer', icon: '🗝️', windows: ['VOTE'], targets: [],
    desc: 'Privately see the faction of current captives. Then choose to either KEEP them or RESPAWN 3 new ones (factions of new ones are unknown to you).' },
  { id: 113, simple: true, name: 'Mirror Mage', icon: '🪞', windows: ['VOTE'], targets: [],
    desc: 'Copy and immediately trigger the ability of any role card that was already used.' },
  { id: 114, simple: true, name: 'Tiebreaker', icon: '⚖️', windows: ['VOTE'], targets: [],
    desc: 'For this vote only, a tie results in a successful Mutiny.' },
];
export const SIMPLE_ROLE_IDS = SIMPLE_ROLES.map(r => r.id);
export const ROLE_BY_ID = Object.fromEntries([...ROLES, ...SIMPLE_ROLES].map(r => [r.id, r]));

// ---------------------------------------------------------------------------
// Card copy: WHEN (activation condition, top of the card) + TEXT (short effect,
// below the icon). Text is computed from the live match state (ctx).
//   ctx = { threshold: base mutiny threshold, players: player count }
// ---------------------------------------------------------------------------
const W_ANY = 'Any time', W_WD = 'Any time during the Work Phase or the Debate',
  W_REACT = 'Immediately after the mutiny crystals are revealed',
  W_AFTER_NOM = 'Right after the Master nominates an Executioner',
  W_BEFORE_NOM = 'Before the Master nominates an Executioner',
  W_CELL = 'Work Phase — before the Master enters the Selection Chamber';
const ROLE_COPY = {
  1: { when: W_WD, text: () => 'Steal 1 Mana Crystal from a minion you can see.' },
  2: { when: W_REACT, text: () => 'Crystals played by one chosen rebel count double.' },
  3: { when: `${W_WD} (costs 1 crystal)`, text: () => 'After every successful mutiny you join, 1 of your played crystals comes back.' },
  4: { when: W_REACT, text: () => "One chosen rebel's crystals go back to their pouch and don't count." },
  5: { when: W_ANY, text: () => 'Gain 2 Mana Crystals.' },
  6: { when: W_AFTER_NOM, text: () => 'Two chosen minions cannot play any crystals in this mutiny.' },
  8: { when: W_BEFORE_NOM, text: () => 'Move the Exhausted status from one minion onto another.' },
  9: { when: W_CELL, text: () => 'Peek at one captive and optionally drop it through the trapdoor (15 s).' },
  10: { when: W_REACT, text: () => "If the mutiny succeeds and you don't become Master, your crystals come back." },
  11: { when: W_CELL, text: () => 'A 4th captive appears in the cell — the Master discards two.' },
  12: { when: W_AFTER_NOM, text: () => 'Two chosen minions must play at least 1 crystal.' },
  13: { when: W_BEFORE_NOM, text: () => 'You choose the Executioner instead of the Master.' },
  14: { when: W_AFTER_NOM, text: () => 'The Master is dethroned — the minion with the fewest turns as Master takes the staff.' },
  15: { when: W_REACT, text: c => `A successful mutiny requires ${ceilHalf(c.threshold)} crystal${ceilHalf(c.threshold) === 1 ? '' : 's'} instead of ${c.threshold}.` },
  16: { when: W_CELL, text: () => 'All captives drop into the trapdoor and 3 new ones are drawn.' },
  17: { when: W_ANY, text: () => 'A chosen player may use their character ability a second time.' },
  18: { when: 'During the Debate, after a Chaos captive was sacrificed', text: () => 'Two chosen minions each give 1 crystal to a minion of your choice.' },
  19: { when: W_AFTER_NOM, text: () => 'The Master or the Executioner must give 1 crystal to the other.' },
  20: { when: W_AFTER_NOM, text: c => `This mutiny needs just 1 crystal instead of ${c.threshold} — but nobody may play more than 1.` },
  21: { when: W_REACT, text: () => 'A chosen minion may throw ALL their crystals in. If they refuse, your card returns to you.' },
};
export function roleCard(id, ctx = {}) {
  const r = ROLE_BY_ID[id], c = ROLE_COPY[id];
  if (r?.simple) return { when: '', text: r.desc };          // Simplified Mode: one shared window, no "when to use"

  if (!r || !c) return { when: '', text: r?.desc ?? '' };
  return { when: c.when, text: c.text({ threshold: ctx.threshold ?? 3, players: ctx.players ?? 5 }) };
}
export const FACTION_OBJECTIVE = {
  fire: 'Secure a strict majority of 🔥 Fire sacrifices in the portal at the final tally — or lock an unbeatable lead right after the Living Sacrifice (sudden death).',
  blood: 'Secure a strict majority of 🩸 Blood sacrifices in the portal at the final tally — or lock an unbeatable lead right after the Living Sacrifice (sudden death).',
  chaos: 'Force a TIE at the top of the final tally (e.g. Fire = Blood) — or get the Chaos Leader thrown into the portal during the Living Sacrifice (instant win).',
};

// ---------------------------------------------------------------------------
// NPC curses (glyph SHAPE). Faction = glyph COLOR.
// ---------------------------------------------------------------------------
export const CURSES = {
  MANA_BOOST:      { name: "Executioner's Mana Boost", shape: 'tri_up', desc: 'The Executioner gains +1 Mana Crystal.' },
  MANA_DRAIN:      { name: 'Mana Drain',             shape: 'tri_down', desc: 'The Executioner permanently loses 1 Mana Crystal.' },
  EYE_OF_TRUTH:    { name: 'Insight Eye',            shape: 'eye',      desc: 'The Executioner privately learns one player\'s faction.' },
  TOXIC_FUMES:     { name: 'Toxic Fumes',            shape: 'cloud',    desc: 'Smoke strips the Master of the staff (passes to least-served). Both deciders get drunk & garbled.' },
  CALL_OF_ABYSS:   { name: 'Call of the Abyss',      shape: 'key',      desc: 'The Master hands a Prison key to one player.' },
  DARK_INITIATION: { name: 'Dark Initiation',        shape: 'star',     desc: 'The Chaos Leader secretly converts one player.' },
  GAGGING_SEAL:    { name: 'Gagging Seal',           shape: 'seal',     desc: 'The Executioner is gagged (no voice/chat) until the next ceremony.' },
};
export const CURSE_KEYS = Object.keys(CURSES);
// Every captive ALWAYS carries a curse. Core pool (spec): Mana Boost, Mana Drain, Toxic Fumes, Insight Eye, Gagging Seal.
export const CORE_CURSES = ['MANA_BOOST', 'MANA_DRAIN', 'TOXIC_FUMES', 'EYE_OF_TRUTH', 'GAGGING_SEAL'];
// Extended glyphs from the Convict System doc — added to the random pool only when the debug toggle is on.
export const EXTENDED_CURSES = ['CALL_OF_ABYSS', 'DARK_INITIATION'];
// Simplified Mode: only these three glyphs exist, with mode-specific effects.
export const SIMPLE_CURSES = ['DARK_INITIATION', 'TOXIC_FUMES', 'EYE_OF_TRUTH'];
export const SIMPLE_CURSE_DESC = {
  DARK_INITIATION: 'The Executioner is converted to the Cult of Chaos (unless immune to Chaos).',
  TOXIC_FUMES: 'The Master is overthrown for the next round; the Master & Executioner become drunk.',
  EYE_OF_TRUTH: 'The Master of Ceremonies privately learns the true faction of one chosen player.',
};
export const curseDesc = (key, simple) => (simple && SIMPLE_CURSE_DESC[key]) || CURSES[key]?.desc || '';

// ---------------------------------------------------------------------------
// Milestone events
// ---------------------------------------------------------------------------
export const MILESTONE_EVENTS = {
  EMPTY:      { name: 'Empty',                 icon: '⚪', desc: 'Clean run — nomination, rebellion and sacrifice only.' },
  INSPECTION: { name: 'Robe Inspection',       icon: '🔍', desc: 'The Master privately learns a player\'s faction (target becomes immune to Chaos).' },
  MUTENESS:   { name: 'Curse of Muteness',     icon: '🤐', desc: 'The Master silences one player until the next sacrifice. They cannot be nominated.' },
  FLOGGING:   { name: 'Flogging',              icon: '⛓️', desc: 'Public evidence: everyone learns one faction the target is NOT (target immune to Chaos).' },
  RENEWAL:    { name: 'Mana Renewal',          icon: '💎', desc: 'Everyone with fewer than 3 crystals refills to 3.' },
  LIVING:     { name: 'Living Sacrifice Ritual', icon: '🐙', desc: 'The Master throws a living player into the portal. Chaos Leader = Chaos wins.' },
  FINAL:      { name: 'FINAL',                 icon: '🏆', desc: 'Final sacrifice and altar tally.' },
};
export const MILESTONE_TRACKS = {
  5: ['EMPTY', 'INSPECTION', 'RENEWAL', 'LIVING', 'FINAL'],
  6: ['EMPTY', 'INSPECTION', 'FLOGGING', 'RENEWAL', 'LIVING', 'FINAL'],
  7: ['EMPTY', 'INSPECTION', 'MUTENESS', 'FLOGGING', 'RENEWAL', 'LIVING', 'FINAL'],
};

// ---------------------------------------------------------------------------
// Balance table (5–11 players). Values from the System Flow spec §7.1 and the
// Milestone/Task docs.
// ---------------------------------------------------------------------------
const BALANCE = {
  5:  { fire: [3, 2], blood: [1, 2], chaos: 1, milestones: 5, pool: 8,  required: 5,  debate: 30, threshold: 3, work: 65, exhaust: 1 },
  6:  { fire: 3, blood: 2, chaos: 1, milestones: 5, pool: 8,  required: 5,  debate: 30, threshold: 3, work: 65, exhaust: 1 },
  7:  { fire: 4, blood: 2, chaos: 1, milestones: 6, pool: 11, required: 7,  debate: 35, threshold: 3, work: 55, exhaust: 2 },
  8:  { fire: 4, blood: 3, chaos: 1, milestones: 6, pool: 12, required: 8,  debate: 35, threshold: 4, work: 55, exhaust: 2 },
  9:  { fire: 5, blood: 3, chaos: 1, milestones: 7, pool: 14, required: 9,  debate: 40, threshold: 4, work: 50, exhaust: 3 },
  10: { fire: 5, blood: 4, chaos: 1, milestones: 7, pool: 15, required: 10, debate: 40, threshold: 5, work: 50, exhaust: 3 },
  11: { fire: 5, blood: 4, chaos: 2, milestones: 7, pool: 16, required: 11, debate: 40, threshold: 5, work: 50, exhaust: 3 },
};
export function getBalance(n) {
  const k = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
  return BALANCE[k];
}

export const ECONOMY = { solo: 2, coop2: 4, coop3: 5, startCrystals: 3, maxCrystals: 9 };

export const DEFAULT_TIMERS = {
  revealBack: 5, revealFront: 5,
  announce: 3, nominate: 7, vote: 6, count: 4, reaction: 5,
  execution: 25, eye: 6, abyss: 8, initiation: 10,
  inspection: 10, muteness: 10, flogging: 10, living: 25,
  spyWindow: 15, fumes: 45, taskRespawnDelay: 3, shoveImmunity: 6, coinPickup: 0.6,
  phaseTransitionBufferSeconds: 3,     // informational pause between major ceremony events
};
// Labels for the debug "Timers" section (seconds unless noted)
export const TIMER_LABELS = {
  revealBack: 'Card reveal — back (faction)', revealFront: 'Card reveal — front (role)',
  announce: 'Ceremony announce ("Execution in 3 sec")', nominate: 'Executioner nomination', vote: 'Mutiny voting (crystal betting)',
  count: 'Crystal count reveal', reaction: 'Reaction time', execution: 'Execution (throw a captive)',
  eye: 'Insight Eye strike', abyss: 'Call of the Abyss', initiation: 'Dark Initiation',
  inspection: 'Robe Inspection', muteness: 'Curse of Muteness', flogging: 'Flogging', living: 'Living Sacrifice',
  phaseTransitionBufferSeconds: 'phaseTransitionBufferSeconds (outcome cards)',
  spyWindow: 'Oubliette Spy window', fumes: 'Toxic Fumes intoxication',
  shoveImmunity: 'Shove immunity vs. same attacker', coinPickup: 'Coin pickup hold',
  taskRespawnDelay: 'Task respawn delay',
};

export const PHASE = {
  LOBBY: 'LOBBY',
  REVEAL: 'STATE_REVEAL_SCREEN',
  WORK: 'STATE_GAMEPLAY_WORK',
  CEREMONY: 'STATE_CEREMONY',
  FINALE: 'STATE_FINALE',
};
// Ceremony sub-states
export const CER = {
  ANNOUNCE: 'ANNOUNCE', NOMINATE: 'NOMINATE', VOTE: 'VOTE', COUNT: 'COUNT', REACTION: 'REACTION',
  ELIMINATE: 'ELIMINATE', EXECUTION: 'EXECUTION', CURSE: 'CURSE', EVENT: 'EVENT', DEBATE: 'DEBATE', RESULT: 'RESULT',
};

export const STATUS_ICONS = {
  ward: '🛡️', master: '👑', exec: '🪓', exhausted: '💤', muted: '🤐', gagged: '🔇', fumes: '🤢', ghost: '👻', key: '🗝️',
};

export function ceilHalf(n) { return Math.ceil(n / 2); }
