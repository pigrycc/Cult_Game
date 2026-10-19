// ============================================================================
//  CLIENT GAME — FPP controller with client-side prediction + server
//  reconciliation, 100 ms interpolation of remote minions, crosshair
//  targeting, FPP viewmodel (chunky tools with inertia), entity rendering.
// ============================================================================
import * as THREE from 'three';
import { makeBody, stepBody, EYE_H, wallsBetween } from '../shared/physics.js';
import { PHASE, CER, ROLE_BY_ID, INTERACT_RANGE, NPC_INSPECT_RANGE } from '../shared/constants.js';
import { LOBBY_MIRROR, SPYHOLE, roomAt, ROOMS, walls as MAP_WALLS } from '../shared/map.js';
import { TOOLS, ITEM_TYPES, RUNES, TASK_PALETTE } from '../shared/tasks.js';
import { LINE_SPOTS, LEVER_SPOTS } from '../shared/map.js';
import { buildWorld, updateTally } from './world.js';
import { makeMinion, animateMinion, setCrystals, setMinionColor, setGhost, makeTool, makeItem, makeCoins, makeMarker, makeToolMarker, animatePortal, mat, mesh } from './models.js';
import { FX } from './fx.js';
import { Countdown, countdownSources } from './countdown.js';

// ceremony sub-states with a visible decision timer (ANNOUNCE / COUNT / RESULT are pauses, not windows)
const TIMED_SUBS = new Set([CER.NOMINATE, CER.VOTE, CER.REACTION, CER.EXECUTION, CER.CURSE, CER.EVENT, CER.DEBATE]);

const INTERP_MS = 100;
const STATIC_TARGETS = [
  { id: 'mirror', x: LOBBY_MIRROR.x, y: 1.4, z: LOBBY_MIRROR.z + 0.4, label: '🪞 Mirror — choose robe colour [E]', range: 3 },
  { id: 'spyhole', x: SPYHOLE.x, y: SPYHOLE.y + 0.2, z: SPYHOLE.z + 0.3, label: '👁️ Spyhole — peek at the rejected captives [E]', range: 2.4 },
  { id: 'bolt', x: 3.75, y: 1.5, z: 18.4, label: '🔩 Cold Room bolt — slide to lock/unlock [E]', range: 2.4 },
  { id: 'door_out', x: 3.75, y: 1.1, z: 17.4, label: '🚪 Hold [E] to keep the Cold Room door open', range: 2.4, hold: true, need: 0, verb: 'Holding the door open' },
  { id: 'door_in', x: 4.3, y: 1.1, z: 17.0, label: '🚪 Hold [E] to push the door open from inside', range: 2.0, hold: true, need: 0, verb: 'Pushing the door open' },
];

