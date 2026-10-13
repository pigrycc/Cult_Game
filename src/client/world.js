// ============================================================================
//  WORLD BUILDER — turns the shared map blueprint into a low-poly scene.
//  Muted granite / soot / dark-oak environment; saturated accents only on
//  machinery, hazards and magic (Inverted Saturation).
// ============================================================================
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { walls, boxes, GATES, ROOMS, SANCTUARY_R, PORTAL, GONG, INTERCOMS, STEAM_VENTS, LOBBY_MIRROR, SPYHOLE, TRAPDOOR, WASTE_PIT, TALLY_TABLET } from '../shared/map.js';
import { mat, mesh, flat, makePortal } from './models.js';

function rot(m, ax, v) { m.rotation[ax] = v; return m; }
const WALL_COL = { stone: '#3d3c40', granite: '#2f2e34', brick: '#3b2f2c', wood: '#33281f', iron: '#3a3d42', frost: '#5d7180', cave: '#35302c' };
const BOX_COL = { wood: '#4a3a2c', stone: '#45444a', granite: '#3a3940', iron: '#2b2d31', coal: '#1e1e1e', sandbag: '#7a6a4a', brass: '#9a7a30', oak: '#3a2a1c', brick: '#4a3530', bone: '#bdb39a', cave: '#3d3630' };

