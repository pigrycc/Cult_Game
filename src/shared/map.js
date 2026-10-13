// ============================================================================
//  DUNGEON BLUEPRINT — cross-shaped crypt (shared by server physics + client
//  renderer). Units = metres. +X = East, +Z = South, -Z = North. Floor y = 0.
//
//            [Selection Chamber]--[Prison of the Rejected]
//                     |
//  [Boiler]           |            [Alchemy]
//     |---- west ---(SANCTUARY)--- east ----|
//  [Armory]           |            [Library]
//                 [Kitchen + Cold Room]
//                 [Bone Mill & Waste Pit]
//
//  Colliders:
//    walls : thick line segments  {x1,z1,x2,z2,t,h,mat}
//    boxes : axis-aligned solids  {x,z,w,d,h,mat}
//    gates : dynamic segments that are open/closed by game rules
// ============================================================================

export const SANCTUARY_R = 11;
const CORR = 2;                 // corridor half-width
const WALL_T = 0.5;
const WALL_H = 5;

export const ROOMS = {
  sanctuary: { name: 'Central Sanctuary', icon: '🌀', cx: 0, cz: 0 },
  selection: { name: 'Selection Chamber', icon: '⛓️', x0: -7, x1: 7, z0: -24, z1: -14 },
  prison:    { name: 'Prison of the Rejected', icon: '🔒', x0: 7, x1: 17, z0: -24, z1: -14 },
  boiler:    { name: 'Boiler Room', icon: '🔥', x0: -36, x1: -18, z0: -18, z1: -2 },
  armory:    { name: 'Armory & Workshop', icon: '⚒️', x0: -36, x1: -18, z0: 2, z1: 18 },
  westhall:  { name: 'West Hall', icon: '🚪', x0: -36, x1: -18, z0: -2, z1: 2 },
  alchemy:   { name: 'Alchemy Lab', icon: '🧪', x0: 18, x1: 36, z0: -18, z1: -2 },
  library:   { name: 'Library & Scriptorium', icon: '📚', x0: 18, x1: 36, z0: 2, z1: 18 },
  easthall:  { name: 'East Hall', icon: '🚪', x0: 18, x1: 36, z0: -2, z1: 2 },
  kitchen:   { name: 'Kitchen & Cold Room', icon: '🍖', x0: -10, x1: 10, z0: 14, z1: 26 },
  bonemill:  { name: 'Bone Mill & Waste Pit', icon: '💀', x0: -10, x1: 10, z0: 28, z1: 40 },
  lobby:     { name: 'Gathering Cave', icon: '🕯️', x0: -9, x1: 9, z0: -84, z1: -66 },
};

export const walls = [];
export const boxes = [];

function wall(x1, z1, x2, z2, mat = 'stone', h = WALL_H, t = WALL_T) { walls.push({ x1, z1, x2, z2, t, h, mat }); }
function box(x, z, w, d, h, mat = 'wood', extra = {}) { const b = { x, z, w, d, h, mat, ...extra }; boxes.push(b); return b; }

// Rectangular room with door gaps: gaps = { N:[[a,b]], S:[[a,b]], E:[[a,b]], W:[[a,b]] }
function rectRoom(x0, x1, z0, z1, gaps = {}, mat = 'stone', h = WALL_H) {
  const side = (fixed, a0, a1, horizontal, list = []) => {
    const sorted = [...list].sort((p, q) => p[0] - q[0]);
    let cur = a0;
    for (const [g0, g1] of sorted) {
      if (g0 > cur) horizontal ? wall(cur, fixed, g0, fixed, mat, h) : wall(fixed, cur, fixed, g0, mat, h);
      cur = g1;
    }
    if (cur < a1) horizontal ? wall(cur, fixed, a1, fixed, mat, h) : wall(fixed, cur, fixed, a1, mat, h);
  };
  side(z0, x0, x1, true, gaps.N); side(z1, x0, x1, true, gaps.S);
  side(x0, z0, z1, false, gaps.W); side(x1, z0, z1, false, gaps.E);
}