export class Game {
  constructor({ net, ui, audio, myId }) {
    this.net = net; this.ui = ui; this.audio = audio; this.myId = myId;
    this.st = null; this.snaps = []; this.body = makeBody(0, -74);
    this.yaw = 0; this.pitch = 0; this.seq = 0; this.pending = []; this.outbox = []; this.sendAcc = 0;
    this.keys = new Set(); this.locked = false; this.offset = new THREE.Vector3();
    this.players = new Map(); this.npcs = new Map(); this.tools = new Map(); this.items = new Map(); this.coins = new Map(); this.markers = new Map(); this.tmarkers = new Map(); this.lard = new Map(); this.carryObjs = new Map(); this.runeSprites = new Map();
    this.target = null; this.holdingE = null; this.time = 0; this.slapT = 0; this.lastYaw = this.yaw; this.sway = new THREE.Vector2();
    this.booksPos = new Map();
    this.cdWindow = new Countdown(n => this.audio.countdown(n));    // mutiny vote, debate, nomination, execution, …
    this.cdCollapse = new Countdown(n => this.audio.countdown(n));  // work phase: Red Bar → next milestone
    // own timer (not the render loop): cues must land on the second even when frames are slow or throttled
    this.cdTimer = setInterval(() => { const n = performance.now(); this.cdWindow.update(n); this.cdCollapse.update(n); }, 40);
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
    // Own body is never drawn in the FPP view (it would cover the lower screen when looking down);
    // it is only shown inside the lobby mirror's reflection pass.
    this.self.visible = false;
    const mirror = this.scene.children.find(o => o.isReflector || o.material?.uniforms?.tDiffuse);
    if (mirror) { const orig = mirror.onBeforeRender.bind(mirror); mirror.onBeforeRender = (...a) => { this.self.visible = !this.selfRagdoll; orig(...a); this.self.visible = false; }; }
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
    document.addEventListener('mousedown', e => { if (e.button !== 0) return; if (this.ui.roleDropOpen) { this.ui.dismissRoleDrop(); return; } if (this.locked) this.lmb(); });
    window.addEventListener('keydown', e => {
      if (this.ui.chatOpen) return;
      if (e.code === 'F1' || e.code === 'Backquote') { e.preventDefault(); if (this.debug) { const o = this.debug.toggle(); if (o) document.exitPointerLock(); } return; }
      if (e.code === 'Tab') { e.preventDefault(); this.ui.scoreboard(true, this.st); return; }
      if (this.ui.modalOpen) { if (e.code === 'Escape') this.ui.closeModal(); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyE': this.pressE(); break;
        case 'KeyQ': {
          const st = this.st, me = this.me;
          const canDiscard = st?.simple && st.you.roleId && !st.you.cardUsed && !(me?.tool || me?.item || me?.npc);
          if (canDiscard) this.discardStart = performance.now();
          else this.net.send({ t: 'drop' });
          break;
        }
        case 'KeyF': if (this.target?.kind === 'player') this.net.send({ t: 'shove', target: this.target.pid }); this.slapT = 0.3; break;
        case 'KeyX': this.net.send({ t: 'buck' }); break;
        case 'KeyG': this.useAbility(); break;
        case 'KeyV': this.audio.ensure(); this.startVoice();
          if (this.audio.mode === 'ptt') this.audio.ptt = true;
          else { this.audio.muted = !this.audio.muted; this.ui.toast(this.audio.muted ? '🔇 Microphone muted (V to unmute)' : '🎤 Microphone open — just talk', 'info'); }
          break;
        case 'KeyN': this.audio.mode = this.audio.mode === 'open' ? 'ptt' : 'open'; this.audio.ptt = false; this.audio.muted = false; this.audio.gate.reset();
          try { localStorage.setItem('crypt_voice_mode', this.audio.mode); } catch { /* storage unavailable */ }
          this.ui.toast(this.audio.mode === 'open' ? '🎤 Open microphone (voice activation). V = mute / unmute.' : '🎙 Push-to-talk: hold V to speak.', 'info'); break;
        case 'Enter': document.exitPointerLock(); this.ui.openChat(t => this.net.send({ t: 'chat', text: t })); setTimeout(() => { this.keys.clear(); }, 0); break;
        case 'KeyM': this.mini.classList.toggle('bigmap'); break;
        case 'KeyH': this.callForHelp(); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.vote(+e.code.slice(5) - 1); break;
        default: break;
      }
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.releaseE();
      if (e.code === 'KeyQ' && this.discardStart) { this.discardStart = null; this.ui.holdFeedback('cancel', '✖ Discard cancelled — keep holding Q for 3 s'); }
      if (e.code === 'KeyV' && this.audio.mode === 'ptt') this.audio.ptt = false;
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
    // Predict the hold meter immediately (server confirms / corrects via state + holdEnd)
    if (t.hold) this.localHold = { target: t.id, need: t.need || 0, start: performance.now(), label: t.verb || 'Working', coop: !!t.coop, door: t.id.startsWith('door'), confirmed: false };
  }
  releaseE() {
    if (!this.holdingE) return;
    this.net.send({ t: 'release' });
    this.holdingE = null;
    const h = this.localHold;
    if (h) {
      this.localHold = null;
      const el = (performance.now() - h.start) / 1000;
      if (h.need > 0 && el < h.need - 0.05) this.holdCancelled(h.confirmed ? '✖ Cancelled — progress lost' : '✖ Cancelled');
      else if (h.need === 0 && h.confirmed) this.ui.holdFeedback('cancel', h.door ? 'Door released' : '✖ Let go');
      this.lastLocalCancel = performance.now();
    }
  }
  holdCancelled(label) { this.ui.holdFeedback('cancel', label); this.audio.sfx('cancel'); }
  /** Server-side end of a hold: 'done' (completed) or 'cancel' (interrupted: knocked down, out of range, task gone…). */
  onHoldEnd(m) {
    const h = this.localHold;
    if (m.reason === 'done') { this.ui.holdFeedback('done', `✔ ${h?.label || 'Done'}!`); this.audio.sfx('holddone'); this.localHold = null; return; }
    if (performance.now() - (this.lastLocalCancel || 0) < 600) return;          // already shown locally
    if (h) { this.localHold = null; this.holdCancelled('✖ Interrupted!'); }
  }

  /** Hold meter state for this frame (prediction + server reconciliation). */
  holdView() {
    const now = performance.now(), you = this.st.you, sh = you.hold;
    let h = this.localHold;
    if (!h && sh) h = this.localHold = { target: sh.target, need: sh.need, start: now - sh.t * 1000, label: 'Working', confirmed: true };
    if (!h) return null;
    if (sh && sh.target === h.target) {
      h.confirmed = true;
      if (sh.need > 0) {
        h.need = sh.need;
        const serverT = sh.t + (now - (this.stateAt || now)) / 1000;
        const el = (now - h.start) / 1000;
        if (Math.abs(el - serverT) > 0.25) h.start = now - serverT * 1000;
      }
    } else if (!sh && now - h.start > 600 && !h.done) { this.localHold = null; return null; }     // server refused (toast explains)
    if (h.need > 0) {
      const el = (now - h.start) / 1000;
      return { frac: Math.min(1, el / h.need), left: h.need - el, label: h.label };
    }
    let coopFrac = null, label = h.label;
    const uid = h.target.startsWith('task:') ? +h.target.split(':')[1] : null;
    const task = uid != null ? this.st.tasks.find(t => t.uid === uid) : null;
    if (task) { coopFrac = task.progress; label = task.progress > 0.001 && task.progress < 0.999 && this.lastCoop !== undefined && task.progress > this.lastCoop ? `${task.name} — working together` : `${task.name} — waiting for partner(s)`; this.lastCoop = task.progress; }
    return { continuous: true, coopFrac, label };
  }

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

  /** Broadcast your co-op task to the whole crew so a partner comes to help. */
  callForHelp() {
    const st = this.st; if (!st || st.phase !== PHASE.WORK) return;
    const mine = (st.tasks || []).find(t => t.kind === 'coop' && t.mine);
    if (!mine) { this.ui.toast('You have no co-op task to call help for.', 'warn'); return; }
    this.net.send({ t: 'callhelp', uid: mine.uid });
    this.ui.toast('🆘 You called for help on your co-op task.', 'info');
  }

  useAbility() {
    const st = this.st; if (!st || !st.you.roleId) return;
    const role = ROLE_BY_ID[st.you.roleId];
    if (!st.you.ability.ok) { this.ui.toast(`${role.name}: ${st.you.ability.reason}`, 'warn'); return; }
    if (role.id === 113) {                                         // Mirror Mage: choose a used card, then its targets
      const ids = (st.usedRoles || []).filter(id => id !== 113 && ROLE_BY_ID[id]?.simple);
      document.exitPointerLock();
      this.ui.mirrorPick(ids, copy => {
        const cr = ROLE_BY_ID[copy];
        if (cr.targets?.length) this.ui.abilityTargets(cr, st, targets => this.net.send({ t: 'ability', targets, copy }));
        else this.net.send({ t: 'ability', targets: [], copy });
      });
      return;
    }
    if (role.targets && role.targets.length) { document.exitPointerLock(); this.ui.abilityTargets(role, st, targets => this.net.send({ t: 'ability', targets })); }
    else this.net.send({ t: 'ability', targets: [] });
  }

  // ------------------------------------------------------------------ network handlers
  onState(st) {
    const prev = this.st;
    this.st = st;
    this.stateAt = performance.now();
    this.me = st.players.find(p => p.id === this.myId);
    if (this.me) setMinionColor(this.self, this.me.color);
    if (this.me) setGhost(this.self, !!this.me.ghost);
    this.ui.updateHud(st, this);
    this.audio.silenced = !!(st.you.muted || st.you.gagged);                       // curse of silence / Gagging Seal: nothing is transmitted
    this.ui.updateMic(this.audio, st);
    this.syncEntities(st);
    updateTally(this.world.tally, st.tally);
    if (!prev || prev.phase !== st.phase) { if (st.phase === PHASE.LOBBY) { this.ui.hideFinale(); this.purgeClientFx(); } }
    // countdown audio (final 5 s)
    const src = countdownSources(st, TIMED_SUBS), now = performance.now(), rate = st.ts || 1;
    this.cdWindow.sample(src.window?.key, src.window?.t, now, rate, st.time);
    this.cdCollapse.sample(src.collapse?.key, src.collapse?.t, now, rate, st.time);
  }

  /** Back in the lobby: wipe every client-side overlay / effect left over from the match. */
  purgeClientFx() {
    document.body.classList.remove('drunk');
    for (const id of ['blind', 'ghostTint']) { const e = document.getElementById(id); if (e) e.style.opacity = 0; }
    this.shake = 0; this.selfLocked = false; this.pending = []; this.outbox = []; this.offset.set(0, 0, 0);
    this.body.ragdoll = 0; this.body.spin = 0; this.body.vx = this.body.vy = this.body.vz = 0;
    this.camera.rotation.z = 0; this.camera.fov = 76; this.camera.updateProjectionMatrix();
    this.keys.clear(); this.releaseE(); this.localHold = null; this.target = null;
    this.ui.setHold(null); this.ui.purge();
    this.audio.ptt = false;
    this.cdWindow.reset(); this.cdCollapse.reset();
    for (const P of this.pillars || []) this.scene.remove(P.g);
    this.pillars = [];
    setGhost(this.self, false);
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
    if (m.type === 'appoint') this.spawnPillar(m.id, m.office);
  }

  /** Vertical pillar of light on a freshly appointed Master / Executioner (follows the minion). */
  spawnPillar(id, office) {
    const col = office === 'master' ? '#ffd75e' : '#ff6a4a';
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 16, 20, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 16, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    outer.position.y = inner.position.y = 8;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.4, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const light = new THREE.PointLight(col, 25, 9, 1.4); light.position.y = 2;
    g.add(outer, inner, ring, light);
    if (id === this.myId) g.visible = false;   // your own ray is seen by everyone else; you get the banner + fanfare
    this.scene.add(g);
    (this.pillars ||= []).push({ id, g, outer, inner, ring, light, t: 0, life: 4.5 });
      }
  updatePillars(dt) {
    if (!this.pillars) return;
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const P = this.pillars[i]; P.t += dt;
      const pos = P.id === this.myId ? this.body : this.players.get(P.id)?.mesh.position;
      if (pos) P.g.position.set(pos.x, 0, pos.z);
      const k = P.t < 0.4 ? P.t / 0.4 : Math.max(0, 1 - (P.t - P.life + 1.2) / 1.2);
      P.outer.material.opacity = 0.32 * k; P.inner.material.opacity = 0.55 * k * (0.8 + Math.sin(P.t * 12) * 0.2);
      P.ring.material.opacity = 0.8 * k; P.ring.scale.setScalar(1 + Math.sin(P.t * 4) * 0.12); P.light.intensity = P.id === this.myId ? 0 : 25 * k;
      P.outer.rotation.y += dt;
      if (P.t >= P.life) { this.scene.remove(P.g); this.pillars.splice(i, 1); }
    }
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
      if (!e) {
        e = { mesh: makeMinion('#6b6660', { npc: true }) }; e.mesh.position.set(n.x, 0, n.z); this.scene.add(e.mesh); this.npcs.set(n.id, e);
        // selection highlight (shown only to the Master while the captive waits in the Selection Chamber)
        e.glow = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffd75e', transparent: true, opacity: 0.3, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        e.glow.scale.set(1, 1.35, 1); e.glow.position.y = 0.62; e.glow.visible = false; e.mesh.add(e.glow);
      }
      e.n = n;
    }
    for (const [id, e] of this.npcs) if (!nids.has(id)) { this.scene.remove(e.mesh); this.npcs.delete(id); }
    this.syncLevers(st);
    // tools
    const W = st.world;
    this.syncSimple(this.tools, W.tools, t => makeTool(t.type), (m, t) => { m.visible = !t.heldBy; m.position.set(t.x, t.y, t.z); m.rotation.z = Math.PI / 2.4; });
    this.syncSimple(this.items, W.items, i => makeItem(i.type), (m, i) => { m.visible = !i.heldBy; if (!i.wild) m.position.set(i.x, Math.max(0, i.y - 0.1), i.z); m.userData.wild = i.wild; });
    this.syncSimple(this.coins, W.coins, c => makeCoins(c.amount), (m, c) => m.position.set(c.x, 0, c.z));
    this.syncSimple(this.lard, W.lard, () => { const d = mesh(new THREE.CircleGeometry(1.1, 14), mat('#e8d27a', { transparent: true, opacity: 0.55, rough: 0.1, metal: 0.3 })); d.rotation.x = -Math.PI / 2; return d; }, (m, l) => m.position.set(l.x, 0.015, l.z));
    // task markers & special objects
    const live = new Set();
    const showMarkers = st.phase === PHASE.WORK;
    const toolCols = new Map();                                        // tool type -> colours of the active tasks that need it
    const itemCols = new Map();                                        // task uid -> colour
    for (const t of st.tasks) {
      const col = TASK_PALETTE[t.color] || '#ffd75e';                  // ONE colour per task instance: every marker of the chain shares it
      itemCols.set(t.uid, col);
      if (t.tool) { const a = toolCols.get(t.tool) || []; a.push(col); toolCols.set(t.tool, a); }
      for (const pt of t.points) {
        live.add(pt.id);
        let mk = this.markers.get(pt.id);
        if (!mk) { mk = makeMarker(col); this.scene.add(mk); this.markers.set(pt.id, mk); }
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
    // floating beacons above every free tool a task needs, and above task items (e.g. the biting book), in the task's colour
    const liveTm = new Set();
    const beacon = (key, col, x, y, z) => {
      liveTm.add(key);
      let mk = this.tmarkers.get(key);
      if (mk && mk.userData.col !== col) { this.scene.remove(mk); mk = null; }
      if (!mk) { mk = makeToolMarker(col); mk.userData.col = col; this.scene.add(mk); this.tmarkers.set(key, mk); }
      mk.position.set(x, y, z); mk.visible = showMarkers;
    };
    for (const tl of W.tools) {
      const cols = toolCols.get(tl.type);
      if (!cols || tl.heldBy) continue;
      cols.forEach((c, i) => beacon(`t:${tl.id}:${i}`, c, tl.x + (i - (cols.length - 1) / 2) * 0.4, (tl.y || 0) + 1.7, tl.z));
    }
    for (const it of W.items) {
      const c = it.task != null ? itemCols.get(it.task) : null;
      if (!c || it.heldBy) continue;
      const mm = this.items.get(it.id);
      beacon(`i:${it.id}`, c, mm ? mm.position.x : it.x, (mm ? mm.position.y : it.y) + 1.0, mm ? mm.position.z : it.z);
    }
    for (const [k, mk] of this.tmarkers) if (!liveTm.has(k)) { this.scene.remove(mk); this.tmarkers.delete(k); }
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

  /** Simplified Mode: 3 trapdoors + levers in front of the portal (built once, shown during the ceremony). */
  syncLevers(st) {
    const show = !!(st.cer && st.cer.levers);
    if (!this.leverRig && !show) return;
    if (!this.leverRig) {
      const g = new THREE.Group(), rigs = [];
      LINE_SPOTS.forEach((s, i) => {
        const frame = mesh(new THREE.BoxGeometry(1.25, 0.06, 1.25), mat('#3a2c22')); frame.position.set(s.x, 0.03, s.z); g.add(frame);
        const hole = mesh(new THREE.BoxGeometry(1.05, 0.02, 1.05), mat('#050205', { basic: true })); hole.position.set(s.x, 0.05, s.z); g.add(hole);
        const hinge = new THREE.Group(); hinge.position.set(s.x - 0.52, 0.07, s.z); g.add(hinge);
        const door = mesh(new THREE.BoxGeometry(1.04, 0.05, 1.04), mat('#6b4a2e')); door.position.x = 0.52; hinge.add(door);
        for (const dz of [-0.3, 0.3]) { const strap = mesh(new THREE.BoxGeometry(1.0, 0.055, 0.08), mat('#8d9399', { metal: 0.6 })); strap.position.set(0.52, 0.005, dz); hinge.add(strap); }
        const L = LEVER_SPOTS[i];
        const base = mesh(new THREE.BoxGeometry(0.32, 0.5, 0.32), mat('#4b4f57', { metal: 0.5 })); base.position.set(L.x, 0.25, L.z); g.add(base);
        const pivot = new THREE.Group(); pivot.position.set(L.x, 0.5, L.z); g.add(pivot);
        const arm = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6), mat('#9aa3ad', { metal: 0.6 })); arm.position.y = 0.4; pivot.add(arm);
        const knob = mesh(new THREE.SphereGeometry(0.09, 8, 6), mat('#c0392b', { emissive: '#ff3b2b', ei: 0.7 })); knob.position.y = 0.82; pivot.add(knob);
        pivot.rotation.x = -0.55;
        rigs.push({ hinge, pivot, open: 0 });
      });
      this.scene.add(g); this.leverRig = { g, rigs };
    }
    this.leverRig.g.visible = show;
    this.leverRig.state = show ? st.cer.levers : [false, false, false];
  }
  animateLevers(dt) {
    const R = this.leverRig; if (!R || !R.g.visible) return;
    R.rigs.forEach((r, i) => {
      const on = !!R.state[i];
      r.open += ((on ? 1 : 0) - r.open) * Math.min(1, dt * 6);
      r.hinge.rotation.z = -r.open * 1.45;                  // trapdoor swings down
      r.pivot.rotation.x = -0.55 + r.open * 1.1;             // lever thrown
    });
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
      for (const t of st.tasks) for (const pt of t.points) { if (pt.pad) continue; out.push({ id: pt.id, x: pt.x, y: pt.y, z: pt.z, label: pt.label, hold: pt.hold, need: pt.need, verb: pt.verb, coop: pt.coop, range: INTERACT_RANGE + (pt.high ? 1.3 : 0.4), task: t }); }
      for (const t of st.world.tools) if (!t.heldBy) out.push({ id: 'tool:' + t.id, x: t.x, y: t.y + 0.35, z: t.z, label: `Pick up ${TOOLS[t.type].name} [E]`, range: 2.8 });
      for (const i of st.world.items) if (!i.heldBy) { const bp = i.wild ? this.booksPos.get(i.id) || i : i; out.push({ id: 'item:' + i.id, x: bp.x, y: bp.y + 0.2, z: bp.z, label: i.wild ? 'Catch the biting book! [E]' : `Pick up ${ITEM_TYPES[i.type].name} [E]`, range: i.wild ? 2.8 : 2.6 }); }
    }
    if (st.phase !== PHASE.LOBBY) out.push(STATIC_TARGETS[1]);
    if (working) for (const c of st.world.coins) out.push({ id: 'coin:' + c.id, x: c.x, y: 0.1, z: c.z, label: `Pick up ${c.amount} 💰 (hold E)`, range: 2.6, hold: true, need: this.st.dbg?.timers?.coinPickup ?? 0.6, verb: `Picking up ${c.amount} 💰` });
    for (const [id, e] of this.npcs) { const p = e.mesh.position; out.push({ id: 'npc:' + id, kind: 'npc', npc: e.n, x: p.x, y: p.y + 0.8, z: p.z, label: '', range: 2.8 }); }
    const c = st.cer;
    if (c && c.sub === CER.ELIMINATE && st.masterId === you.id) {
      for (const n of st.npcs) if (n.state === 'line' && n.spot != null) { const L = LEVER_SPOTS[n.spot]; out.push({ id: 'lever:' + n.id, x: L.x, y: 1.05, z: L.z, label: 'Pull the lever — drop this captive into the abyss [E]', range: 2.9 }); }
    }
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
      if (c && c.sub === CER.ELIMINATE && st.masterId === you.id && n.state === 'line') return `Captive — pull the lever next to it (<span class="k">E</span>) to drop it`;
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
        yaw: this.yaw, pitch: this.pitch, jump: !!k('Space') && i === 0, sprint: !!k('ShiftLeft') && !you.noSprint,
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
    const fumes = st.phase === PHASE.LOBBY ? 0 : you.fumes;
    let roll = rag ? Math.sin(b.spin * 1.3) * 0.9 : 0;
    if (fumes > 0) roll += Math.sin(this.time * 1.7) * 0.12;
    this.shake = Math.max(0, (this.shake || 0) - dt);
    this.camera.rotation.set(this.pitch + (this.shake ? (Math.random() - 0.5) * this.shake * 0.1 : 0), this.yaw, roll);
    this.camera.fov = 76 + (fumes > 0 ? Math.sin(this.time * 2.1) * 6 : 0) + (this.keys.has('ShiftLeft') && Math.hypot(b.vx, b.vz) > 5 ? 4 : 0);
    this.camera.updateProjectionMatrix();
    // own body
    this.self.position.set(px, py, pz); this.self.rotation.y = this.yaw;
    animateMinion(this.self, dt, { speed: Math.hypot(b.vx, b.vz), ragdoll: b.ragdoll, spin: b.spin });
    this.selfRagdoll = rag;

    // ---- remote minions
    for (const [id, e] of this.players) {
      const s = this.interp(id); if (!s) continue;
      e.mesh.position.set(s.x, s.y, s.z); e.mesh.rotation.y = s.yaw;
      e.mesh.visible = !(st.phase === PHASE.REVEAL);
      animateMinion(e.mesh, dt, { speed: s.speed, ragdoll: s.rag, spin: s.spin, working: !!(s.flags & 16), carried: !!(s.flags & 2), lifting: !!(e.p?.npc) || this.isCarryingPlayer(id), holdingFront: !!e.p?.item, fumes: e.p?.fumes });
    }
    // ---- captives
    for (const [, e] of this.npcs) {
      const n = e.n; let tx = n.x, ty = 0, tz = n.z;
      let carried = false;
      if (n.state === 'carried' && n.carrier) {
        const cp = n.carrier === this.myId ? { x: px, y: py, z: pz } : this.interp(n.carrier);
        if (cp) { tx = cp.x; ty = cp.y + 1.25; tz = cp.z; carried = true; }
      } else if (n.state === 'chamber' || n.state === 'prison' || n.state === 'altar' || n.state === 'line') ty = n.state === 'chamber' ? 0.45 : 0;
      else if (n.state === 'abyss') { e.fall = (e.fall || 0) + dt; ty = -9.8 * e.fall * e.fall; }
      const kk = carried || n.state === 'abyss' ? 1 : Math.min(1, dt * 8);
      e.mesh.position.x += (tx - e.mesh.position.x) * kk; e.mesh.position.y += (ty - e.mesh.position.y) * kk; e.mesh.position.z += (tz - e.mesh.position.z) * kk;
      e.mesh.rotation.y = n.state === 'altar' || n.state === 'line' ? Math.atan2(n.x, n.z) : carried ? this.yaw : 0;
      animateMinion(e.mesh, dt, { speed: 0, carried, sitting: n.state === 'chamber' });
      e.mesh.visible = !(n.carrier === this.myId);
      const glow = st.phase === PHASE.WORK && st.masterId === this.myId && n.state === 'chamber' && !(st.spy.active && st.spy.id !== this.myId);
      e.glow.visible = glow;
      if (glow) e.glow.material.opacity = 0.22 + Math.sin(this.time * 4 + n.id) * 0.12;
    }
    this.animateLevers(dt);
    // carry objects / wild books
    for (const [uid, o] of this.carryObjs) { const t = this.carryTarget?.get(uid) || o.userData.target; if (t) { o.position.x += (t.x - o.position.x) * Math.min(1, dt * 10); o.position.z += (t.z - o.position.z) * Math.min(1, dt * 10); } }
    for (const [id, m] of this.items) if (m.userData.wild) { const p = this.booksPos.get(id); if (p) { m.position.set(p.x, p.y - 0.15, p.z); m.rotation.y += dt * 6; } }
    // markers bob
    for (const mk of this.markers.values()) { mk.userData.diamond.rotation.y += dt * 2; mk.userData.diamond.position.y = Math.sin(this.time * 3 + mk.position.x) * 0.06; }
    for (const mk of this.tmarkers.values()) { mk.userData.diamond.rotation.y += dt * 3; mk.userData.diamond.position.y = 0.3 + Math.sin(this.time * 4 + mk.position.x) * 0.08; }

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
    this.updatePillars(this.rawDt);

    // ---- targeting / prompts
    this.target = playing && !you.blind ? this.pickTarget() : null;
    this.ui.setPrompt(this.promptFor(this.target));
    if (this.target?.kind === 'npc' && Math.hypot(this.target.x - b.x, this.target.z - b.z) <= NPC_INSPECT_RANGE + 0.3) this.ui.setTooltip(this.ui.npcTooltip(this.target.npc, !!this.st.simple));
    else this.ui.setTooltip(null);
    if (this.discardStart) {
      const f = (performance.now() - this.discardStart) / 3000;
      const fill = document.getElementById('rcDFill'); if (fill) fill.style.width = Math.min(100, f * 100) + '%';
      if (!st.you.roleId || st.you.cardUsed) this.discardStart = null;
      else if (f >= 1) { this.discardStart = null; this.net.send({ t: 'discard' }); this.ui.holdFeedback('done', '🗑 Role card discarded'); this.audio.sfx('cancel'); }
      else this.ui.setHold({ frac: f, left: 3 * (1 - f), label: '🗑 Discarding your role card' });
    } else this.ui.setHold(this.holdView());
    if (this.localHold && this.localHold.need > 0) { this.holdTick = (this.holdTick || 0) + dt; if (this.holdTick > 0.32) { this.holdTick = 0; this.audio.sfx('holdtick'); } }
    document.getElementById('roomName').textContent = (ROOMS[roomAt(b.x, b.z)]?.icon || '') + ' ' + (ROOMS[roomAt(b.x, b.z)]?.name || 'Corridor');

    this.updateViewmodel(dt);
    this.updatePlates();
    this.drawMinimap();
    this.render();
  }