export function buildWorld(scene) {
  const W = { gates: {}, flicker: [], portal: null, tally: null, doors: {}, acid: null };
  scene.background = new THREE.Color('#06050a');
  scene.fog = new THREE.FogExp2('#07060b', 0.028);
  scene.add(new THREE.HemisphereLight('#9a9ab8', '#2a2018', 1.35));

  // ---- floors
  const floor = mesh(new THREE.PlaneGeometry(90, 140), mat('#2a292d', { rough: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -25); scene.add(floor);
  const tint = { selection: '#2d2b2b', prison: '#252326', boiler: '#2e2622', armory: '#2f2a25', westhall: '#2b2a2c', alchemy: '#232c2b', library: '#2e2620', easthall: '#2b2a2c', kitchen: '#30261f', bonemill: '#272626', lobby: '#2a2420' };
  for (const [k, r] of Object.entries(ROOMS)) {
    if (r.x0 === undefined) continue;
    const f = mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), mat(tint[k] || '#2a2a2a', { rough: 1 }));
    f.rotation.x = -Math.PI / 2; f.position.set((r.x0 + r.x1) / 2, 0.005, (r.z0 + r.z1) / 2); scene.add(f);
  }
  const sf = mesh(new THREE.CircleGeometry(SANCTUARY_R, 32), mat('#34333a', { rough: 0.9 })); sf.rotation.x = -Math.PI / 2; sf.position.y = 0.006; scene.add(sf);
  // flagstone grid lines in sanctuary (texture-free detail)
  for (let r = 4; r < SANCTUARY_R; r += 2.2) { const ring = mesh(new THREE.RingGeometry(r, r + 0.05, 40), mat('#232228', { basic: true })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.008; scene.add(ring); }

  // ---- walls
  for (const s of walls) {
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    if (len < 0.01) continue;
    const m = mesh(new THREE.BoxGeometry(len + s.t, s.h, s.t), mat(WALL_COL[s.mat] || '#3a3a3a', { rough: 1 }));
    m.position.set((s.x1 + s.x2) / 2, s.h / 2, (s.z1 + s.z2) / 2);
    m.rotation.y = -Math.atan2(s.z2 - s.z1, s.x2 - s.x1);
    scene.add(m);
    // soot band at the base for readability
    const band = mesh(new THREE.BoxGeometry(len + s.t + 0.02, 0.35, s.t + 0.02), mat('#1a1918'));
    band.position.copy(m.position); band.position.y = 0.17; band.rotation.y = m.rotation.y; scene.add(band);
  }
  // sanctuary vaulted dome hint (ribs)
  for (let i = 0; i < 8; i++) {
    const rib = mesh(new THREE.TorusGeometry(SANCTUARY_R, 0.25, 4, 24, Math.PI / 2.2), mat('#26252b'));
    rib.position.set(0, 9, 0); rib.rotation.y = i / 8 * Math.PI; rib.rotation.z = Math.PI / 2 + 0.3; scene.add(rib);
  }

  // ---- solid props (by decoration type)
  for (const b of boxes) buildProp(scene, b, W);

  // ---- central sanctuary
  const portal = makePortal(); portal.position.set(PORTAL.x, 0, PORTAL.z); scene.add(portal); W.portal = portal;
  W.tally = makeTally(); W.tally.position.set(TALLY_TABLET.x, TALLY_TABLET.y, TALLY_TABLET.z); scene.add(W.tally);
  // Gong of Dread
  const gong = new THREE.Group(); gong.position.set(GONG.x, 0, GONG.z);
  const disc = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 24), mat('#c8a040', { metal: 0.8, rough: 0.35 })); disc.rotation.z = Math.PI / 2; disc.position.y = 2.1; gong.add(disc);
  gong.add(rot(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16), mat('#a07a20', { metal: 0.8 }), 0.03, 2.1, 0), 'z', Math.PI / 2));
  for (const s of [-1, 1]) { const ch = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), mat('#555')); ch.position.set(0, 3.05, s * 0.5); ch.rotation.x = s * 0.6; gong.add(ch); }
  gong.add(mesh(new THREE.BoxGeometry(0.15, 0.15, 2.6), mat('#3a2a1c'), 0, 3.25, 0));
  const mallet = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), mat('#8a5a2a'), -0.3, 1.2, 0.9); gong.add(mallet);
  gong.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), mat('#6a3a1a'), -0.3, 1.65, 0.9));
  scene.add(gong); W.gong = disc;
  // iron chandeliers
  for (const [x, z] of [[-5, -5], [5, 5], [5, -5], [-5, 5]]) addChandelier(scene, x, z, W);
  // wall brand holder (Eternal Fire source) & sacrificial burner
  scene.add(mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), mat('#2a2a2a'), -9.9, 1.6, -3.4));
  scene.add(mesh(new THREE.CylinderGeometry(0.35, 0.25, 0.8, 8), mat('#3a3030'), -3.1, 0.4, -2.7));
  // bell of doom hanging above
  const bell = mesh(new THREE.CylinderGeometry(0.4, 1.0, 1.4, 12, 1, true), mat('#b08a3a', { metal: 0.7, side: THREE.DoubleSide })); bell.position.set(-5.6, 6.5, -7.2); scene.add(bell);
  for (const [x, z] of [[-6.9, -6.0], [-5.6, -7.2], [-4.2, -8.2]]) { const rope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.6, 5), mat('#c8a46a')); rope.position.set(x, 3.7, z); scene.add(rope); scene.add(mesh(new THREE.SphereGeometry(0.09, 6, 5), mat('#e05a3a'), x, 1.2, z)); }

  // ---- gates (dynamic)
  for (const [id, g] of Object.entries(GATES)) {
    const len = Math.hypot(g.x2 - g.x1, g.z2 - g.z1);
    const grp = new THREE.Group();
    grp.position.set((g.x1 + g.x2) / 2, 0, (g.z1 + g.z2) / 2);
    grp.rotation.y = -Math.atan2(g.z2 - g.z1, g.x2 - g.x1);
    if (g.mat === 'iron') {
      for (let i = 0; i <= 8; i++) grp.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, g.h, 5), mat('#5a5e66', { metal: 0.7 }), -len / 2 + i * len / 8, g.h / 2, 0));
      grp.add(mesh(new THREE.BoxGeometry(len, 0.1, 0.1), mat('#5a5e66', { metal: 0.7 }), 0, g.h - 0.2, 0));
      grp.add(mesh(new THREE.BoxGeometry(len, 0.1, 0.1), mat('#5a5e66', { metal: 0.7 }), 0, 0.4, 0));
    } else if (g.mat === 'barrier') {
      const plane = mesh(new THREE.PlaneGeometry(len, g.h), mat('#ff3a3a', { basic: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      plane.position.y = g.h / 2; grp.add(plane);
      for (let i = 0; i < 5; i++) grp.add(mesh(new THREE.BoxGeometry(0.12, 0.25, 0.04), mat('#ff7070', { basic: true }), -len / 2 + 0.4 + i * (len - 0.8) / 4, g.h * 0.6, 0));
    } else if (g.mat === 'oak_frost') {
      const door = mesh(new THREE.BoxGeometry(len, g.h, 0.2), mat('#4a3622'), 0, g.h / 2, 0); grp.add(door);
      for (const y of [0.5, 1.3, 2.1]) grp.add(mesh(new THREE.BoxGeometry(len + 0.02, 0.12, 0.24), mat('#4a4e56', { metal: 0.6 }), 0, y, 0));
      grp.add(mesh(new THREE.BoxGeometry(len * 0.9, g.h * 0.9, 0.22), mat('#cfe8f5', { transparent: true, opacity: 0.25 }), 0, g.h / 2, 0));
      W.doors.cold = door;
    }
    scene.add(grp);
    W.gates[id] = grp;
  }
  // cold room bolt + handles
  scene.add(mesh(new THREE.BoxGeometry(0.15, 0.12, 0.6), mat('#c8ccd4', { metal: 0.8, rough: 0.3 }), 3.75, 1.5, 18.4));
  scene.add(mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), mat('#e0b040', { metal: 0.6 }), 3.75, 1.1, 17.4));
  // frost interior
  const frost = mesh(new THREE.PlaneGeometry(6, 6), mat('#9cc4dc', { rough: 0.3 })); frost.rotation.x = -Math.PI / 2; frost.position.set(7, 0.01, 17); scene.add(frost);
  W.flicker.push(addLight(scene, 7, 2.2, 17, '#a8d8ff', 5, 9));

  // ---- selection chamber / prison
  const td = mesh(new THREE.BoxGeometry(1.4, 0.04, 1.4), mat('#5a4a3a'), TRAPDOOR.x, 0.02, TRAPDOOR.z); scene.add(td);
  scene.add(mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), mat('#8a5a2a'), TRAPDOOR.x + 1, 0.55, TRAPDOOR.z));
  const spy = mesh(new THREE.CircleGeometry(0.22, 12), mat('#ffcc55', { basic: true })); spy.position.set(SPYHOLE.x, SPYHOLE.y + 0.2, SPYHOLE.z + 0.27); scene.add(spy);
  scene.add(mesh(new THREE.TorusGeometry(0.25, 0.05, 4, 14), mat('#a08040', { metal: 0.7 }), SPYHOLE.x, SPYHOLE.y + 0.2, SPYHOLE.z + 0.28));

  // ---- intercom pipes
  for (const ic of INTERCOMS) {
    const g = new THREE.Group(); g.position.set(ic.x, 1.5, ic.z);
    const horn = mesh(new THREE.ConeGeometry(0.28, 0.5, 10, 1, true), mat('#e0b040', { metal: 0.8, rough: 0.3, side: THREE.DoubleSide }));
    horn.rotation.x = -Math.PI / 2; g.add(horn);
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), mat('#c09030', { metal: 0.8 }), 0, 1.5, 0.25));
    scene.add(g);
  }

  // ---- hazards
  for (const v of STEAM_VENTS) { const gr = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 10), mat('#4a4a4a', { metal: 0.6 })); gr.position.set(v.x, 0.02, v.z); scene.add(gr); scene.add(rot(flat(mesh(new THREE.RingGeometry(0.2, 0.5, 10), mat('#ff5533', { basic: true, transparent: true, opacity: 0.5, side: THREE.DoubleSide }), v.x, 0.05, v.z)), 'x', -Math.PI / 2)); }
  const acid = mesh(new THREE.CircleGeometry(1.5, 16), mat('#66ff33', { basic: true, transparent: true, opacity: 0.55 })); acid.rotation.x = -Math.PI / 2; acid.position.set(-28, 0.02, 0); scene.add(acid); W.acid = acid;
  const pit = mesh(new THREE.CircleGeometry(WASTE_PIT.r + 0.4, 16), mat('#000', { basic: true })); pit.rotation.x = -Math.PI / 2; pit.position.set(WASTE_PIT.x, 0.02, WASTE_PIT.z); scene.add(pit);
  scene.add(rot(mesh(new THREE.TorusGeometry(WASTE_PIT.r + 0.4, 0.12, 4, 16), mat('#4a4e56', { metal: 0.6 }), WASTE_PIT.x, 0.05, WASTE_PIT.z), 'x', Math.PI / 2));

  // ---- wayfinding: carved headers above entrances + arrow boards on corridor walls
  buildSignage(scene);

  // ---- lobby cave
  const mirror = new Reflector(new THREE.PlaneGeometry(2.2, 2.8), { textureWidth: 512, textureHeight: 640, color: '#8a8a9a' });
  mirror.position.set(LOBBY_MIRROR.x, 1.6, LOBBY_MIRROR.z + 0.32); scene.add(mirror);
  const frame = mesh(new THREE.TorusGeometry(1.75, 0.12, 4, 4), mat('#c8a040', { metal: 0.8, rough: 0.3 })); frame.rotation.z = Math.PI / 4; frame.scale.set(0.9, 1.15, 1); frame.position.set(LOBBY_MIRROR.x, 1.6, LOBBY_MIRROR.z + 0.3); scene.add(frame);
  for (const [x, z] of [[-7, -68], [7, -68], [-7, -82], [7, -82]]) W.flicker.push(addTorch(scene, x, z));
  W.flicker.push(addLight(scene, 0, 3.5, -75, '#ffb070', 14, 18));

  // ---- room lighting (warm flicker torches; cool lab)
  const torches = [[-9.5, -9], [9.5, -9], [0, -16.5], [12, -17], [-33, -3], [-21, -3], [-33, 3.5], [-21, 3.5], [21, -3], [33, -3], [21, 3.5], [33, 3.5], [-8, 25], [8, 25], [-8, 29], [8, 39]];
  for (const [x, z] of torches) W.flicker.push(addTorch(scene, x, z));
  W.flicker.push(addLight(scene, -27, 3, -10, '#ff7a30', 12, 16));
  W.flicker.push(addLight(scene, 27, 3, -10, '#40ffc0', 12, 16));
  W.flicker.push(addLight(scene, 27, 3, 10, '#ffcf80', 9, 15));
  W.flicker.push(addLight(scene, -27, 3, 10, '#ffa060', 9, 15));
  W.flicker.push(addLight(scene, 0, 3, 20, '#ff8040', 10, 16));
  W.flicker.push(addLight(scene, 0, 3, 34, '#90a0c0', 8, 14));
  W.flicker.push(addLight(scene, 0, 3, -19, '#ffb070', 8, 12));
  return W;
}

