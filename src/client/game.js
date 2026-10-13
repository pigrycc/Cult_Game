// ============================================================================
//  CLIENT GAME — FPP controller with client-side prediction + server
//  reconciliation, 100 ms interpolation of remote minions, crosshair
//  targeting, FPP viewmodel (chunky tools with inertia), entity rendering.
// ============================================================================
import * as THREE from 'three';
import { makeBody, stepBody, EYE_H, wallsBetween } from '../shared/physics.js';
import { PHASE, CER, ROLE_BY_ID, INTERACT_RANGE, NPC_INSPECT_RANGE } from '../shared/constants.js';
import { LOBBY_MIRROR, SPYHOLE, roomAt, ROOMS, walls as MAP_WALLS } from '../shared/map.js';
import { TOOLS, ITEM_TYPES, RUNES } from '../shared/tasks.js';
import { buildWorld, updateTally } from './world.js';
import { makeMinion, animateMinion, setCrystals, setMinionColor, setGhost, makeTool, makeItem, makeCoins, makeMarker, animatePortal, mat, mesh } from './models.js';
import { FX } from './fx.js';

const INTERP_MS = 100;
const STATIC_TARGETS = [
  { id: 'mirror', x: LOBBY_MIRROR.x, y: 1.4, z: LOBBY_MIRROR.z + 0.4, label: '🪞 Mirror — choose robe colour [E]', range: 3 },
  { id: 'spyhole', x: SPYHOLE.x, y: SPYHOLE.y + 0.2, z: SPYHOLE.z + 0.3, label: '👁️ Spyhole — peek at the rejected captives [E]', range: 2.4 },
  { id: 'bolt', x: 3.75, y: 1.5, z: 18.4, label: '🔩 Cold Room bolt — slide to lock/unlock [E]', range: 2.4 },
  { id: 'door_out', x: 3.75, y: 1.1, z: 17.4, label: '🚪 Hold [E] to keep the Cold Room door open', range: 2.4, hold: true },
  { id: 'door_in', x: 4.3, y: 1.1, z: 17.0, label: '🚪 Hold [E] to push the door open from inside', range: 2.0, hold: true },
];

export class Game {
  constructor({ net, ui, audio, myId }) {
    this.net = net; this.ui = ui; this.audio = audio; this.myId = myId;
    this.st = null; this.snaps = []; this.body = makeBody(0, -74);
    this.yaw = 0; this.pitch = 0; this.seq = 0; this.pending = []; this.outbox = []; this.sendAcc = 0;
    this.keys = new Set(); this.locked = false; this.offset = new THREE.Vector3();
    this.players = new Map(); this.npcs = new Map(); this.tools = new Map(); this.items = new Map(); this.coins = new Map(); this.markers = new Map(); this.lard = new Map(); this.carryObjs = new Map(); this.runeSprites = new Map();
    this.target = null; this.holdingE = null; this.time = 0; this.slapT = 0; this.lastYaw = this.yaw; this.sway = new THREE.Vector2();
    this.booksPos = new Map();
    this.initThree();
    this.initInput();
  }