// ---- Central Sanctuary: polygonal circle with 4 cardinal openings ----------
const gapAng = Math.asin(CORR / SANCTUARY_R);
for (let q = 0; q < 4; q++) {
  const a0 = q * Math.PI / 2 + gapAng, a1 = (q + 1) * Math.PI / 2 - gapAng;
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t0 = a0 + (a1 - a0) * i / N, t1 = a0 + (a1 - a0) * (i + 1) / N;
    wall(Math.cos(t0) * SANCTUARY_R, Math.sin(t0) * SANCTUARY_R, Math.cos(t1) * SANCTUARY_R, Math.sin(t1) * SANCTUARY_R, 'granite', 9);
  }
}
const edge = SANCTUARY_R * Math.cos(gapAng); // where corridors meet the circle
// Corridors
wall(-CORR, -edge, -CORR, -14); wall(CORR, -edge, CORR, -11.6);          // north (east side opens to prison passage)
wall(-CORR, edge, -CORR, 14); wall(CORR, edge, CORR, 14);                 // south
wall(-edge, -CORR, -18, -CORR); wall(-edge, CORR, -18, CORR);             // west
wall(edge, -CORR, 18, -CORR); wall(edge, CORR, 18, CORR);                 // east
// Prison side-passage (north corridor → east)
wall(CORR, -11.6, 11, -11.6); wall(11, -11.6, 11, -14);

// ---- Rooms --------------------------------------------------------------
rectRoom(-7, 7, -24, -14, { S: [[-CORR, CORR]] }, 'stone');
rectRoom(7, 17, -24, -14, { S: [[9, 11]], W: [[-24, -14]] }, 'stone');  // prison (west side shared w/ selection wall below)
wall(7, -24, 7, -14, 'iron', WALL_H, 0.6);                                // bars wall between selection & prison (chute behind)
rectRoom(-36, -18, -18, -2, { S: [[-30, -22]] }, 'brick');
rectRoom(-36, -18, 2, 18, { N: [[-30, -22]] }, 'brick');
wall(-36, -2, -36, 2); wall(-18, -2, -18, -CORR); wall(-18, CORR, -18, 2);
rectRoom(18, 36, -18, -2, { S: [[22, 30]] }, 'stone');
rectRoom(18, 36, 2, 18, { N: [[22, 30]] }, 'wood');
wall(36, -2, 36, 2); wall(18, -2, 18, -CORR); wall(18, CORR, 18, 2);
rectRoom(-10, 10, 14, 26, { N: [[-CORR, CORR]], S: [[-CORR, CORR]] }, 'brick');
rectRoom(-10, 10, 28, 40, { N: [[-CORR, CORR]] }, 'stone');
wall(-CORR, 26, -CORR, 28); wall(CORR, 26, CORR, 28);                     // stair passage
// Cold room inside kitchen (NE corner) – door on its west side
wall(4, 14, 4, 16, 'frost'); wall(4, 18, 4, 20, 'frost'); wall(4, 20, 10, 20, 'frost');
// Lobby cave (isolated)
rectRoom(-9, 9, -84, -66, {}, 'cave', 6);

// ---- Dynamic gates ------------------------------------------------------
// state is decided per-player by the server (canPass) or globally (closed)
export const GATES = {
  selection_grate: { x1: -CORR, z1: -14, x2: CORR, z2: -14, t: 0.3, h: 3.2, mat: 'iron', label: 'Iron Grate' },
  prison_bars:     { x1: 9, z1: -14, x2: 11, z2: -14, t: 0.3, h: 3.2, mat: 'iron', label: 'Prison Bars' },
  cold_door:       { x1: 4, z1: 16, x2: 4, z2: 18, t: 0.35, h: 2.6, mat: 'oak_frost', label: 'Cold Room Door' },
  barrier_n:       { x1: -CORR, z1: -edge, x2: CORR, z2: -edge, t: 0.3, h: 2.2, mat: 'barrier' },
  barrier_s:       { x1: -CORR, z1: edge, x2: CORR, z2: edge, t: 0.3, h: 2.2, mat: 'barrier' },
  barrier_w:       { x1: -edge, z1: -CORR, x2: -edge, z2: CORR, t: 0.3, h: 2.2, mat: 'barrier' },
  barrier_e:       { x1: edge, z1: -CORR, x2: edge, z2: CORR, t: 0.3, h: 2.2, mat: 'barrier' },
};