function addLight(scene, x, y, z, color, intensity, dist) {
  const l = new THREE.PointLight(color, intensity * 3, dist * 1.3, 1.2); l.position.set(x, y, z); scene.add(l);
  return { l, base: intensity, seed: Math.random() * 100 };
}
function addTorch(scene, x, z) {
  scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5), mat('#3a2a1a'), x, 2.3, z));
  scene.add(mesh(new THREE.ConeGeometry(0.13, 0.35, 6), mat('#ffb02e', { basic: true }), x, 2.75, z));
  return addLight(scene, x, 2.8, z, '#ff9a40', 7, 11);
}
function addChandelier(scene, x, z, W) {
  const g = new THREE.Group(); g.position.set(x, 5.5, z);
  g.add(rot(mesh(new THREE.TorusGeometry(0.8, 0.05, 4, 12), mat('#2a2a2a', { metal: 0.6 })), 'x', Math.PI / 2));
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat('#ffcf66', { basic: true }), Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8)); }
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), mat('#2a2a2a'), 0, 2, 0));
  scene.add(g);
  W.flicker.push(addLight(scene, x, 5, z, '#ffc070', 9, 14));
}

function buildProp(scene, b, W) {
  const base = BOX_COL[b.mat] || '#444';
  const g = new THREE.Group(); g.position.set(b.x, 0, b.z); scene.add(g);
  const B = (w, h, d, c, x = 0, y = h / 2, z = 0, o = {}) => g.add(mesh(new THREE.BoxGeometry(w, h, d), mat(c, o), x, y, z));
  switch (b.deco) {
    case 'boiler': {
      const body = mesh(new THREE.CylinderGeometry(1.9, 2.1, 4.2, 14), mat('#2f2a26', { metal: 0.5, rough: 0.6 })); body.position.y = 2.1; g.add(body);
      for (let i = 0; i < 14; i++) for (const y of [0.6, 2.1, 3.6]) { const a = i / 14 * 6.28; g.add(mesh(new THREE.SphereGeometry(0.06, 5, 4), mat('#5a504a', { metal: 0.6 }), Math.cos(a) * 2.02, y, Math.sin(a) * 2.02)); }
      B(1.6, 0.9, 0.3, '#ff5a1a', 0, 0.6, 2.0, { emissive: '#ff4400', ei: 2 });           // firebox
      for (let i = 0; i < 5; i++) B(0.06, 0.9, 0.05, '#222', -0.6 + i * 0.3, 0.6, 2.18);     // grate
      const gauge = mesh(new THREE.CircleGeometry(0.4, 16), mat('#f2ead8', { basic: true })); gauge.position.set(0.9, 3.0, 2.0); g.add(gauge);
      const needle = mesh(new THREE.BoxGeometry(0.04, 0.34, 0.02), mat('#d01010', { basic: true })); needle.position.set(0.9, 3.05, 2.02); g.add(needle); W.gaugeNeedle = needle;
      for (const s of [-1, 1]) { const p = mesh(new THREE.CylinderGeometry(0.18, 0.18, 3, 8), mat('#b06a30', { metal: 0.7 })); p.position.set(s * 1.2, 5, 0); g.add(p); }
      // the elevated main valve (3 m) for Minion Stacking
      const v = mesh(new THREE.TorusGeometry(0.35, 0.06, 5, 12), mat('#e0302a', { emissive: '#801010', metal: 0.4 })); v.position.set(4.5, 3.0, -5.3); g.add(v);
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), mat('#b06a30', { metal: 0.7 }), 4.5, 1.5, -5.4));
      W.flicker.push(addLight(scene, b.x, 0.9, b.z + 2.6, '#ff5a1a', 6, 7));
      break;
    }
    case 'coalpile': for (let i = 0; i < 18; i++) g.add(mesh(new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.2), mat(i % 3 ? '#1a1a1a' : '#4cff7a', i % 3 ? {} : { emissive: '#1a8a3a' }), (Math.random() - 0.5) * 1.6, Math.random() * 0.8, (Math.random() - 0.5) * 5)); break;
    case 'anvil': B(0.6, 0.6, 0.6, '#5a4030', 0, 0.3); B(1.2, 0.3, 0.5, '#2a2c30', 0, 0.75, 0, { metal: 0.7, rough: 0.4 }); g.add(rot(mesh(new THREE.ConeGeometry(0.2, 0.5, 6), mat('#2a2c30', { metal: 0.7 }), -0.8, 0.75, 0), 'z', Math.PI / 2)); B(0.4, 0.08, 0.1, '#ff5a1a', 0, 0.94, 0, { emissive: '#ff3300', ei: 2 }); break;
    case 'sandbags': for (let i = 0; i < 12; i++) { const s = mesh(new THREE.SphereGeometry(0.42, 8, 6), mat('#b8955a', { rough: 1 })); s.scale.set(1.2, 0.6, 0.9); s.position.set((i % 2 - 0.5) * 0.9, 0.25 + Math.floor(i / 4) * 0.4, ((i >> 1) % 2 - 0.5) * 2.4 + (Math.floor(i / 4) - 1) * 0.6); g.add(s); } break;
    case 'table': case 'bench_lab':
      B(b.w, 0.12, b.d, '#5a4430', 0, b.h - 0.06);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(0.1, b.h - 0.12, 0.1, '#3a2c20', sx * (b.w / 2 - 0.1), (b.h - 0.12) / 2, sz * (b.d / 2 - 0.1));
      if (b.deco === 'bench_lab') for (let i = 0; i < 6; i++) { const c = ['#40ffc0', '#ff40a0', '#80a0ff', '#ffe040'][i % 4]; g.add(mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(c, { emissive: c, ei: 1.2, transparent: true, opacity: 0.85 }), -3 + i * 1.2, b.h + 0.15, 0)); g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), mat('#d8f4ff', { transparent: true, opacity: 0.5 }), -3 + i * 1.2, b.h + 0.35, 0)); }
      break;
    case 'machine': B(b.w, b.h, b.d, '#8a6a28', 0, b.h / 2, 0, { metal: 0.8, rough: 0.35 }); g.add(rot(mesh(new THREE.CircleGeometry(0.5, 16), mat('#f2ead8', { basic: true }), -b.w / 2 - 0.01, 1.8, 0), 'y', -Math.PI / 2)); g.add(rot(mesh(new THREE.ConeGeometry(0.3, 0.5, 8, 1, true), mat('#e0b040', { metal: 0.8, side: THREE.DoubleSide }), -0.6, b.h + 0.2, 0), 'x', Math.PI)); break;
    case 'scale': B(0.5, b.h, 0.5, '#5a4430', 0, b.h / 2); B(0.06, 0.6, 0.06, '#e0b040', 0, b.h + 0.3, 0, { metal: 0.8 }); B(1.1, 0.04, 0.04, '#e0b040', 0, b.h + 0.6, 0, { metal: 0.8 }); for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.06, 10), mat('#e0b040', { metal: 0.8 }), s * 0.5, b.h + 0.35, 0)); break;
    case 'shelf': {
      B(b.w, b.h, b.d, '#2e2218');
      const cols = ['#7a2a2a', '#2a4a7a', '#3a6a2a', '#7a6a2a', '#5a2a6a'];
      const along = b.w > b.d;
      for (let row = 0; row < 5; row++) for (let i = 0; i < 10; i++) {
        const len = along ? b.w : b.d;
        const p = -len / 2 + 0.25 + i * (len - 0.5) / 9;
        const bk = mesh(new THREE.BoxGeometry(along ? 0.28 : 0.2, 0.55, along ? 0.2 : 0.28), mat(cols[(row * 3 + i) % 5]));
        bk.position.set(along ? p : -b.w / 2 - 0.02, 0.5 + row * 0.85, along ? -b.d / 2 - 0.02 : p);
        g.add(bk);
      }
      break;
    }
    case 'lectern': B(0.4, b.h, 0.4, '#45444a', 0, b.h / 2); const bk = mesh(new THREE.BoxGeometry(1.0, 0.18, 0.7), mat('#6a2a1a')); bk.position.y = b.h + 0.1; bk.rotation.x = -0.3; g.add(bk); g.add(rot(mesh(new THREE.BoxGeometry(0.95, 0.04, 0.65), mat('#f2e6c4'), 0, b.h + 0.21, 0), 'x', -0.3)); break;
    case 'hearth': B(b.w, b.h, b.d, '#3a2a26'); B(b.w * 0.6, 0.7, 0.2, '#ff6a1a', 0, 0.45, b.d / 2, { emissive: '#ff4400', ei: 2 }); B(1, 2.5, 1, '#2a201c', -2, b.h + 1.25, 0); g.add(mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.3, 10), mat('#2a2a2a', { metal: 0.6 }), 0, b.h + 0.15, 0.2)); W.flicker.push(addLight(scene, b.x, 0.8, b.z + 1.2, '#ff6a1a', 7, 8)); break;
    case 'cauldron': g.add(mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), mat('#1e1e22', { metal: 0.6 }), 0, 0.85, 0)); g.add(rot(flat(mesh(new THREE.CircleGeometry(0.72, 14), mat('#8aa040', { emissive: '#3a5010', ei: 1 }), 0, 1.0, 0)), 'x', -Math.PI / 2)); const pad = mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), mat('#8a5a2a')); pad.position.set(0.2, 1.3, 0); pad.rotation.z = 0.4; g.add(pad); break;
    case 'mill': g.add(mesh(new THREE.CylinderGeometry(0.9, 0.3, 0.9, 8, 1, true), mat('#4a4e56', { metal: 0.6, side: THREE.DoubleSide }), 0, b.h + 0.45, 0)); B(b.w, b.h, b.d, '#4a3a2c'); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; g.add(mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat('#c8ccd4', { metal: 0.7 }), Math.cos(a) * 0.5, b.h + 0.15, Math.sin(a) * 0.5)); } break;
    case 'capstan': {
      B(0.7, 1.3, 0.7, '#5a4430', 0, 0.65);
      const wheel = new THREE.Group(); wheel.position.y = 1.0; g.add(wheel); W.capstan = wheel;
      for (let i = 0; i < 4; i++) { const arm = mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), mat('#c99a5b')); arm.rotation.y = i * Math.PI / 4; wheel.add(arm); }
      wheel.add(flat(mesh(new THREE.TorusGeometry(1.5, 0.06, 4, 16), mat('#8a5a2a'))));
      break;
    }
    case 'bones': for (let i = 0; i < 26; i++) { const s = mesh(new THREE.SphereGeometry(0.16, 6, 5), mat('#d8d0b8')); s.position.set((Math.random() - 0.5) * 2, Math.random() * 1.1, (Math.random() - 0.5) * 5.5); g.add(s); } break;
    case 'bowl': B(b.w, b.h, b.d, '#3a3940'); g.add(rot(mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, 6.28, 0, 1.4), mat('#45444a'), 0, b.h + 0.3, 0), 'x', Math.PI)); g.add(mesh(new THREE.ConeGeometry(0.3, 0.5, 6), mat('#9b4dff', { basic: true }), 0, b.h + 0.35, 0)); break;
    case 'bench': B(b.w, b.h, b.d, '#3a3940'); break;
    default: B(b.w, b.h, b.d, base);
  }
}

