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
  { id: 7, name: 'Dungeon Look-Out', icon: '🔭', windows: ['WORK'], targets: [],
    desc: 'Work Phase: for 25 seconds you see every minion through walls (and the Master of Ceremonies is highlighted in gold).' },
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
export const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));

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
  spyWindow: 15, lookout: 25, fumes: 45, taskRespawnDelay: 3,
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
  spyWindow: 'Oubliette Spy window', lookout: 'Dungeon Look-Out vision', fumes: 'Toxic Fumes intoxication',
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
  EXECUTION: 'EXECUTION', CURSE: 'CURSE', EVENT: 'EVENT', DEBATE: 'DEBATE', RESULT: 'RESULT',
};

export const STATUS_ICONS = {
  master: '👑', exec: '🪓', exhausted: '💤', muted: '🤐', gagged: '🔇', fumes: '🤢', ghost: '👻', key: '🗝️',
};

export function ceilHalf(n) { return Math.ceil(n / 2); }
