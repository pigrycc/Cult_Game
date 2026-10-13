// ============================================================================
//  LOW-POLY MODEL FACTORIES (Shape Language first)
//  • Minions: 1:1 hood-to-body, black hood void, two glowing dot eyes, gloves
//  • Captives: same minion model, grey robe, burlap sack over the head, ropes
//  • Tools & props: chunky / oversized and SATURATED (environment stays muted)
// ============================================================================
import * as THREE from 'three';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = opts.basic ? new THREE.MeshBasicMaterial({ color, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, depthWrite: opts.depthWrite ?? true, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: opts.side ?? THREE.FrontSide })
    : new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1, flatShading: opts.flat ?? true, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide });
  if (!opts.unique) matCache.set(key, m);
  return m;
}
const G = {
  sphere: (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  cyl: (a, b, h, s = 8) => new THREE.CylinderGeometry(a, b, h, s),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  torus: (r, t, a = 6, b = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, a, b, arc),
};
export function flat(m) { m.rotation.x = Math.PI / 2; return m; }
export function mesh(geo, material, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return m; }

// --------------------------------------------------------------------------- minion
const robeProfile = [
  [0.0, 0], [0.37, 0], [0.36, 0.06], [0.32, 0.2], [0.27, 0.36], [0.23, 0.5], [0.2, 0.56], [0.0, 0.58],
].map(([x, y]) => new THREE.Vector2(x, y));
const ROBE_GEO = new THREE.LatheGeometry(robeProfile, 9);
const HEM_GEO = (() => { // tattered hem: ring of little triangles
  const g = new THREE.ConeGeometry(0.06, 0.12, 3); g.rotateX(Math.PI); return g;
})();

export function makeMinion(color = '#d9b23a', { npc = false } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);       // tilts during ragdoll
  const robeMat = mat(color, { rough: 0.95, unique: true });
  const robe = mesh(ROBE_GEO, robeMat); body.add(robe);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2;
    const t = mesh(HEM_GEO, robeMat, Math.cos(a) * 0.35, 0.03, Math.sin(a) * 0.35); body.add(t);
  }
  // belt + public crystal pouch
  body.add(flat(mesh(G.torus(0.25, 0.03, 4, 12), mat('#3b2a1a'), 0, 0.42, 0)));
  const pouch = mesh(G.box(0.14, 0.13, 0.08), mat('#5a3a20'), 0.16, 0.36, -0.2); body.add(pouch);
  const crystals = new THREE.Group(); crystals.position.set(0.16, 0.46, -0.2); body.add(crystals);
  const head = new THREE.Group(); head.position.y = 0.82; body.add(head);
  const hood = mesh(G.sphere(0.31, 10, 8), robeMat); hood.scale.set(1, 1.02, 1.05); head.add(hood);
  const tip = mesh(G.cone(0.16, 0.34, 7), robeMat, 0, 0.18, 0.2); tip.rotation.x = 1.0; head.add(tip);
  const eyes = new THREE.Group(); head.add(eyes);
  if (!npc) {
    const voidM = mesh(G.sphere(0.235, 10, 8), mat('#000000', { basic: true }), 0, -0.02, -0.11); voidM.scale.set(1, 0.95, 0.85); head.add(voidM);
    const eyeMat = mat('#fff3a0', { basic: true });
    for (const s of [-1, 1]) eyes.add(mesh(G.sphere(0.042, 8, 6), eyeMat, s * 0.085, 0.0, -0.3));
  } else {
    const sack = mesh(G.sphere(0.34, 9, 7), mat('#8a6a42', { rough: 1 })); sack.scale.set(1, 1.08, 1); head.add(sack);
    head.add(flat(mesh(G.torus(0.27, 0.035, 4, 12), mat('#c8a46a'), 0, -0.2, 0)));
    for (const y of [0.18, 0.3]) body.add(flat(mesh(G.torus(0.3 - y * 0.25, 0.03, 4, 12), mat('#c8a46a'), 0, y, 0)));
  }
  // gloves
  const handMat = mat('#4a3020');
  const hands = [mesh(G.sphere(0.085, 8, 6), handMat, -0.32, 0.36, -0.08), mesh(G.sphere(0.085, 8, 6), handMat, 0.32, 0.36, -0.08)];
  hands.forEach(h => body.add(h));
  const toolSocket = new THREE.Group(); hands[1].add(toolSocket);
  const overhead = new THREE.Group(); overhead.position.y = 1.35; root.add(overhead);
  const xray = mesh(G.sphere(0.5, 8, 6), mat('#ffcc33', { basic: true, transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.6, 0);
  xray.material = xray.material.clone(); xray.material.depthTest = false; xray.renderOrder = 999; xray.visible = false; root.add(xray);
  root.userData = { body, robeMat, head, eyes, hands, crystals, toolSocket, overhead, xray, color, phase: Math.random() * 10, crystalCount: -1 };
  return root;
}

const CRYSTAL_GEO = new THREE.OctahedronGeometry(0.035);
export function setCrystals(minion, n) {
  const u = minion.userData;
  if (u.crystalCount === n) return;
  u.crystalCount = n;
  u.crystals.clear();
  const m = mat('#58e8ff', { emissive: '#2bc8ff', ei: 1.6 });
  for (let i = 0; i < Math.min(n, 6); i++) u.crystals.add(mesh(CRYSTAL_GEO, m, (i % 3 - 1) * 0.045, Math.floor(i / 3) * 0.06, 0));
}

export function setMinionColor(minion, color) {
  if (minion.userData.color === color) return;
  minion.userData.color = color; minion.userData.robeMat.color.set(color);
}

export function setGhost(minion, ghost) {
  const u = minion.userData;
  if (u.ghost === ghost) return;
  u.ghost = ghost;
  minion.traverse(o => {
    if (!o.isMesh || o === u.xray) return;
    if (ghost) { o.userData.origMat = o.userData.origMat || o.material; o.material = mat('#9fdcff', { transparent: true, opacity: 0.38, basic: true }); }
    else if (o.userData.origMat) o.material = o.userData.origMat;
  });
}

/** Procedural animation: pitter-patter walk, working arms, ragdoll tumble. */
export function animateMinion(m, dt, s) {
  const u = m.userData;
  u.phase += dt * (6 + s.speed * 3.2);
  const ph = u.phase;
  const moving = s.speed > 0.4;
  const B = u.body;
  if (s.ragdoll > 0) {
    // tumbling ragdoll: whole body rotates with travelled distance, limbs flail
    B.rotation.x = s.spin * 1.3; B.rotation.z = Math.sin(s.spin * 0.7) * 1.2;
    B.position.y = 0.3;
    u.hands[0].position.set(-0.36 + Math.sin(ph * 3) * 0.12, 0.5 + Math.cos(ph * 3.3) * 0.2, 0);
    u.hands[1].position.set(0.36 + Math.cos(ph * 2.7) * 0.12, 0.5 + Math.sin(ph * 3.1) * 0.2, 0);
    u.eyes.scale.set(1.4, 0.25, 1);
    return;
  }
  B.rotation.x *= 0.8; B.rotation.z = moving ? Math.sin(ph) * 0.11 : B.rotation.z * 0.8;
  B.position.y = moving ? Math.abs(Math.sin(ph)) * 0.06 : 0;
  if (s.carried) { B.rotation.x = -1.4; B.position.y = 0; }
  if (s.sitting) B.position.y = -0.05;
  const blink = (Math.sin(ph * 0.21 + u.color.length) > 0.985) ? 0.15 : 1;
  u.eyes.scale.set(1, s.fumes ? 0.5 + Math.sin(ph) * 0.3 : blink, 1);
  if (s.working) {
    u.hands[0].position.set(-0.22, 0.5 + Math.sin(ph * 2.2) * 0.12, -0.28);
    u.hands[1].position.set(0.22, 0.5 + Math.cos(ph * 2.2) * 0.12, -0.28);
  } else if (s.lifting) {
    u.hands[0].position.set(-0.22, 1.25, -0.02); u.hands[1].position.set(0.22, 1.25, -0.02);
  } else if (s.holdingFront) {
    u.hands[0].position.set(-0.2, 0.42, -0.32); u.hands[1].position.set(0.2, 0.42, -0.32);
  } else {
    u.hands[0].position.set(-0.32, 0.36 + (moving ? Math.sin(ph) * 0.05 : 0), -0.08 + (moving ? Math.sin(ph) * 0.08 : 0));
    u.hands[1].position.set(0.32, 0.36 - (moving ? Math.sin(ph) * 0.05 : 0), -0.08 - (moving ? Math.sin(ph) * 0.08 : 0));
  }
}

// --------------------------------------------------------------------------- tools (chunky!)
const WOOD_L = '#c99a5b', IRON = '#9aa3ad', BRASS = '#e0b040';
export function makeTool(type) {
  const g = new THREE.Group();
  const stick = (len, r = 0.03, color = WOOD_L) => { const s = mesh(G.cyl(r, r * 1.15, len, 6), mat(color)); s.position.y = len / 2; return s; };
  switch (type) {
    case 'broom': {
      g.add(stick(1.25, 0.028));
      const straw = mesh(G.cone(0.2, 0.42, 9), mat('#f2c443', { rough: 1 }), 0, -0.05, 0); straw.rotation.x = Math.PI; g.add(straw);
      g.add(mesh(G.sphere(0.17, 8, 6), mat('#e8b838', { rough: 1 }), 0, 0.02, 0));
      g.add(flat(mesh(G.torus(0.08, 0.025, 4, 8), mat('#8b3a1a'), 0, 0.2, 0)));
      for (let i = 0; i < 7; i++) { const tw = mesh(G.cyl(0.008, 0.008, 0.35, 3), mat('#a87a2a'), Math.cos(i) * 0.12, -0.2, Math.sin(i) * 0.12); tw.rotation.z = Math.cos(i * 2) * 0.5; g.add(tw); }
      break;
    }
    case 'wrench': {
      g.add(mesh(G.box(0.1, 0.75, 0.05), mat(IRON, { metal: 0.6, rough: 0.4 }), 0, 0.37, 0));
      g.add(mesh(G.box(0.26, 0.09, 0.07), mat(IRON, { metal: 0.6, rough: 0.4 }), 0.06, 0.78, 0));
      g.add(mesh(G.box(0.07, 0.16, 0.07), mat('#c0c8d0', { metal: 0.7, rough: 0.3 }), 0.16, 0.9, 0));
      g.add(mesh(G.box(0.07, 0.12, 0.07), mat('#c0c8d0', { metal: 0.7, rough: 0.3 }), -0.04, 0.88, 0));
      const sc = mesh(G.cyl(0.035, 0.035, 0.12, 8), mat(BRASS, { metal: 0.6 }), 0.06, 0.68, 0); sc.rotation.z = Math.PI / 2; g.add(sc);
      break;
    }
    case 'shovel': g.add(stick(1.1)); g.add(mesh(G.box(0.3, 0.36, 0.04), mat('#8d9399', { metal: 0.5 }), 0, -0.12, 0)); break;
    case 'oilcan': {
      g.add(mesh(G.cyl(0.11, 0.14, 0.2, 10), mat(BRASS, { metal: 0.8, rough: 0.3 }), 0, 0.1, 0));
      const sp = mesh(G.cone(0.03, 0.45, 6), mat(BRASS, { metal: 0.8, rough: 0.3 }), 0, 0.38, -0.12); sp.rotation.x = -0.6; g.add(sp);
      g.add(mesh(G.torus(0.07, 0.015, 4, 8), mat('#6a4a20'), 0, 0.18, 0.12));
      break;
    }
    case 'hammer': g.add(stick(0.6)); g.add(mesh(G.box(0.32, 0.16, 0.16), mat('#7a7f88', { metal: 0.5 }), 0, 0.66, 0)); break;
    case 'mop': {
      g.add(stick(1.2));
      for (let i = 0; i < 10; i++) { const s = mesh(G.cyl(0.02, 0.02, 0.3, 3), mat('#efe6c8'), Math.cos(i) * 0.08, -0.12, Math.sin(i) * 0.08); s.rotation.z = Math.cos(i) * 0.3; g.add(s); }
      break;
    }
    case 'brush': g.add(stick(1.2)); g.add(mesh(new THREE.IcosahedronGeometry(0.18, 0), mat('#222222', { rough: 1 }), 0, 1.25, 0)); break;
    case 'gaff': g.add(stick(1.3)); g.add(mesh(G.torus(0.1, 0.022, 4, 8, Math.PI * 1.3), mat(IRON, { metal: 0.6 }), 0.08, 1.35, 0)); break;
    default: g.add(mesh(G.box(0.2, 0.2, 0.2), mat('#ff00ff')));
  }
  return g;
}

export function makeItem(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'brand': g.add(mesh(G.cyl(0.03, 0.035, 0.5, 6), mat('#5a3a20'), 0, 0.25, 0)); g.add(mesh(G.cone(0.08, 0.22, 6), mat('#ffb02e', { emissive: '#ff7a00', ei: 2 }), 0, 0.6, 0)); break;
    case 'coal': g.add(mesh(new THREE.DodecahedronGeometry(0.13), mat('#7dff9a', { emissive: '#22ff66', ei: 1.5 }))); break;
    case 'tool_s': g.add(mesh(G.box(0.08, 0.4, 0.05), mat('#b0b6bd', { metal: 0.6 }), 0, 0.2, 0)); g.add(mesh(G.box(0.2, 0.08, 0.06), mat('#b0b6bd', { metal: 0.6 }), 0, 0.42, 0)); break;
    case 'alcohol': case 'oiljug': {
      const c = type === 'alcohol' ? '#7fd8ff' : '#e0a030';
      g.add(mesh(G.sphere(0.14, 10, 8), mat(c, { emissive: c, ei: 0.8, transparent: true, opacity: 0.8 }), 0, 0.14, 0));
      g.add(mesh(G.cyl(0.04, 0.05, 0.2, 8), mat('#d8f4ff', { transparent: true, opacity: 0.6 }), 0, 0.33, 0));
      break;
    }
    case 'book': {
      g.add(mesh(G.box(0.36, 0.1, 0.28), mat('#8e2a2a'), 0, 0.05, 0));
      g.add(mesh(G.box(0.34, 0.06, 0.26), mat('#f0e0c0'), 0.01, 0.11, 0));
      for (let i = 0; i < 5; i++) g.add(mesh(G.cone(0.02, 0.06, 3), mat('#ffffff'), -0.12 + i * 0.06, 0.16, -0.14));
      break;
    }
    case 'fat': g.add(mesh(G.box(0.26, 0.18, 0.2), mat('#f2e6c4'), 0, 0.09, 0)); break;
    case 'skull': g.add(mesh(G.sphere(0.13, 8, 6), mat('#e8e0c8'), 0, 0.14, 0)); for (const s of [-1, 1]) g.add(mesh(G.sphere(0.035, 6, 4), mat('#000', { basic: true }), s * 0.05, 0.16, -0.11)); break;
    case 'sandbag': { const s = mesh(G.sphere(0.32, 9, 7), mat('#b8955a', { rough: 1 }), 0, 0.26, 0); s.scale.set(1.15, 0.8, 0.9); g.add(s); g.add(flat(mesh(G.torus(0.09, 0.03, 4, 8), mat('#6a4a2a'), 0, 0.5, 0))); break; }
    case 'carcass': g.add(mesh(G.box(0.8, 0.36, 0.42), mat('#cfe8f5', { emissive: '#3a6a80', ei: 0.3 }), 0, 0.2, 0)); g.add(mesh(G.box(0.7, 0.3, 0.36), mat('#b34a4a'), 0, 0.2, 0)); break;
    default: g.add(mesh(G.box(0.2, 0.2, 0.2), mat('#ff00ff')));
  }
  return g;
}