// ---- runic sacrifice tally tablet (canvas texture)
function makeTally() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(4.2, 2.1, 0.3), mat('#3a3940')));
  for (const s of [1, -1]) { const face = mesh(new THREE.PlaneGeometry(4, 1.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); face.position.z = s * 0.16; if (s < 0) face.rotation.y = Math.PI; g.add(face); }
  g.userData = { c, tex, key: '' };
  return g;
}
export function updateTally(tablet, tally) {
  const key = JSON.stringify(tally);
  if (tablet.userData.key === key) return;
  tablet.userData.key = key;
  const { c, tex } = tablet.userData, x = c.getContext('2d');
  x.clearRect(0, 0, 512, 256);
  x.fillStyle = '#d8d0c0'; x.font = 'bold 34px serif'; x.textAlign = 'center'; x.fillText('ᛟ OFFERINGS ᛟ', 256, 50);
  const items = [['🔥', tally.fire, '#ff8a1c'], ['🩸', tally.blood, '#ff3355'], ['🔮', tally.chaos, '#b06bff']];
  items.forEach(([ic, n, col], i) => { x.fillStyle = col; x.font = 'bold 80px serif'; x.fillText(String(n), 100 + i * 156, 180); x.font = '40px serif'; x.fillText(ic, 100 + i * 156, 236); });
  tex.needsUpdate = true;
}