  // ------------------------------------------------------------------ three
  initThree() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.autoClear = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.55;
    document.getElementById('view').appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 140);
    this.camera.rotation.order = 'YXZ';
    this.world = buildWorld(this.scene);
    this.fx = new FX(this.scene);
    // viewmodel scene (rendered on top after clearing depth → never clips into walls)
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight('#ffe8c8', '#302020', 1.6));
    const dl = new THREE.DirectionalLight('#ffd8a0', 1.6); dl.position.set(1, 2, 1); this.vmScene.add(dl);
    this.vm = new THREE.Group(); this.vmScene.add(this.vm);
    const glove = mat('#4a3020');
    this.vmHands = [mesh(new THREE.SphereGeometry(0.075, 10, 8), glove, -0.27, -0.3, -0.5), mesh(new THREE.SphereGeometry(0.075, 10, 8), glove, 0.27, -0.3, -0.5)];
    this.vmHands.forEach(hh => { hh.scale.set(1, 0.85, 1.15); this.vm.add(hh); });
    this.vmHeld = new THREE.Group(); this.vm.add(this.vmHeld); this.vmHeldKey = '';
    // own body (only robe visible to you; full model visible in the lobby mirror)
    this.self = makeMinion('#d9b23a'); this.scene.add(this.self);
    const hideParts = [this.self.userData.head, ...this.self.userData.hands];
    hideParts.forEach(o => { o.visible = false; });
    const mirror = this.scene.children.find(o => o.isReflector || o.material?.uniforms?.tDiffuse);
    if (mirror) { const orig = mirror.onBeforeRender.bind(mirror); mirror.onBeforeRender = (...a) => { hideParts.forEach(o => { o.visible = true; }); orig(...a); hideParts.forEach(o => { o.visible = false; }); }; }
    window.addEventListener('resize', () => {
      r.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = this.vmCam.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix(); this.vmCam.updateProjectionMatrix();
    });
    this.initMinimap();
  }

  initMinimap() {
    const c = this.mini = document.getElementById('minimap');
    c.width = 220; c.height = 220;
    this.miniBg = document.createElement('canvas'); this.miniBg.width = this.miniBg.height = 220;
    const g = this.miniBg.getContext('2d');
    g.fillStyle = 'rgba(10,8,14,0.75)'; g.fillRect(0, 0, 220, 220);
    g.strokeStyle = '#8a8070'; g.lineWidth = 1.5;
    const T = (x, z) => [110 + x * 2.75, 98 + z * 2.75];
    for (const s of MAP_WALLS) { if (s.z1 < -60) continue; const [a, b] = T(s.x1, s.z1), [c2, d] = T(s.x2, s.z2); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); }
    this.miniT = T;
  }

  // ------------------------------------------------------------------ input
  initInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => { if (!this.ui.modalOpen && !this.ui.chatOpen && !(this.debug && this.debug.open)) canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) { this.keys.clear(); this.releaseE(); } });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      const s = 0.0022 * (+localStorage.getItem('crypt_sens') || 1);
      this.yaw -= e.movementX * s; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * s));
    });
    document.addEventListener('mousedown', e => { if (this.locked && e.button === 0) this.lmb(); });
    window.addEventListener('keydown', e => {
      if (this.ui.chatOpen) return;
      if (e.code === 'F1') { e.preventDefault(); if (this.debug) { const o = this.debug.toggle(); if (o) document.exitPointerLock(); } return; }
      if (e.code === 'Tab') { e.preventDefault(); this.ui.scoreboard(true, this.st); return; }
      if (this.ui.modalOpen) { if (e.code === 'Escape') this.ui.closeModal(); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyE': this.pressE(); break;
        case 'KeyQ': this.net.send({ t: 'drop' }); break;
        case 'KeyF': if (this.target?.kind === 'player') this.net.send({ t: 'shove', target: this.target.pid }); this.slapT = 0.3; break;
        case 'KeyX': this.net.send({ t: 'buck' }); break;
        case 'KeyG': this.useAbility(); break;
        case 'KeyV': this.audio.ensure(); this.audio.startMic().then(ok => { if (!ok) this.ui.toast('Microphone unavailable — use text chat [Enter].', 'warn'); }); this.audio.ptt = true; break;
        case 'Enter': document.exitPointerLock(); this.ui.openChat(t => this.net.send({ t: 'chat', text: t })); setTimeout(() => { this.keys.clear(); }, 0); break;
        case 'KeyM': this.mini.classList.toggle('bigmap'); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.vote(+e.code.slice(5) - 1); break;
        default: break;
      }
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.releaseE();
      if (e.code === 'KeyV') this.audio.ptt = false;
      if (e.code === 'Tab') this.ui.scoreboard(false);
    });
  }

  pressE() {
    const t = this.target;
    if (!t) return;
    if (t.id === 'mirror') { document.exitPointerLock(); this.ui.palette(this.me?.color, c => this.net.send({ t: 'color', color: c })); return; }
    if (t.kind === 'player') { this.net.send({ t: 'use', target: 'player:' + t.pid }); return; }
    this.net.send({ t: 'use', target: t.id });
    this.holdingE = t.id;
  }
  releaseE() { if (this.holdingE) { this.net.send({ t: 'release' }); this.holdingE = null; } }

  lmb() {
    this.slapT = 0.3;
    const t = this.target;
    let id = null;
    if (t?.kind === 'player') id = 'player:' + t.pid;
    else if (t?.kind === 'npc') id = t.id;
    this.net.send({ t: 'lmb', target: id });
  }

  vote(v) {
    const c = this.st?.cer;
    if (!c || c.sub !== CER.VOTE || !c.voter) return;
    this.net.send({ t: 'vote', amount: v });
  }

  useAbility() {
    const st = this.st; if (!st || !st.you.roleId) return;
    const role = ROLE_BY_ID[st.you.roleId];
    if (!st.you.ability.ok) { this.ui.toast(`${role.name}: ${st.you.ability.reason}`, 'warn'); return; }
    if (role.targets && role.targets.length) { document.exitPointerLock(); this.ui.abilityTargets(role, st, targets => this.net.send({ t: 'ability', targets })); }
    else this.net.send({ t: 'ability', targets: [] });
  }

  // ------------------------------------------------------------------ network handlers
  onState(st) {
    const prev = this.st;
    this.st = st;
    this.me = st.players.find(p => p.id === this.myId);
    if (this.me) setMinionColor(this.self, this.me.color);
    if (this.me) setGhost(this.self, !!this.me.ghost);
    this.ui.updateHud(st, this);
    this.syncEntities(st);
    updateTally(this.world.tally, st.tally);
    if (!prev || prev.phase !== st.phase) { if (st.phase === PHASE.LOBBY) this.ui.hideFinale(); }
  }

  onSnap(s) {
    const now = performance.now();
    const map = new Map(); for (const a of s.p) map.set(a[0], a);
    this.snaps.push({ t: now, map });
    while (this.snaps.length > 40) this.snaps.shift();
    for (const [uid, x, z] of s.c) this.carryTarget = this.carryTarget || new Map(), this.carryTarget.set(uid, { x, z });
    for (const [id, x, y, z] of s.bk) this.booksPos.set(id, { x, y, z });
    // reconciliation
    const mine = map.get(this.myId);
    if (!mine) return;
    const flags = mine[8];
    this.selfLocked = !!(flags & 2 || flags & 4);
    if (this.selfLocked) { this.pending = []; return; }
    const before = { x: this.body.x, y: this.body.y, z: this.body.z };
    const [x, y, z, vx, vy, vz, og, rag] = s.me;
    Object.assign(this.body, { x, y, z, vx, vy, vz, onGround: !!og, ragdoll: rag });
    this.pending = this.pending.filter(f => f.seq > s.ack);
    const ctx = this.ctx();
    for (const f of this.pending) stepBody(this.body, f, f.dt, ctx);
    this.offset.x += before.x - this.body.x; this.offset.y += before.y - this.body.y; this.offset.z += before.z - this.body.z;
    if (this.offset.length() > 2) this.offset.set(0, 0, 0);
  }

  onTeleport(m) {
    Object.assign(this.body, { x: m.x, y: 0, z: m.z, vx: 0, vy: 0, vz: 0, ragdoll: 0 });
    this.pending = []; this.offset.set(0, 0, 0);
    if (m.yaw !== undefined) this.yaw = m.yaw;
  }

  onFx(m) {
    this.fx.play(m.type, m, this.world);
    this.audio.sfx(m.type, m);
    if (m.type === 'gong' || m.type === 'milestone') this.gongT = 1.5;
    if (m.type === 'ouch') this.shake = 0.4;
    if (m.type === 'explosion') this.shake = 2;
  }

  ctx() {
    const st = this.st, you = st?.you;
    return {
      gateClosed: id => !!st?.gates?.[id],
      speedMul: you?.speedMul ?? 1, drunk: you?.fumes > 0 ? 1 : 0, time: st?.time ?? 0,
      frozen: !!you?.frozen, locked: false, noJump: !!you?.noJump,
    };
  }

  // ------------------------------------------------------------------ interpolation
  interp(id) {
    const s = this.snaps; if (!s.length) return null;
    const rt = performance.now() - INTERP_MS;
    let a = null, b = null;
    for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || s[i]; break; } }
    if (!a) { a = b = s[0]; }
    const A = a.map.get(id), B = b.map.get(id) || A;
    if (!A) return B ? { x: B[1], y: B[2], z: B[3], yaw: B[4], pitch: B[5], rag: B[6], spin: B[7], flags: B[8], speed: B[9] } : null;
    const k = b.t > a.t ? Math.min(1, (rt - a.t) / (b.t - a.t)) : 1;
    const L = (u, v) => u + (v - u) * k;
    let dy = B[4] - A[4]; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    return { x: L(A[1], B[1]), y: L(A[2], B[2]), z: L(A[3], B[3]), yaw: A[4] + dy * k, pitch: L(A[5], B[5]), rag: B[6], spin: L(A[7], B[7]), flags: B[8], speed: B[9] };
  }

  // ------------------------------------------------------------------ entity sync (10 Hz)
  syncEntities(st) {
    // players
    const ids = new Set();
    for (const p of st.players) {
      if (p.id === this.myId) continue;
      ids.add(p.id);
      let e = this.players.get(p.id);
      if (!e) { e = { mesh: makeMinion(p.color), tool: null, item: null }; this.scene.add(e.mesh); this.players.set(p.id, e); }
      e.p = p;
      setMinionColor(e.mesh, p.color); setCrystals(e.mesh, p.crystals); setGhost(e.mesh, !!p.ghost);
      this.attachHeld(e, p);
    }
    for (const [id, e] of this.players) if (!ids.has(id)) { this.scene.remove(e.mesh); this.players.delete(id); }
    if (this.me) setCrystals(this.self, this.me.crystals);
    // npcs
    const nids = new Set();
    for (const n of st.npcs) {
      nids.add(n.id);
      let e = this.npcs.get(n.id);
      if (!e) { e = { mesh: makeMinion('#6b6660', { npc: true }) }; e.mesh.position.set(n.x, 0, n.z); this.scene.add(e.mesh); this.npcs.set(n.id, e); }
      e.n = n;
    }
    for (const [id, e] of this.npcs) if (!nids.has(id)) { this.scene.remove(e.mesh); this.npcs.delete(id); }
    // tools
    const W = st.world;
    this.syncSimple(this.tools, W.tools, t => makeTool(t.type), (m, t) => { m.visible = !t.heldBy; m.position.set(t.x, t.y, t.z); m.rotation.z = Math.PI / 2.4; });
    this.syncSimple(this.items, W.items, i => makeItem(i.type), (m, i) => { m.visible = !i.heldBy; if (!i.wild) m.position.set(i.x, Math.max(0, i.y - 0.1), i.z); m.userData.wild = i.wild; });
    this.syncSimple(this.coins, W.coins, c => makeCoins(c.amount), (m, c) => m.position.set(c.x, 0, c.z));
    this.syncSimple(this.lard, W.lard, () => { const d = mesh(new THREE.CircleGeometry(1.1, 14), mat('#e8d27a', { transparent: true, opacity: 0.55, rough: 0.1, metal: 0.3 })); d.rotation.x = -Math.PI / 2; return d; }, (m, l) => m.position.set(l.x, 0.015, l.z));
    // task markers & special objects
    const live = new Set();
    const showMarkers = st.phase === PHASE.WORK;
    for (const t of st.tasks) {
      const col = t.type === 'solo' ? '#ffd75e' : t.type === 'coop3' ? '#ff7ad9' : '#4ff0ff';
      for (const pt of t.points) {
        live.add(pt.id);
        let mk = this.markers.get(pt.id);
        if (!mk) { mk = makeMarker(pt.goal ? '#66ff66' : col); this.scene.add(mk); this.markers.set(pt.id, mk); }
        mk.position.set(pt.x, (pt.y ?? 1) + 0.45, pt.z); mk.visible = showMarkers; mk.userData.pt = pt; mk.userData.task = t;
      }
      if (t.obj) {
        let o = this.carryObjs.get(t.uid);
        if (!o) { o = this.makeCarryObj(t.key); o.position.set(t.obj.x, 0, t.obj.z); this.scene.add(o); this.carryObjs.set(t.uid, o); }
        o.userData.target = t.obj;
      }
      if (t.rune !== undefined && t.wall) {
        let sp = this.runeSprites.get(t.uid);
        if (!sp || sp.userData.rune !== t.rune) { if (sp) this.scene.remove(sp); sp = this.makeRuneSprite(t.rune); sp.position.set(t.wall.x - 0.3, t.wall.y, t.wall.z); this.scene.add(sp); this.runeSprites.set(t.uid, sp); }
      }
    }
    for (const [id, mk] of this.markers) if (!live.has(id)) { this.scene.remove(mk); this.markers.delete(id); }
    const liveT = new Set(st.tasks.map(t => t.uid));
    for (const [uid, o] of this.carryObjs) if (!liveT.has(uid)) { this.scene.remove(o); this.carryObjs.delete(uid); }
    for (const [uid, o] of this.runeSprites) if (!liveT.has(uid)) { this.scene.remove(o); this.runeSprites.delete(uid); }
  }

  syncSimple(map, list, make, update) {
    const ids = new Set();
    for (const it of list) {
      ids.add(it.id);
      let m = map.get(it.id);
      if (!m) { m = make(it); this.scene.add(m); map.set(it.id, m); }
      update(m, it);
    }
    for (const [id, m] of map) if (!ids.has(id)) { this.scene.remove(m); map.delete(id); }
  }

  attachHeld(e, p) {
    const key = (p.tool || '') + '|' + (p.item || '');
    if (e.heldKey === key) return;
    e.heldKey = key;
    const sock = e.mesh.userData.toolSocket;
    sock.clear();
    if (e.itemMesh) { e.mesh.remove(e.itemMesh); e.itemMesh = null; }
    if (p.tool) { const t = makeTool(p.tool); t.scale.setScalar(0.8); t.rotation.x = -0.9; t.position.y = -0.3; sock.add(t); }
    if (p.item) { e.itemMesh = makeItem(p.item); e.itemMesh.position.set(0, 0.35, -0.42); e.mesh.add(e.itemMesh); }
  }

  makeCarryObj(key) {
    const g = new THREE.Group();
    if (key === 'censer') {
      g.add(mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#2a2a2e', { metal: 0.6 }), 0, 0.7, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12), mat('#ff5a1a', { emissive: '#ff3300', ei: 2 }), 0, 0.68, 0));
      for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.15, 0.04, 4, 8), mat('#e0b040', { metal: 0.7 }), s * 0.72, 0.7, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.2, 8), mat('#2a2a2e'), 0, 0.1, 0));
      const l = new THREE.PointLight('#ff6a1a', 4, 5); l.position.y = 1; g.add(l);
    } else {
      g.add(mesh(new THREE.BoxGeometry(1.0, 0.6, 0.7), mat('#3a3d42', { metal: 0.6 }), 0, 0.3, 0));
      for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.12, 0.035, 4, 8), mat('#e0b040', { metal: 0.7 }), s * 0.55, 0.4, 0));
      g.add(mesh(new THREE.BoxGeometry(0.9, 0.08, 0.6), mat('#ff7a2a', { emissive: '#aa3300' }), 0, 0.62, 0));
    }
    return g;
  }

  makeRuneSprite(i) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#7fe8ff'; g.shadowColor = '#7fe8ff'; g.shadowBlur = 20; g.font = 'bold 100px serif'; g.textAlign = 'center'; g.fillText(RUNES[i], 64, 100);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    sp.scale.set(1.2, 1.2, 1); sp.userData.rune = i;
    return sp;
  }

  // ------------------------------------------------------------------ targeting
  candidates() {
    const st = this.st, out = [], you = st.you;
    const working = st.phase === PHASE.WORK;
    if (st.phase === PHASE.LOBBY) out.push(STATIC_TARGETS[0]);
    if (working) {
      out.push(...STATIC_TARGETS.slice(2));
      for (const t of st.tasks) for (const pt of t.points) { if (pt.pad) continue; out.push({ id: pt.id, x: pt.x, y: pt.y, z: pt.z, label: pt.label, hold: pt.hold, range: INTERACT_RANGE + (pt.high ? 1.3 : 0.4), task: t }); }
      for (const t of st.world.tools) if (!t.heldBy) out.push({ id: 'tool:' + t.id, x: t.x, y: t.y + 0.35, z: t.z, label: `Pick up ${TOOLS[t.type].name} [E]`, range: 2.8 });
      for (const i of st.world.items) if (!i.heldBy) { const bp = i.wild ? this.booksPos.get(i.id) || i : i; out.push({ id: 'item:' + i.id, x: bp.x, y: bp.y + 0.2, z: bp.z, label: i.wild ? 'Catch the biting book! [E]' : `Pick up ${ITEM_TYPES[i.type].name} [E]`, range: i.wild ? 2.8 : 2.6 }); }
    }
    if (st.phase !== PHASE.LOBBY) out.push(STATIC_TARGETS[1]);
    for (const c of st.world.coins) out.push({ id: 'coin:' + c.id, x: c.x, y: 0.1, z: c.z, label: `Grab ${c.amount} 💰 [E]`, range: 2.4 });
    for (const [id, e] of this.npcs) { const p = e.mesh.position; out.push({ id: 'npc:' + id, kind: 'npc', npc: e.n, x: p.x, y: p.y + 0.8, z: p.z, label: '', range: 2.8 }); }
    const c = st.cer;
    const farPick = c && c.sub === CER.NOMINATE && st.masterId === you.id;
    for (const [id, e] of this.players) { const p = e.mesh.position; out.push({ id: 'player:' + id, kind: 'player', pid: id, x: p.x, y: p.y + 0.7, z: p.z, label: '', range: farPick ? 30 : 2.6, p: e.p }); }
    return out;
  }

  pickTarget() {
    if (!this.st) return null;
    const eye = this.camera.position, dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    let best = null, bestScore = Infinity;
    for (const c of this.candidates()) {
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > c.range || d < 0.05) continue;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      const ang = Math.acos(Math.min(1, cos));
      const tol = Math.max(0.09, Math.atan(0.42 / d));
      if (ang > tol) continue;
      if (wallsBetween(eye.x, eye.z, c.x, c.z, 1) > 0) continue;
      const score = ang + d * 0.01;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  promptFor(t) {
    if (!t) return '';
    const st = this.st, you = st.you, c = st.cer;
    if (t.kind === 'player') {
      const p = t.p; if (!p) return '';
      const n = `<b>${p.name}</b>`;
      if (c) {
        if (c.sub === CER.NOMINATE && st.masterId === you.id) return `${n} — <span class="k">LMB</span> nominate as Executioner${p.exhausted ? ' (💤 not eligible)' : ''}${p.muted ? ' (🤐 not eligible)' : ''}`;
        if (c.sub === CER.EVENT && st.masterId === you.id && ['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(c.mode)) return `${n} — <span class="k">LMB</span> ${c.mode === 'FLOGGING' ? 'flog' : c.mode === 'INSPECTION' ? 'inspect robe' : 'curse with muteness'}`;
        if (c.sub === CER.EVENT && c.mode === 'LIVING' && st.masterId === you.id) return `${n} — <span class="k">LMB</span> lift for the Living Sacrifice`;
        if (c.sub === CER.CURSE && ((c.mode === 'eye' && st.execId === you.id) || (c.mode === 'abyss' && st.masterId === you.id) || (c.mode === 'initiation' && you.leader))) return `${n} — <span class="k">LMB</span> strike`;
        return n;
      }
      return `${n} — <span class="k">E</span> climb on back • <span class="k">LMB/F</span> shove`;
    }
    if (t.kind === 'npc') {
      const n = t.npc;
      if (st.phase === PHASE.WORK && st.masterId === you.id && ['chamber', 'ground', 'altar'].includes(n.state)) return `Captive — <span class="k">LMB</span> lift`;
      if (c && c.sub === CER.EXECUTION && st.execId === you.id && n.state === 'altar') return `Captive — <span class="k">LMB</span> lift & carry to the portal`;
      if (st.spy.active && st.spy.id === you.id && n.state === 'chamber') return `Captive — <span class="k">E</span> peek • <span class="k">LMB</span> drop through trapdoor`;
      return '';
    }
    return t.label.replace(/\[E\]/g, '<span class="k">E</span>').replace(/hold E/g, 'hold <span class="k">E</span>');
  }

  // ------------------------------------------------------------------ frame
  frame(dt) {
    this.rawDt = dt; dt = Math.min(dt, 0.05);
    this.time += dt;
    const st = this.st;
    if (!st) { this.render(); return; }
    const you = st.you;
    const playing = st.phase !== PHASE.REVEAL && st.phase !== PHASE.FINALE;
    // ---- input frame
    const typing = this.ui.chatOpen || this.ui.modalOpen;
    const k = c => (!typing && this.keys.has(c)) ? 1 : 0;
    // low frame rates are split into ≤33 ms input sub-steps so movement speed stays frame-rate independent
    const subs = Math.min(4, Math.ceil(this.rawDt / 0.034) || 1);
    for (let i = 0; i < subs; i++) {
      const inp = {
        seq: ++this.seq, dt: this.rawDt / subs, fwd: k('KeyW') - k('KeyS'), strafe: k('KeyD') - k('KeyA'),
        yaw: this.yaw, pitch: this.pitch, jump: !!k('Space') && i === 0, sprint: !!k('ShiftLeft'),
      };
      if (!playing) { inp.fwd = inp.strafe = 0; inp.jump = false; }
      if (!this.selfLocked) { stepBody(this.body, inp, inp.dt, this.ctx()); this.pending.push(inp); if (this.pending.length > 160) this.pending.shift(); }
      this.outbox.push(inp);
    }
    if (this.selfLocked) { const me = this.interp(this.myId); if (me) Object.assign(this.body, { x: me.x, y: me.y, z: me.z, ragdoll: me.rag, spin: me.spin }); }
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 30) { this.net.send({ t: 'input', f: this.outbox.slice(-12) }); this.outbox = []; this.sendAcc = 0; }
    this.offset.multiplyScalar(Math.exp(-12 * dt));

    // ---- camera
    const b = this.body;
    const rag = b.ragdoll > 0;
    const px = b.x + this.offset.x, py = b.y + this.offset.y, pz = b.z + this.offset.z;
    this.camera.position.set(px, py + (rag ? 0.35 : EYE_H), pz);
    let roll = rag ? Math.sin(b.spin * 1.3) * 0.9 : 0;
    if (you.fumes > 0) roll += Math.sin(this.time * 1.7) * 0.12;
    this.shake = Math.max(0, (this.shake || 0) - dt);
    this.camera.rotation.set(this.pitch + (this.shake ? (Math.random() - 0.5) * this.shake * 0.1 : 0), this.yaw, roll);
    this.camera.fov = 76 + (you.fumes > 0 ? Math.sin(this.time * 2.1) * 6 : 0) + (this.keys.has('ShiftLeft') && Math.hypot(b.vx, b.vz) > 5 ? 4 : 0);
    this.camera.updateProjectionMatrix();
    // own body
    this.self.position.set(px, py, pz); this.self.rotation.y = this.yaw;
    animateMinion(this.self, dt, { speed: Math.hypot(b.vx, b.vz), ragdoll: b.ragdoll, spin: b.spin });
    this.self.visible = !rag;

    // ---- remote minions
    const lookout = you.lookout;
    for (const [id, e] of this.players) {
      const s = this.interp(id); if (!s) continue;
      e.mesh.position.set(s.x, s.y, s.z); e.mesh.rotation.y = s.yaw;
      e.mesh.visible = !(st.phase === PHASE.REVEAL);
      animateMinion(e.mesh, dt, { speed: s.speed, ragdoll: s.rag, spin: s.spin, working: !!(s.flags & 16), carried: !!(s.flags & 2), lifting: !!(e.p?.npc) || this.isCarryingPlayer(id), holdingFront: !!e.p?.item, fumes: e.p?.fumes });
      e.mesh.userData.xray.visible = !!lookout;
      e.mesh.userData.xray.material.color.set(e.p?.master ? '#ffd700' : '#ff5a5a');
    }
    // ---- captives
    for (const [, e] of this.npcs) {
      const n = e.n; let tx = n.x, ty = 0, tz = n.z;
      let carried = false;
      if (n.state === 'carried' && n.carrier) {
        const cp = n.carrier === this.myId ? { x: px, y: py, z: pz } : this.interp(n.carrier);
        if (cp) { tx = cp.x; ty = cp.y + 1.25; tz = cp.z; carried = true; }
      } else if (n.state === 'chamber' || n.state === 'prison' || n.state === 'altar') ty = n.state === 'chamber' ? 0.45 : 0;
      const kk = carried ? 1 : Math.min(1, dt * 8);
      e.mesh.position.x += (tx - e.mesh.position.x) * kk; e.mesh.position.y += (ty - e.mesh.position.y) * kk; e.mesh.position.z += (tz - e.mesh.position.z) * kk;
      e.mesh.rotation.y = n.state === 'altar' ? Math.atan2(n.x, n.z) : carried ? this.yaw : 0;
      animateMinion(e.mesh, dt, { speed: 0, carried, sitting: n.state === 'chamber' });
      e.mesh.visible = !(n.carrier === this.myId);
    }
    // carry objects / wild books
    for (const [uid, o] of this.carryObjs) { const t = this.carryTarget?.get(uid) || o.userData.target; if (t) { o.position.x += (t.x - o.position.x) * Math.min(1, dt * 10); o.position.z += (t.z - o.position.z) * Math.min(1, dt * 10); } }
    for (const [id, m] of this.items) if (m.userData.wild) { const p = this.booksPos.get(id); if (p) { m.position.set(p.x, p.y - 0.15, p.z); m.rotation.y += dt * 6; } }
    // markers bob
    for (const mk of this.markers.values()) { mk.userData.diamond.rotation.y += dt * 2; mk.userData.diamond.position.y = Math.sin(this.time * 3 + mk.position.x) * 0.06; }

    // ---- world animation
    animatePortal(this.world.portal, this.time, dt);
    for (const f of this.world.flicker) f.l.intensity = f.base * (0.85 + Math.sin(this.time * 9 + f.seed) * 0.08 + Math.sin(this.time * 23 + f.seed * 2) * 0.05);
    for (const [id, g] of Object.entries(this.world.gates)) {
      const closed = !!st.gates?.[id];
      if (id.startsWith('barrier')) g.visible = closed;
      else if (id === 'cold_door') { const open = st.world.door.open; g.rotation.y += (((open ? -Math.PI / 2 : 0) + (-Math.atan2(2, 0))) - g.rotation.y) * Math.min(1, dt * 8); }
      else g.position.y += ((closed ? 0 : 2.9) - g.position.y) * Math.min(1, dt * 5);
    }
    if (this.world.gaugeNeedle) this.world.gaugeNeedle.rotation.z = 1.2 - st.bars.red * 2.4 + Math.sin(this.time * 20) * 0.03;
    if (this.world.gong) { this.gongT = Math.max(0, (this.gongT || 0) - dt); this.world.gong.parent.rotation.z = Math.sin(this.time * 8) * 0.06 * this.gongT; }
    if (this.world.capstan) { const t = st.tasks.find(x => x.key === 'capstan'); if (t && t.progress > 0) this.world.capstan.rotation.y += dt * 1.2; }
    this.fx.update(dt);

    // ---- targeting / prompts
    this.target = playing && !you.blind ? this.pickTarget() : null;
    this.ui.setPrompt(this.promptFor(this.target));
    if (this.target?.kind === 'npc' && Math.hypot(this.target.x - b.x, this.target.z - b.z) <= NPC_INSPECT_RANGE + 0.3) this.ui.setTooltip(this.ui.npcTooltip(this.target.npc));
    else this.ui.setTooltip(null);
    this.ui.setHold(you.hold && you.hold.need > 0 ? Math.min(1, you.hold.t / you.hold.need) : you.hold ? 1 : null);
    document.getElementById('roomName').textContent = (ROOMS[roomAt(b.x, b.z)]?.icon || '') + ' ' + (ROOMS[roomAt(b.x, b.z)]?.name || 'Corridor');

    this.updateViewmodel(dt);
    this.updatePlates();
    this.drawMinimap();
    this.render();
  }

  isCarryingPlayer(id) { return this.st.players.some(q => q.carriedBy === id); }

  updateViewmodel(dt) {
    const me = this.me; if (!me) return;
    const key = (me.tool || '') + '|' + (me.item || '') + '|' + (me.load || '') + '|' + (me.npc ? 'npc' : '') + '|' + (this.st.cer?.mode === 'FLOGGING' && this.st.masterId === this.myId ? 'whip' : '');
    if (key !== this.vmHeldKey) {
      this.vmHeldKey = key; this.vmHeld.clear();
      if (me.tool) {
        const t = makeTool(me.tool);
        t.scale.setScalar(0.5); t.position.set(0.22, -0.46, -1.0); t.rotation.set(1.25, 0, 0.35);
        if (me.tool === 'wrench' || me.tool === 'hammer' || me.tool === 'oilcan') { t.scale.setScalar(0.75); t.rotation.set(-0.35, 0.3, -0.2); t.position.set(0.3, -0.5, -0.6); }
        this.vmHeld.add(t);
        if (me.load) { const l = makeItem(me.load); l.scale.setScalar(0.6); l.position.set(0.24, -0.5, -0.7); this.vmHeld.add(l); }
      } else if (me.item) {
        const it = makeItem(me.item); const big = ITEM_TYPES[me.item]?.heavy;
        it.scale.setScalar(big ? 1.1 : 0.8); it.position.set(0, big ? -0.62 : -0.38, big ? -0.62 : -0.55);
        this.vmHeld.add(it);
      } else if (key.endsWith('whip')) {
        const w = makeTool('gaff'); w.scale.setScalar(0.5); w.position.set(0.3, -0.45, -0.6); w.rotation.set(-0.6, 0, -0.3); this.vmHeld.add(w);
      }
    }
    // inertia sway: hands lag behind mouse look; bob with steps
    let dy = this.yaw - this.lastYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.lastYaw = this.yaw;
    this.sway.x += (Math.max(-0.12, Math.min(0.12, dy * 2.5)) - this.sway.x) * Math.min(1, dt * 6);
    const sp = Math.hypot(this.body.vx, this.body.vz);
    const bob = Math.sin(this.time * 13) * Math.min(1, sp / 4) * 0.025;
    this.slapT = Math.max(0, this.slapT - dt);
    const holding = !!this.st.you.hold;
    this.vm.position.set(this.sway.x * 0.6, bob - Math.max(-0.1, this.pitch * 0.02), 0);
    this.vm.rotation.z = this.sway.x * 0.5;
    const lift = me.npc || this.st.players.some(q => q.carriedBy === this.myId);
    this.vmHands[0].position.set(-0.27, lift ? 0.1 : -0.3 + (holding ? Math.sin(this.time * 12) * 0.05 : 0), lift ? -0.45 : -0.5);
    this.vmHands[1].position.set(0.27, lift ? 0.1 : -0.3 + (holding ? Math.cos(this.time * 12) * 0.05 : 0), lift ? -0.45 : -0.5 - this.slapT * 0.8);
    this.vmHeld.position.set(0, holding ? Math.sin(this.time * 12) * 0.03 : 0, -this.slapT * 0.4);
    this.vmHeld.rotation.x = holding ? Math.sin(this.time * 12) * 0.15 : 0;
    this.vm.visible = this.st.phase !== PHASE.REVEAL && !(this.body.ragdoll > 0);
  }

  updatePlates() {
    const st = this.st, you = st.you, now = performance.now();
    this.ui.labels = this.ui.labels.filter(l => l.until > now);
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    const list = [];
    for (const [id, e] of this.players) {
      const p = e.p; if (!p) continue;
      const pos = e.mesh.position;
      v.set(pos.x, pos.y + 1.55, pos.z).project(this.camera);
      const d = this.camera.position.distanceTo(pos);
      let visible = isFinite(v.x) && isFinite(v.y) && d > 0.3 && v.z < 1 && d < 32 && st.phase !== PHASE.REVEAL && !you.blind;
      if (visible && !you.god && !you.lookout && wallsBetween(this.camera.position.x, this.camera.position.z, pos.x, pos.z, 1) > 0) visible = false;
      const lab = this.ui.labels.filter(l => l.id === id).pop();
      const bub = this.ui.bubbles.get(id);
      list.push({ id, visible, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, scale: Math.max(0.55, Math.min(1, 7 / d)), html: this.ui.plateHtml(p, st, lab, bub && bub.until > now ? bub.text : null) });
    }
    this.ui.updatePlates(list);
  }

  drawMinimap() {
    if (!this.mini || !this.st) return;
    const g = this.mini.getContext('2d'), T = this.miniT;
    g.clearRect(0, 0, 220, 220); g.drawImage(this.miniBg, 0, 0);
    if (this.st.phase === PHASE.LOBBY) { g.fillStyle = '#ddd'; g.font = '12px serif'; g.fillText('Gathering Cave (lobby)', 40, 210); return; }
    for (const t of this.st.tasks) {
      const pt = t.points[0]; if (!pt) continue;
      const [x, y] = T(pt.x, pt.z);
      g.fillStyle = t.type === 'solo' ? '#ffd75e' : t.type === 'coop3' ? '#ff7ad9' : '#4ff0ff';
      g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill();
    }
    const [x, y] = T(this.body.x, this.body.z);
    g.save(); g.translate(x, y); g.rotate(-this.yaw);
    g.fillStyle = this.me?.color || '#fff'; g.strokeStyle = '#000';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.vmScene, this.vmCam);
  }
}