export function makeCoins(n) {
  const g = new THREE.Group();
  const m = mat('#ffd34d', { metal: 0.8, rough: 0.3, emissive: '#7a5a00', ei: 0.6 });
  for (let i = 0; i < Math.min(8, Math.max(1, n)); i++) g.add(mesh(G.cyl(0.07, 0.07, 0.025, 10), m, (Math.random() - 0.5) * 0.2, 0.02 + i * 0.026, (Math.random() - 0.5) * 0.2));
  return g;
}

// --------------------------------------------------------------------------- task markers (saturation as affordance)
export function makeMarker(color) {
  const g = new THREE.Group();
  const m = mat(color, { basic: true, transparent: true, opacity: 0.9 });
  const d = mesh(new THREE.OctahedronGeometry(0.11), m); g.add(d);
  const ring = mesh(G.torus(0.2, 0.018, 4, 16), mat(color, { basic: true, transparent: true, opacity: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.y = -0.3; g.add(ring);
  g.userData.diamond = d; g.userData.ring = ring;
  return g;
}

// --------------------------------------------------------------------------- portal vortex
export function makePortal() {
  const g = new THREE.Group();
  const ring = mesh(new THREE.RingGeometry(2.3, 3.0, 40), mat('#6b2bd6', { basic: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  const dais = mesh(G.cyl(3.2, 3.4, 0.2, 24), mat('#3b3740')); dais.position.y = 0.0; g.add(dais);
  // rune glyph spokes
  for (let i = 0; i < 12; i++) {
    const r = mesh(G.box(0.12, 0.02, 0.5), mat(['#ff4466', '#ff9922', '#b066ff'][i % 3], { basic: true }));
    const a = i / 12 * Math.PI * 2; r.position.set(Math.cos(a) * 2.65, 0.12, Math.sin(a) * 2.65); r.rotation.y = -a; g.add(r);
  }
  const layers = [];
  for (let i = 0; i < 6; i++) {
    const cone = mesh(new THREE.CylinderGeometry(2.0 - i * 0.28, 0.12, 2.4 + i * 0.25, 20, 1, true),
      mat(i % 2 ? '#2a0a4a' : '#8a3bff', { basic: true, transparent: true, opacity: 0.35 + i * 0.05, side: THREE.DoubleSide, additive: i % 2 === 0, depthWrite: false, unique: true }));
    cone.position.y = 1.3 + i * 0.05; cone.rotation.x = Math.PI; g.add(cone); layers.push(cone);
  }
  const core = mesh(G.sphere(0.5, 12, 10), mat('#000000', { basic: true })); core.position.y = 0.6; g.add(core);
  // floating glyph particles
  const N = 240, pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push({ a: Math.random() * 6.28, r: 1 + Math.random() * 3.5, y: Math.random() * 4, s: 0.3 + Math.random() });
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#c58bff', size: 0.09, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(pts);
  const light = new THREE.PointLight('#9b4dff', 18, 16, 1.6); light.position.y = 2; g.add(light);
  g.userData = { layers, pts, seeds, light, burst: 0 };
  return g;
}
export function animatePortal(p, t, dt) {
  const u = p.userData;
  u.layers.forEach((l, i) => { l.rotation.y = t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1); });
  const pos = u.pts.geometry.attributes.position.array;
  u.seeds.forEach((s, i) => {
    s.a += dt * s.s * (1.5 / s.r + 0.3); s.r -= dt * 0.35 * s.s; s.y -= dt * 0.25;
    if (s.r < 0.3) { s.r = 3.5 + Math.random(); s.y = Math.random() * 4; }
    pos[i * 3] = Math.cos(s.a) * s.r; pos[i * 3 + 1] = Math.max(0.1, s.y); pos[i * 3 + 2] = Math.sin(s.a) * s.r;
  });
  u.pts.geometry.attributes.position.needsUpdate = true;
  u.burst = Math.max(0, u.burst - dt);
  u.light.intensity = 14 + Math.sin(t * 3) * 3 + u.burst * 60;
}