// ---- Fixed props / machinery (solid) -------------------------------------
// Sanctuary
export const PORTAL = { x: 0, z: 0, r: 2.0, dais: 3.2 };
export const ALTAR_SPOTS = [{ x: -1.6, z: 3.6 }, { x: 1.6, z: 3.6 }, { x: 0, z: 4.2 }, { x: -2.6, z: 3.2 }];
export const TALLY_TABLET = { x: 0, y: 6.2, z: 0 };
export const GONG = { x: 7.2, z: 3.2 };
box(7.2, 2.0, 0.5, 0.5, 3.2, 'granite'); box(7.2, 4.4, 0.5, 0.5, 3.2, 'granite');
box(-7.5, -4.5, 1.1, 1.1, 1.0, 'granite', { deco: 'bowl' }); box(-7.5, 4.5, 1.1, 1.1, 1.0, 'granite', { deco: 'bowl' });
box(7.5, -4.5, 1.1, 1.1, 1.0, 'granite', { deco: 'bowl' });
// Selection chamber bench + trapdoor
box(0, -22.8, 8, 1.0, 0.5, 'stone', { deco: 'bench' });
export const TRAPDOOR = { x: 4.5, z: -18.5 };
export const NPC_SEATS = [{ x: -3, z: -22.6 }, { x: -1, z: -22.6 }, { x: 1, z: -22.6 }, { x: 3, z: -22.6 }];
export const PRISON_SPOTS = [];
for (let i = 0; i < 14; i++) PRISON_SPOTS.push({ x: 8.5 + (i % 7) * 1.3, z: -22.8 + Math.floor(i / 7) * 1.4 });
export const SPYHOLE = { x: 13.5, z: -14, y: 1.0 };
// Boiler room
box(-27, -12, 5, 4, 4.5, 'iron', { deco: 'boiler' });
box(-34.5, -9, 2, 6, 1.2, 'coal', { deco: 'coalpile' });
box(-20, -16.5, 3, 1, 1.0, 'wood');
// Armory
box(-27, 8, 1.6, 1.6, 0.9, 'iron', { deco: 'anvil' });
box(-34.5, 14, 2.4, 6, 1.4, 'sandbag', { deco: 'sandbags' });
box(-22, 16.8, 6, 1.2, 0.9, 'wood', { deco: 'table' });
box(-30, 16.8, 4, 1.2, 0.9, 'wood', { deco: 'table' });
// Alchemy
box(27, -16.5, 8, 1.2, 0.9, 'wood', { deco: 'bench_lab' });
box(34, -8, 2.2, 3, 2.6, 'brass', { deco: 'machine' });
box(22, -9, 1.6, 1.6, 0.9, 'wood', { deco: 'scale' });
// Library
for (let i = 0; i < 3; i++) box(23 + i * 5, 17.2, 4, 1.0, 4.5, 'oak', { deco: 'shelf' });
box(35.2, 10, 1.0, 8, 4.5, 'oak', { deco: 'shelf' });
box(27, 9, 1.4, 1.0, 1.1, 'stone', { deco: 'lectern' });
box(21, 14.5, 3, 1.2, 0.9, 'wood', { deco: 'table' });
// Kitchen
box(-6, 15, 6, 1.6, 1.8, 'brick', { deco: 'hearth' });
box(-2, 22.5, 3, 1.2, 0.9, 'wood', { deco: 'table' });
// Bone mill
box(-8.5, 32, 2.5, 6, 1.2, 'bone', { deco: 'bones' });
// Lobby
export const LOBBY_MIRROR = { x: 0, z: -83.4 };
box(-6, -70, 2, 2, 1.2, 'cave'); box(6.5, -78, 1.6, 1.6, 2, 'cave');

// ---- Acoustic intercom pipes (paired outlets) -----------------------------
export const INTERCOMS = [
  { id: 'lab',     x: 18.4, z: -8,  pair: 'library', label: 'Intercom → Library' },
  { id: 'library', x: 18.4, z: 8,   pair: 'lab',     label: 'Intercom → Alchemy' },
  { id: 'boiler',  x: -18.4, z: -8, pair: 'kitchen', label: 'Intercom → Kitchen' },
  { id: 'kitchen', x: -9.6, z: 18,  pair: 'boiler',  label: 'Intercom → Boiler' },
  { id: 'armory',  x: -18.4, z: 8,  pair: 'sanct',   label: 'Intercom → Sanctuary' },
  { id: 'sanct',   x: -6.0, z: -8.8, pair: 'armory', label: 'Intercom → Armory' },
];