  /** Open the microphone (needs a user gesture / permission once). Called automatically when the match scene starts. */
  startVoice() {
    if (this.voiceAsked) return; this.voiceAsked = true;
    this.audio.ensure();
    this.audio.startMic().then(ok => {
      this.ui.toast(ok ? '🎤 Open microphone — just talk (V mute • N push-to-talk)' : 'Microphone unavailable — use text chat [Enter].', ok ? 'info' : 'warn');
    });
  }

  isCarryingPlayer(id) { return this.st.players.some(q => q.carriedBy === id); }

  updateViewmodel(dt) {
    const me = this.me; if (!me) return;
    const key = (me.tool || '') + '|' + (me.item || '') + '|' + (me.load || '') + '|' + (me.npc ? 'npc' : '') + '|' + (this.st.cer?.mode === 'FLOGGING' && this.st.masterId === this.myId ? 'whip' : '');
    if (key !== this.vmHeldKey) {
      this.vmHeldKey = key; this.vmHeld.clear();
      if (me.tool) {
        const t = makeTool(me.tool);
        // Long tools (head at the origin, handle up +Y): hold the HANDLE near the hands and push the HEAD out in front of the
        // camera so the whole business end is on screen. Short tools (grip at the origin) are simply raised and tilted forward.
        const LONG = { broom: 1.25, mop: 1.2, brush: 1.2, gaff: 1.3, shovel: 1.1 };
        if (LONG[me.tool]) {
          const yA = new THREE.Vector3(0.38, -0.5, 0.78).normalize();                  // head -> handle: toward the player, down
          const ref = new THREE.Vector3(0, 0.6, 0.8).normalize();                      // flat faces (shovel blade) face up + toward the camera
          const zA = ref.clone().sub(yA.clone().multiplyScalar(ref.dot(yA))).normalize();
          const xA = new THREE.Vector3().crossVectors(yA, zA);
          t.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
          t.scale.setScalar(0.95); t.position.set(-0.02, -0.12, -1.15);
        } else if (me.tool === 'oilcan') { t.scale.setScalar(1.7); t.rotation.set(0.15, 0.5, 0); t.position.set(0.3, -0.55, -0.85); }
        else { t.scale.setScalar(1.1); t.rotation.set(-0.55, 0.3, -0.15); t.position.set(0.3, -0.78, -0.85); }
        if (me.load) {                                                                   // loaded state is part of the tool: coal sits ON the blade
          const l = makeItem(me.load);
          if (me.tool === 'shovel') {
            l.scale.setScalar(0.95); l.position.set(0, -0.14, 0.07);
            const l2 = makeItem(me.load); l2.scale.setScalar(0.6); l2.position.set(0.08, -0.24, 0.06); t.add(l2);
            const l3 = makeItem(me.load); l3.scale.setScalar(0.55); l3.position.set(-0.08, -0.05, 0.06); t.add(l3);
          } else { l.scale.setScalar(1.2); l.position.set(0, 0.2, 0.12); }
          t.add(l);
        }
        this.vmHeld.add(t);
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
      if (visible && !you.god && wallsBetween(this.camera.position.x, this.camera.position.z, pos.x, pos.z, 1) > 0) visible = false;
      const lab = this.ui.labels.filter(l => l.id === id).pop();
      const bub = this.ui.bubbles.get(id);
      // LOD: detailed card only when < 3 m AND looking directly at the minion
      const toP = new THREE.Vector3(pos.x - this.camera.position.x, pos.y + 0.7 - this.camera.position.y, pos.z - this.camera.position.z).normalize();
      const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
      const looking = this.target?.pid === id || fwd.dot(toP) > 0.975;
      const detail = d < 3 && looking && !you.blind;
      list.push({ id, visible, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, scale: detail ? 1 : Math.max(0.55, Math.min(1, 7 / d)), html: this.ui.plateHtml(p, st, lab, bub && bub.until > now ? bub.text : null, detail) });
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
    // a co-op partner's "come help" ping pulses on the minimap for a few seconds
    if (this.coopPingAt && performance.now() - this.coopPingAt < 6000) {
      const [px, py] = T(this.coopPing.x, this.coopPing.z);
      const pulse = 4 + Math.abs(Math.sin(performance.now() / 180)) * 6;
      g.strokeStyle = '#7dff9a'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, pulse, 0, 7); g.stroke();
      g.fillStyle = '#7dff9a'; g.font = '12px serif'; g.fillText('🤝', px - 6, py - 8);
    }
    const [x, y] = T(this.body.x, this.body.z);
    g.save(); g.translate(x, y); g.rotate(-this.yaw);
    g.fillStyle = this.me?.color || '#fff'; g.strokeStyle = '#000';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
  }

  /** A paired co-op partner pinged us from a station — pulse it on the minimap for a few seconds. */
  pingCoop(x, z) { this.coopPing = { x, z }; this.coopPingAt = performance.now(); }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.vmScene, this.vmCam);
  }
}
