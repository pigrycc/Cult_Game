// ============================================================================
//  TASK CATALOG — 2–3 solo + 1–2 co-op tasks per room.
//  Mechanics (implemented in server/TaskManager.js):
//    hold     – hold [E] at a point for `time` s, `reps` times (optionally at
//               different `spots`, optionally requiring a held `tool`)
//    fetch    – pick an item at `src` (or one of `srcs`) and walk it through
//               `steps` (each step: deposit point, optional hold time)
//    books    – fetch where the source item hops around (Biting Books)
//    coop     – N players hold [E] simultaneously on distinct `handles`
//    bell     – 3 ropes pulled in order 1-2-3 by 3 distinct players
//    bellows  – 2 floor pads, alternate jump-landings by 2 distinct players
//    carry    – heavy object with 2 handles, carried to `target` together
//    relay    – one player drops sandbags at `pile`, another carries them
//    carcass  – one holds the Cold Room door, the other hauls the carcass
//    stack    – top minion of a piggyback stack holds [E] at an elevated valve
//    calib    – intercom calibration: reader at `scroll`, weigher at `scale`
//    runes    – match the glowing wall rune at the lectern (choice UI)
// ============================================================================

export const TOOLS = {
  broom:  { name: 'Witch Broom',        color: '#d9a441' },
  wrench: { name: 'Pipe Wrench',        color: '#9aa3ad' },
  shovel: { name: 'Coal Shovel',        color: '#7d6a55' },
  oilcan: { name: 'Brass Oil Can',      color: '#e0b040' },
  hammer: { name: 'Forge Hammer',       color: '#8a8f99' },
  mop:    { name: 'Lye Mop',            color: '#c9c1a0' },
  brush:  { name: 'Chimney Brush',      color: '#3a3a3a' },
  gaff:   { name: 'Gaff Hook',          color: '#a0a6ad' },
  bellow: { name: 'Hand Bellows',       color: '#8b5a2b' },
  rag:    { name: 'Polishing Rag',      color: '#d8c8a0' },
  bucket: { name: 'Drain Bucket',       color: '#8a7a5a' },
  dullblade: { name: 'Dull Ceremonial Blade', color: '#b8bcc4' },
  cleaver: { name: 'Butcher Cleaver',   color: '#c0c6cc' },
};

/** One distinct colour per active task (index stored on the task). Markers, required tools and task items all share it. */
// 24 distinct marker colours — enough for a packed personal-task-list board (up to ~2 solo + co-op share per minion for
// 11 players) to stay unique, so no two active tasks share a colour.
export const TASK_PALETTE = [
  '#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#e040fb', '#ff9100', '#18ffff', '#b2ff59', '#ff80ab', '#8c9eff', '#ffffff', '#a1887f',
  '#f44336', '#2196f3', '#cddc39', '#00e676', '#9c27b0', '#ff6d00', '#1de9b6', '#aeea00', '#f06292', '#536dfe', '#bcaaa4', '#ffab40',
];
export const TASK_COLORS = TASK_PALETTE.length;

export const TOOL_SPAWNS = [
  { id: 'broom1', type: 'broom', x: 5.6, z: -8.4, y: 0 },
  { id: 'broom2', type: 'broom', x: 20.2, z: -14.8, y: 0 },
  { id: 'wrench1', type: 'wrench', x: -20.2, z: -4.0, y: 0 },
  { id: 'shovel1', type: 'shovel', x: -32.5, z: -4.0, y: 0 },
  { id: 'oilcan1', type: 'oilcan', x: -22, z: 16.8, y: 0.92 },
  { id: 'hammer1', type: 'hammer', x: -25.6, z: 8.0, y: 0.92 },
  { id: 'mop1', type: 'mop', x: -9.0, z: 24.6, y: 0 },
  { id: 'brush1', type: 'brush', x: -9.0, z: 22.6, y: 0 },
  { id: 'gaff1', type: 'gaff', x: 8.6, z: 29.6, y: 0 },
  { id: 'rag1', type: 'rag', x: 5.2, z: -7.0, y: 0 },
  { id: 'bucket1', type: 'bucket', x: -23.0, z: -9.0, y: 0 },   // on the floor EAST of the furnace (furnace ends at x -24.5) — clear of its collider
  { id: 'dullblade1', type: 'dullblade', x: -22.5, z: 4.0, y: 0 },
  { id: 'cleaver1', type: 'cleaver', x: 6.0, z: 22.5, y: 0 },
];