// ============================================================================
//  SIGNAGE — painted wooden boards (canvas text). Plane faces +Z before rotY.
//  rotY: 0 → faces south (+z), PI → north (−z), PI/2 → east (+x), −PI/2 → west (−x)
// ============================================================================
function makeSign(text, { w = 4, h = 0.8, header = false, color = '#f2dcae' } = {}) {
  const c = document.createElement('canvas');
  const scale = 128; c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  // planks
  const grd = g.createLinearGradient(0, 0, 0, c.height); grd.addColorStop(0, '#6a4626'); grd.addColorStop(1, '#3e2814');
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
  for (let y = c.height / 3; y < c.height; y += c.height / 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  g.strokeStyle = '#c8a040'; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = Math.round(c.height * (header ? 0.5 : 0.46));
  g.font = `bold ${size}px "Palatino Linotype", Georgia, serif`;
  while (g.measureText(text).width > c.width - 40 && size > 10) { size -= 2; g.font = `bold ${size}px "Palatino Linotype", Georgia, serif`; }
  g.shadowColor = '#000'; g.shadowBlur = 6;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const grp = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), mat('#3e2814'));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.z = 0.045;
  grp.add(board, face);
  if (header) for (const sx of [-1, 1]) grp.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), mat('#555', { metal: 0.6 }), sx * (w / 2 - 0.2), h / 2 + 0.45, 0));
  return grp;
}
function sign(scene, text, x, y, z, rotY, opts) { const s = makeSign(text, opts); s.position.set(x, y, z); s.rotation.y = rotY; scene.add(s); return s; }