// ---- Hazards --------------------------------------------------------------
export const STEAM_VENTS = [{ x: -23.5, z: -6 }, { x: -31, z: -5.5 }, { x: -21.5, z: -10 }, { x: -22.5, z: -15.2 }, { x: -28, z: -16 }];
export const LARD_SPOTS = [{ x: -1, z: 17.6 }, { x: 2, z: 22 }, { x: -7.5, z: 23.6 }, { x: 5.5, z: 24.2 }];
// Kitchen cauldron, mill hopper, capstan hub
box(-4.5, 20.0, 1.6, 1.6, 1.0, 'iron', { deco: 'cauldron' });
box(-3, 35.4, 1.6, 1.6, 1.2, 'wood', { deco: 'mill' });
box(2.1, 34.6, 0.8, 0.8, 1.3, 'wood', { deco: 'capstan' });
export const WASTE_PIT = { x: 7, z: 37, r: 1.4 };

// ---- Spawn points --------------------------------------------------------
export function ceremonyCircle(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2 + Math.PI / 2;
    pts.push({ x: Math.cos(a) * 7.0, z: Math.sin(a) * 7.0, yaw: Math.atan2(Math.cos(a), Math.sin(a)) });
  }
  return pts;
}
export const MASTER_SPOT = { x: 0, z: 5.6 };
export function lobbySpawn(i) { return { x: -5 + (i % 6) * 2, z: -74 + Math.floor(i / 6) * 2 }; }
export function workSpawn(i) { const a = i / 11 * Math.PI * 2; return { x: Math.cos(a) * 6, z: Math.sin(a) * 6 }; }

// Room lookup (for HUD / bots)
export function roomAt(x, z) {
  if (Math.hypot(x, z) < SANCTUARY_R) return 'sanctuary';
  for (const [k, r] of Object.entries(ROOMS)) {
    if (r.x0 === undefined) continue;
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return k;
  }
  return 'corridor';
}

// ---- Navigation graph for bots ------------------------------------------
export const NAV_NODES = {
  sanct: [0, 6.5], sanctN: [0, -8], sanctS: [0, 8], sanctW: [-8, 0], sanctE: [8, 0],
  corrN: [0, -12.8], sel: [0, -18.5], selBench: [0, -21],
  prisPass: [6, -12.8], prisDoor: [10, -12.8], prison: [12, -19],
  corrW: [-14, 0], wHall: [-24, 0], wHallW: [-31, 0], boiler: [-26, -6.5], boilerW: [-31, -6], armory: [-26, 6.5], armoryW: [-31, 6],
  corrE: [14, 0], eHall: [24, 0], eHallE: [31, 0], alchemy: [26, -6.5], alchemyE: [31, -6], library: [26, 6.5], libraryE: [31, 6],
  corrS: [0, 12.5], kitchen: [0, 17.5], kitchenS: [0, 24.5], stairs: [0, 27], mill: [0, 31.5], millS: [0, 36],
  coldDoorOut: [2.8, 17], cold: [7, 17],
};
export const NAV_EDGES = [
  ['sanct', 'sanctS'], ['sanct', 'sanctW'], ['sanct', 'sanctE'],
  ['sanctN', 'sanctW'], ['sanctN', 'sanctE'], ['sanctS', 'sanctW'], ['sanctS', 'sanctE'],
  ['sanctN', 'corrN'], ['corrN', 'sel'], ['sel', 'selBench'], ['corrN', 'prisPass'], ['prisPass', 'prisDoor'], ['prisDoor', 'prison'],
  ['sanctW', 'corrW'], ['corrW', 'wHall'], ['wHall', 'wHallW'], ['wHall', 'boiler'], ['wHall', 'armory'], ['boiler', 'boilerW'], ['armory', 'armoryW'],
  ['sanctE', 'corrE'], ['corrE', 'eHall'], ['eHall', 'eHallE'], ['eHall', 'alchemy'], ['eHall', 'library'], ['alchemy', 'alchemyE'], ['library', 'libraryE'],
  ['sanctS', 'corrS'], ['corrS', 'kitchen'], ['kitchen', 'kitchenS'], ['kitchenS', 'stairs'], ['stairs', 'mill'], ['mill', 'millS'],
  ['kitchen', 'coldDoorOut'], ['coldDoorOut', 'cold'],
];