export const ITEM_TYPES = {
  brand:   { name: 'Burning Brand',   color: '#ffb02e', glow: true },
  coal:    { name: 'Ectoplasmic Coal', color: '#7dff9a', glow: true },
  tool_s:  { name: 'Stray Tool',      color: '#b0b6bd' },
  alcohol: { name: 'Alcohol Flask',   color: '#7fd8ff', glow: true },
  book:    { name: 'Biting Grimoire', color: '#8e2a2a' },
  oiljug:  { name: 'Lamp Oil Jug',    color: '#e0a030' },
  fat:     { name: 'Fat Block',       color: '#f2e6c4' },
  skull:   { name: 'Skull',           color: '#e8e0c8' },
  sandbag: { name: 'Sandbag',         color: '#b8955a', heavy: 0.5 },
  carcass: { name: 'Frozen Carcass',  color: '#cfe8f5', heavy: 0.55 },
  candle:  { name: 'Altar Candle',    color: '#f6e9b0', glow: true },
  specimen:{ name: 'Glowing Specimen', color: '#9effa0', glow: true },
  scrap:   { name: 'Scrap Metal',     color: '#9aa3ad' },
};

const P = (x, z, y = 1) => ({ x, z, y });

export const TASKS = {
  // ---- Central Sanctuary ----
  // `game` opens a 2D minigame overlay on [E] instead of a plain hold. 'scrub' = wipe/erase ~90% with the mouse.
  soot:    { room: 'sanctuary', name: 'Clean Soot from Runes', type: 'solo', mech: 'hold', time: 2, tool: 'broom', game: 'scrub',
             spots: [P(-4.2, -5.6, 0.1), P(4.8, -5.2, 0.1), P(-5.2, 4.2, 0.1)], reps: 3 },
  fire:    { room: 'sanctuary', name: 'Replenish Eternal Fire', type: 'solo', mech: 'fetch', item: 'brand',
             src: P(-9.7, -3.4, 1.6), steps: [{ ...P(-3.1, -2.7, 0.9), time: 1 }], reps: 1 },
  candles: { room: 'sanctuary', name: 'Replace Altar Candles', type: 'solo', mech: 'collect', item: 'candle',
             srcs: [P(-9.4, -1.2, 0.9), P(-9.4, -1.2, 0.9), P(-9.4, -1.2, 0.9)], steps: [{ ...P(-2.2, -3.2, 0.9) }, { ...P(2.2, -3.2, 0.9) }, { ...P(0, -4.6, 0.9) }], reps: 3 },
  tablet:  { room: 'sanctuary', name: 'Polish Runic Tablet', type: 'solo', mech: 'hold', time: 2, tool: 'rag', game: 'scrub',
             spots: [P(-3.4, -2.2, 1.1)], reps: 1 },
  bell:    { room: 'sanctuary', name: 'Three-Tone Bell of Doom', type: 'coop3', mech: 'bell',
             handles: [P(-6.9, -6.0, 1.3), P(-5.6, -7.2, 1.3), P(-4.2, -8.2, 1.3)], rounds: 3 },
  censer:  { room: 'sanctuary', name: 'Carry the Great Censer', type: 'coop2', mech: 'carry',
             obj: P(-8.6, 1.6, 0), handleOff: 0.75, target: P(0, -3.7, 0), radius: 1.5 },
  // ---- Boiler Room ----
  coal:    { room: 'boiler', name: 'Shovel Ectoplasmic Coal', type: 'solo', mech: 'fetch', item: 'coal', tool: 'shovel',
             src: P(-32.9, -8.5, 0.9), steps: [{ ...P(-27, -9.5, 0.7), time: 0.5 }], reps: 3 },
  pipes:   { room: 'boiler', name: 'Patch Leaking Pipes', type: 'solo', mech: 'hold', time: 2,
             spots: [P(-21, -17.5, 1.6), P(-33, -17.5, 1.2), P(-29.5, -17.5, 2.0)], reps: 3 },
  drain:   { room: 'boiler', name: 'Drain Condensate', type: 'solo', mech: 'hold', time: 5, tool: 'bucket', game: 'catch', spots: [P(-24.0, -12.2, 0.4)], reps: 1 },
  gauges:  { room: 'boiler', name: 'Equalize Pressure Gauges', type: 'solo', mech: 'hold', game: 'gauges', spots: [P(-30.5, -17.5, 1.5)], reps: 1 },
  valve:   { room: 'boiler', name: 'Tighten Main Valve (Stacking)', type: 'coop2', mech: 'stack', time: 4, tool: 'wrench',
             spots: [P(-22.5, -17.5, 3.0)] },
  bellows: { room: 'boiler', name: 'Foundry Bellows', type: 'coop2', mech: 'bellows',
             handles: [P(-34.0, -15.6, 0.05), P(-31.0, -15.6, 0.05)], count: 10 },
  // ---- Armory & Workshop ----
  oil:     { room: 'armory', name: 'Oil Rusty Mechanisms', type: 'solo', mech: 'hold', tool: 'oilcan', game: 'derust',
             spots: [P(-18.5, 10, 1.4)], reps: 1 },
  forge:   { room: 'armory', name: 'Forge Repair Wedges', type: 'solo', mech: 'hold', tool: 'hammer', game: 'whack',
             spots: [P(-27, 7.2, 0.95)], reps: 1 },
  sharpen: { room: 'armory', name: 'Sharpen Ceremonial Blades', type: 'solo', mech: 'hold', tool: 'dullblade', game: 'grind',
             spots: [P(-24.5, 7.8, 0.95)], reps: 1 },
  hang:    { room: 'armory', name: 'Hang Up Tools', type: 'solo', mech: 'fetch', item: 'tool_s',
             srcs: [P(-31, 5, 0.1), P(-24.5, 12.5, 0.1), P(-32.5, 9.5, 0.1)], steps: [{ ...P(-26, 17.6, 1.5), time: 0.4 }], reps: 3 },
  saw:     { room: 'armory', name: 'Two-Man Workshop Saw', type: 'coop2', mech: 'coop', time: 5,
             handles: [P(-24.4, 12.6, 0.9), P(-20.8, 12.6, 0.9)] },
  sandbag: { room: 'armory', name: 'Sandbag Relay', type: 'coop2', mech: 'relay', time: 1.5,
             pile: P(-32.8, 14, 1.0), drop: P(-31.2, 12.2, 0.2), target: P(-28, 0, 0.1), reps: 2 },
  // ---- Alchemy Lab ----
  distill: { room: 'alchemy', name: 'Distill Acid Neutralizer', type: 'solo', mech: 'hold', game: 'mix',
             spots: [P(27, -15.6, 1.1)], reps: 1 },
  flush:   { room: 'alchemy', name: 'Flush the Research Machine', type: 'solo', mech: 'hold', game: 'simon',
             spots: [P(32.6, -8, 1.8)], reps: 1 },
  glass:   { room: 'alchemy', name: 'Sweep Broken Glass', type: 'solo', mech: 'hold', time: 1.5, tool: 'broom', game: 'scrub',
             spots: [P(24, -5.5, 0.05), P(29, -11, 0.05), P(31, -4, 0.05)], reps: 3 },
  specimens: { room: 'alchemy', name: 'Sort Glowing Specimens', type: 'solo', mech: 'collect', item: 'specimen',
             srcs: [P(26, -9, 1.0), P(26, -9, 1.0), P(26, -9, 1.0)], steps: [{ ...P(23.4, -4.4, 1.3) }, { ...P(28.4, -4.0, 1.3) }, { ...P(31.6, -6.2, 1.3) }], reps: 3 },
  calib:   { room: 'alchemy', name: 'Reagent Calibration via Intercom', type: 'coop2', mech: 'calib',
             scale: P(22, -9, 1.1), scroll: P(20.2, 10.6, 1.2) },
  // ---- Library & Scriptorium ----
  books:   { room: 'library', name: 'Subdue Biting Books', type: 'solo', mech: 'books', item: 'book',
             area: { x0: 22, x1: 32, z0: 5, z1: 13 }, steps: [{ ...P(21, 13.9, 1.0), time: 1 }, { ...P(28, 16.4, 1.6), time: 0.4 }], reps: 3 },
  lamps:   { room: 'library', name: 'Add Oil to Runic Lamps', type: 'solo', mech: 'hold', game: 'pour',
             spots: [P(33.5, 3.0, 2.0)], reps: 1 },
  runes:   { room: 'library', name: 'Flip Pages in Runic Dictionary', type: 'solo', mech: 'runes',
             spots: [P(27, 8.3, 1.2)], wall: P(34.6, 10, 2.6), reps: 3 },
  ladder:  { room: 'library', name: 'Bookshelf Ladder Cart (Stacking)', type: 'coop2', mech: 'stack', time: 4,
             spots: [P(33.0, 15.4, 2.6)] },
  press:   { room: 'library', name: 'Manual Scroll Pressing', type: 'coop2', mech: 'coop', time: 5,
             handles: [P(30.5, 7.6, 1.0), P(30.5, 12.2, 1.0)] },
  // ---- Kitchen & Cold Room ----
  tallow:  { room: 'kitchen', name: 'Render Tallow for Altar Candles', type: 'solo', mech: 'fetch', item: 'fat',
             src: P(-2, 21.7, 1.0), steps: [{ ...P(-6, 16.0, 1.4), time: 2 }, { ...P(7.5, 25.2, 0.9), time: 0.8 }], reps: 1 },
  flue:    { room: 'kitchen', name: 'Sweep Soot from Stove Flue', type: 'solo', mech: 'hold', time: 4, tool: 'brush',
             spots: [P(-9.4, 16.8, 2.0)], reps: 1 },
  mop:     { room: 'kitchen', name: 'Mop Spilled Lard', type: 'solo', mech: 'hold', time: 3, tool: 'mop', lard: true, game: 'scrub',
             spots: [], reps: 1 },
  cauldron:{ room: 'kitchen', name: 'Stir the Communal Cauldron', type: 'coop2', mech: 'coop', time: 5,
             handles: [P(-6.0, 20.0, 1.1), P(-3.0, 20.0, 1.1)] },
  carcass: { room: 'kitchen', name: 'Haul a Frozen Carcass', type: 'coop2', mech: 'carcass', item: 'carcass',
             door: P(3.5, 17.4, 1.1), src: P(8.2, 15.4, 0.6), target: P(-2, 21.6, 1.0) },
  chop:    { room: 'kitchen', name: 'Chop Meat Rations', type: 'solo', mech: 'hold', tool: 'cleaver', game: 'whack',
             spots: [P(5.5, 24.0, 0.95)], reps: 1 },
  // ---- Bone Mill & Waste Pit ----
  chute:   { room: 'bonemill', name: 'Unclog Waste Chute', type: 'solo', mech: 'hold', tool: 'gaff', game: 'plunge',
             spots: [P(5, 28.5, 1.4)], reps: 1 },
  sack:    { room: 'bonemill', name: 'Place Sack for Bone Meal', type: 'solo', mech: 'hold', time: 2.5,
             spots: [P(-3, 39.4, 0.7)], reps: 1 },
  skulls:  { room: 'bonemill', name: 'Carry Skulls to the Hopper', type: 'solo', mech: 'fetch', item: 'skull',
             srcs: [P(-6, 36.5, 0.1), P(-1.5, 30, 0.1), P(4, 32, 0.1)], steps: [{ ...P(-3, 34.3, 1.5), time: 0.3 }], reps: 3 },
  scrap:   { room: 'bonemill', name: 'Sort Scrap Metal from Bones', type: 'solo', mech: 'collect', item: 'scrap',
             srcs: [P(-4.5, 33, 0.1), P(1, 31.5, 0.1), P(3, 35, 0.1)], steps: [{ ...P(5, 28.5, 1.0) }, { ...P(5, 28.5, 1.0) }, { ...P(5, 28.5, 1.0) }], reps: 3 },
  capstan: { room: 'bonemill', name: 'Drive the Mill Capstan', type: 'coop2', mech: 'coop', time: 5,
             handles: [P(0.6, 34.6, 1.0), P(3.6, 34.6, 1.0)] },
  ash:     { room: 'bonemill', name: 'Transport the Ash Chest', type: 'coop2', mech: 'carry',
             obj: P(-6.5, 29.6, 0), handleOff: 0.7, target: P(6.0, 36.2, 0), radius: 1.7 },
};

// Mechanics a Humanlike bot can perform for real (see server/Bots.js). The task spawner uses this to make sure a bots-only
// crew always has something it CAN do on the board — otherwise tasks they refuse (carry, bell, bellows, …) pile up and jam it.
export const BOT_MECHS = new Set(['hold', 'fetch', 'runes', 'coop', 'collect']);

export const TASK_KEYS = Object.keys(TASKS);
export const COOP_KEYS = TASK_KEYS.filter(k => TASKS[k].type !== 'solo');
export const SOLO_KEYS = TASK_KEYS.filter(k => TASKS[k].type === 'solo');

// Debug-friendly display names for room tags in the task board
export const ROOM_TAGS = {
  sanctuary: '🌀 SANCTUARY', boiler: '⚙️ BOILER ROOM', armory: '⚒️ ARMORY', alchemy: '🧪 ALCHEMY',
  library: '📚 SCRIPTORIUM', kitchen: '🍖 KITCHEN', bonemill: '💀 BONE MILL',
};

export const RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᛉ'];
export const REAGENTS = ['Sulfur', 'Salt', 'Mercury'];