function buildSignage(scene) {
  const H = { header: true, w: 4.6, h: 0.75 };
  const S = Math.PI, E = Math.PI / 2, Wst = -Math.PI / 2;
  // Room headers above the entrances (readable from the approach side)
  sign(scene, 'SELECTION CHAMBER', 0, 3.6, -13.7, 0, H);
  sign(scene, 'PRISON OF THE REJECTED', 10, 3.3, -13.7, 0, { ...H, w: 4.2 });
  sign(scene, 'BOILER ROOM & ENGINE ROOM', -26, 3.6, -1.75, 0, { ...H, w: 6 });
  sign(scene, 'ARMORY & WORKSHOP', -26, 3.6, 1.75, S, { ...H, w: 6 });
  sign(scene, 'ALCHEMY LAB', 26, 3.6, -1.75, 0, { ...H, w: 6 });
  sign(scene, 'LIBRARY & SCRIPTORIUM', 26, 3.6, 1.75, S, { ...H, w: 6 });
  sign(scene, 'KITCHEN & COLD ROOM', 0, 3.6, 13.7, S, H);
  sign(scene, 'BONE MILL & WASTE PIT', 0, 3.6, 25.7, S, H);
  sign(scene, 'COLD ROOM', 3.7, 2.9, 17, Wst, { header: true, w: 1.9, h: 0.5 });
  sign(scene, 'WEST WING', -17.7, 3.6, 0, E, { ...H, w: 3.6 });
  sign(scene, 'EAST WING', 17.7, 3.6, 0, Wst, { ...H, w: 3.6 });
  sign(scene, 'CENTRAL SANCTUARY', -18.3, 3.6, 0, Wst, { ...H, w: 3.6 });
  sign(scene, 'CENTRAL SANCTUARY', 18.3, 3.6, 0, E, { ...H, w: 3.6 });
  // Directional arrows on corridor walls (offset 0.27 m from the wall centre line)
  const A = { w: 3.6, h: 0.5 };
  // west corridor (walls z = ±2)
  sign(scene, '◄ BOILER ROOM • ARMORY    SANCTUARY ►', -14.5, 1.9, -1.72, 0, A);
  sign(scene, '◄ SANCTUARY    BOILER ROOM • ARMORY ►', -14.5, 1.9, 1.72, S, A);
  // east corridor
  sign(scene, '◄ SANCTUARY    ALCHEMY LAB • LIBRARY ►', 14.5, 1.9, -1.72, 0, A);
  sign(scene, '◄ ALCHEMY LAB • LIBRARY    SANCTUARY ►', 14.5, 1.9, 1.72, S, A);
  // north corridor (walls x = ±2)
  sign(scene, '◄ SANCTUARY    SELECTION CHAMBER ►', -1.72, 1.9, -12.4, E, { w: 2.6, h: 0.45 });
  sign(scene, '◄ PRISON OF THE REJECTED', 6.5, 1.9, -11.88, S, { w: 3, h: 0.45 });
  // south corridor
  sign(scene, '◄ KITCHEN • BONE MILL    SANCTUARY ►', -1.72, 1.9, 12.4, E, { w: 2.6, h: 0.45 });
  sign(scene, '◄ SANCTUARY    KITCHEN • BONE MILL ►', 1.72, 1.9, 12.4, Wst, { w: 2.6, h: 0.45 });
  // halls: point to the two rooms of each wing
  sign(scene, '◄ ARMORY    BOILER ROOM ►', -35.72, 1.9, 0, E, { w: 3.4, h: 0.5 });
  sign(scene, '◄ ALCHEMY LAB    LIBRARY ►', 35.72, 1.9, 0, Wst, { w: 3.4, h: 0.5 });
  // kitchen → bone mill stairs
  sign(scene, '▼ BONE MILL (stairs)', -3.5, 2.2, 25.72, S, { w: 2.4, h: 0.45 });
}
