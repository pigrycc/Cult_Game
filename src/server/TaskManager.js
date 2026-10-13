// ============================================================================
//  TASK MANAGER — maintenance chores, tools, carried items, hazards.
//  All validation (range, tool requirements, co-op occupancy) happens here on
//  the host. Clients only send "use <targetId>" / "release" intents.
// ============================================================================
import { TASKS, TASK_KEYS, TOOL_SPAWNS, TOOLS, ITEM_TYPES, RUNES, REAGENTS, ROOM_TAGS } from '../shared/tasks.js';
import { ECONOMY, INTERACT_RANGE, PHASE } from '../shared/constants.js';
import { STEAM_VENTS, LARD_SPOTS, roomAt } from '../shared/map.js';
import { EYE_H } from '../shared/physics.js';
import { pick, shuffle, rand, randInt, dist2 } from './util.js';

let UID = 1;
const COIN_BY_TYPE = { solo: ECONOMY.solo, coop2: ECONOMY.coop2, coop3: ECONOMY.coop3 };

export class TaskManager {
  constructor(match) {
    this.m = match;
    this.active = new Map();
    this.tools = new Map();
    this.items = new Map();
    this.coins = new Map();
    this.lard = new Map();
    this.respawnQ = [];
    this.bolted = false;
    this.steam = { t: 4, warn: null };
    this.lardT = 20;
  }

  // ---------------------------------------------------------------- setup
  initWorld() {
    this.clearAll();
    for (const s of TOOL_SPAWNS) this.tools.set(s.id, { id: s.id, type: s.type, x: s.x, y: s.y, z: s.z, home: { ...s }, heldBy: null, idle: 0 });
    for (let i = 0; i < 2; i++) this.addLard();
  }
  clearAll() {
    for (const p of this.m.list) { p.heldTool = null; p.heldItem = null; p.load = null; p.carryHandle = null; p.hold = null; }
    this.active.clear(); this.items.clear(); this.coins.clear(); this.lard.clear(); this.respawnQ = [];
    this.bolted = false;
  }
  get poolSize() { return this.m.dbg.maxConcurrent ?? this.m.balance.pool; }

  fillPool() {
    let guard = 0;
    while (this.active.size < this.poolSize && guard++ < 50) if (!this.spawnTask()) break;
  }

  spawnTask(forceKey = null) {
    const activeKeys = new Set([...this.active.values()].map(t => t.key));
    let key = forceKey;
    if (!key) {
      const coopActive = [...this.active.values()].filter(t => t.def.type !== 'solo').length;
      const wantCoop = coopActive < Math.max(2, Math.round(this.poolSize * 0.3));
      let cands = TASK_KEYS.filter(k => !activeKeys.has(k) && (k !== 'mop' || this.lard.size > 0));
      const typed = cands.filter(k => (TASKS[k].type !== 'solo') === wantCoop);
      if (typed.length) cands = typed;
      if (!cands.length) return false;
      key = pick(cands);
    } else if (activeKeys.has(key)) {
      const old = [...this.active.values()].find(t => t.key === key); this.removeTask(old);
    }
    const def = TASKS[key];
    if (key === 'mop' && !this.lard.size) this.addLard();
    const inst = { uid: UID++, key, def, rep: 0, progress: 0, participants: new Set(), data: {}, born: this.m.time };
    switch (def.mech) {
      case 'fetch':
        if (def.srcs) inst.data.items = def.srcs.map(s => this.makeItem(def.item, s.x, s.y ?? 0.1, s.z, inst.uid).id);
        break;
      case 'books': this.spawnBook(inst); break;
      case 'carry': inst.data.obj = { x: def.obj.x, z: def.obj.z }; inst.data.holders = [null, null]; break;
      case 'carcass': inst.data.item = this.makeItem('carcass', def.src.x, def.src.y, def.src.z, inst.uid).id; inst.data.helpers = new Set(); break;
      case 'calib': inst.data.recipe = this.newRecipe(); inst.data.readers = new Set(); break;
      case 'runes': inst.data.rune = randInt(0, RUNES.length - 1); break;
      case 'bell': inst.data.seq = []; inst.data.rounds = 0; break;
      case 'bellows': inst.data.count = 0; inst.data.lastPad = -1; inst.data.lastT = 0; inst.data.players = new Set(); break;
      case 'hold': if (def.lard) inst.data.lardId = [...this.lard.keys()][0]; break;
      default: break;
    }
    this.active.set(inst.uid, inst);
    return inst;
  }

  removeTask(inst) {
    if (!inst) return;
    for (const p of this.m.list) {
      if (p.hold?.uid === inst.uid) this.m.releaseHold(p);
      if (p.carryHandle?.uid === inst.uid) p.carryHandle = null;
      if (p.load?.uid === inst.uid) p.load = null;
    }
    for (const it of [...this.items.values()]) if (it.taskUid === inst.uid) this.deleteItem(it);
    this.active.delete(inst.uid);
  }

  complete(inst, participants) {
    if (!this.active.has(inst.uid)) return;
    const coins = COIN_BY_TYPE[inst.def.type];
    const names = [];
    for (const p of participants) { if (!p) continue; p.gold += coins; names.push(p.name); this.m.send(p.id, { t: 'coins', amount: coins }); }
    const pos = this.mainPoint(inst);
    this.m.fx('taskdone', { x: pos.x, y: pos.y, z: pos.z, name: inst.def.name });
    this.m.log(`${inst.def.name} done by ${names.join(', ')}`);
    if (inst.def.lard && inst.data.lardId) this.lard.delete(inst.data.lardId);
    this.removeTask(inst);
    this.respawnQ.push(this.m.timers.taskRespawnDelay);
    this.m.bars.addTaskProgress(1);
  }
  forceComplete(inst, participants = []) { this.complete(inst, participants); }

  // ---------------------------------------------------------------- items & tools
  makeItem(type, x, y, z, taskUid = null) {
    const it = { id: 'i' + (UID++), type, x, y, z, heldBy: null, taskUid, step: 0, dropper: null };
    this.items.set(it.id, it); return it;
  }
  deleteItem(it) {
    if (it.heldBy) { const p = this.m.P(it.heldBy); if (p && p.heldItem === it.id) p.heldItem = null; }
    this.items.delete(it.id);
  }
  itemHeavy(itemId) { const it = this.items.get(itemId); return it ? ITEM_TYPES[it.type]?.heavy || 0 : 0; }

  dropItem(p) {
    const it = this.items.get(p.heldItem);
    p.heldItem = null;
    if (!it) return;
    it.heldBy = null;
    const f = { x: -Math.sin(p.body.yaw), z: -Math.cos(p.body.yaw) };
    it.x = p.body.x + f.x * 0.6; it.z = p.body.z + f.z * 0.6; it.y = 0.1;
  }
  dropTool(p) {
    const t = this.tools.get(p.heldTool); p.heldTool = null; p.load = null;
    if (!t) return;
    t.heldBy = null; t.x = p.body.x - Math.sin(p.body.yaw) * 0.6; t.z = p.body.z - Math.cos(p.body.yaw) * 0.6; t.y = 0; t.idle = 0;
  }
  returnTool(p) {
    const t = this.tools.get(p.heldTool); p.heldTool = null; p.load = null;
    if (t) Object.assign(t, { heldBy: null, x: t.home.x, y: t.home.y, z: t.home.z, idle: 0 });
  }
  dropAny(p) {
    if (p.heldItem) this.dropItem(p);
    else if (p.heldTool) this.dropTool(p);
    else if (p.carryHandle) this.releaseHandle(p);
  }
  spawnCoins(x, z, amount) { const id = 'c' + (UID++); this.coins.set(id, { id, x: x + rand(-0.4, 0.4), z: z + rand(-0.4, 0.4), amount }); }

  addLard() {
    const used = new Set([...this.lard.values()].map(l => l.i));
    const free = LARD_SPOTS.map((s, i) => i).filter(i => !used.has(i));
    if (!free.length) return;
    const i = pick(free); const s = LARD_SPOTS[i];
    const id = 'l' + (UID++); this.lard.set(id, { id, i, x: s.x, z: s.z });
  }

  spawnBook(inst) {
    const a = inst.def.area;
    const it = this.makeItem('book', rand(a.x0, a.x1), 0.2, rand(a.z0, a.z1), inst.uid);
    it.wild = true; it.vx = 0; it.vz = 0; it.hopT = 0;
    inst.data.book = it.id;
  }

  newRecipe() { return REAGENTS.map((_, i) => (i === 2 ? randInt(0, 2) : randInt(1, 3))); }

  coldDoorOpen() {
    if (this.bolted) return false;
    return this.m.list.some(p => p.hold && (p.hold.target === 'door_out' || p.hold.target === 'door_in'));
  }

  // ---------------------------------------------------------------- interaction points
  mainPoint(inst) {
    const pts = this.points(inst);
    return pts[0] || { x: 0, y: 1, z: 0 };
  }

  /** Public interactable points of a task (used for HUD markers and crosshair targeting). */
  points(inst) {
    const d = inst.def, out = [];
    const pt = (part, pos, label, hold = false, extra = {}) => out.push({ id: `task:${inst.uid}:${part}`, x: pos.x, y: pos.y ?? 1, z: pos.z, label, hold, ...extra });
    switch (d.mech) {
      case 'hold': {
        let s = d.spots[inst.rep % Math.max(1, d.spots.length)];
        if (d.lard) { const l = this.lard.get(inst.data.lardId); if (l) s = { x: l.x, y: 0.05, z: l.z }; }
        if (s) pt('spot', s, `${d.name}${d.tool ? ' — needs ' + TOOLS[d.tool].name : ''} (hold E)`, true, { tool: d.tool });
        break;
      }
      case 'stack': pt('spot', d.spots[0], `${d.name} — ride a friend's back (E on them) + ${TOOLS[d.tool].name}, hold E`, true, { tool: d.tool, high: true }); break;
      case 'fetch': case 'books':
        if (d.src) pt('src', d.src, d.tool ? `Scoop ${ITEM_TYPES[d.item].name} (needs ${TOOLS[d.tool].name})` : `Take ${ITEM_TYPES[d.item].name}`, false, { tool: d.tool });
        d.steps.forEach((s, i) => pt('s' + i, s, `${i === d.steps.length - 1 ? 'Deliver' : 'Process'} ${ITEM_TYPES[d.item].name}${s.time ? ' (hold E)' : ''}`, s.time > 0, { step: i }));
        break;
      case 'coop': d.handles.forEach((h, i) => pt('h' + i, h, `${d.name} — handle ${i + 1}/${d.handles.length} (hold E together)`, true)); break;
      case 'bell': d.handles.forEach((h, i) => pt('r' + i, h, `Bell rope ${i + 1} — pull in order 1-2-3 (3 minions)`, false)); break;
      case 'bellows': d.handles.forEach((h, i) => pt('p' + i, h, `Bellows pad ${i + 1} — jump on it, alternate with partner`, false, { pad: true })); break;
      case 'carry': {
        const o = inst.data.obj;
        [-1, 1].forEach((sgn, i) => pt('h' + i, { x: o.x + sgn * d.handleOff, y: 0.8, z: o.z }, `${d.name} — grab handle ${i + 1} (E)`, false));
        pt('goal', d.target, `Destination: ${d.name}`, false, { goal: true });
        break;
      }
      case 'relay': pt('pile', d.pile, 'Drop a sandbag over the threshold (hold E)', true); pt('goal', d.target, 'Acid puddle — dump the sandbag (E)', false); break;
      case 'carcass': pt('goal', d.target, 'Butcher table — deliver the carcass (E)', false); break;
      case 'calib': pt('scale', d.scale, 'Balance Scale — weigh the reagents (E)', false); pt('scroll', d.scroll, 'Recipe Scroll — read & dictate over the intercom (E)', false); break;
      case 'runes': pt('spot', d.spots[0], 'Runic Dictionary — find the glowing wall rune (E)', false); break;
      default: break;
    }
    return out;
  }

  // ---------------------------------------------------------------- range helper
  inRange(p, pos, extra = 0.7) {
    const e = this.m.eyeOf(p);
    const dy = (pos.y ?? 1) - e.y;
    const horiz = Math.hypot(pos.x - e.x, pos.z - e.z);
    return Math.hypot(horiz, Math.max(0, Math.abs(dy) - 0.6)) <= INTERACT_RANGE + extra;
  }

  resolvePoint(target) {
    const [, uidS, part] = target.split(':');
    const inst = this.active.get(+uidS);
    if (!inst) return null;
    const pt = this.points(inst).find(q => q.id === target);
    return pt ? { inst, part, pt } : null;
  }

  // ---------------------------------------------------------------- USE (E press)
  use(p, target) {
    if (this.m.phase !== PHASE.WORK && !(this.m.phase === PHASE.CEREMONY && target.startsWith('coin:'))) return;
    if (p.frozen || p.body.ragdoll > 0 || p.carriedBy) return;
    if (target.startsWith('tool:')) return this.pickTool(p, target.slice(5));
    if (target.startsWith('item:')) return this.pickItem(p, target.slice(5));
    if (target.startsWith('coin:')) { const c = this.coins.get(target.slice(5)); if (c && dist2(p.body, c) < 2.5) { p.gold += c.amount; this.coins.delete(c.id); this.m.send(p.id, { t: 'coins', amount: c.amount }); } return; }
    if (target === 'door_out' || target === 'door_in') {
      const pos = target === 'door_out' ? { x: 3.5, y: 1.1, z: 17.4 } : { x: 4.5, y: 1.1, z: 17.4 };
      if (!this.inRange(p, pos)) return;
      if (this.bolted) return this.m.toast(p.id, target === 'door_in' ? '🔒 Bolted from the outside! Shout for help...' : 'The steel bolt is shut. Slide it first (E on the bolt).', 'warn');
      p.hold = { target, uid: null, need: Infinity, pos };
      return;
    }
    if (target === 'bolt') {
      if (!this.inRange(p, { x: 3.6, y: 1.5, z: 18.6 }) || p.body.x > 4) return;
      this.bolted = !this.bolted;
      for (const q of this.m.list) if (q.hold && q.hold.target.startsWith('door')) this.m.releaseHold(q);
      this.m.fx('clank', { x: 3.6, z: 18.6 });
      return this.m.toast(p.id, this.bolted ? 'You slid the bolt — the Cold Room is LOCKED.' : 'Bolt released.');
    }
    if (!target.startsWith('task:')) return;
    const r = this.resolvePoint(target);
    if (!r) return;
    const { inst, part, pt } = r;
    if (!this.inRange(p, pt, pt.high ? 1.2 : 0.7)) return this.m.toast(p.id, 'Too far away.');
    const d = inst.def;
    const needTool = t => { if (p.heldTool && this.tools.get(p.heldTool)?.type === t) return true; this.m.toast(p.id, `You need the ${TOOLS[t].name}.`, 'warn'); return false; };

    switch (d.mech) {
      case 'hold':
        if (d.tool && !needTool(d.tool)) return;
        p.hold = { target, uid: inst.uid, need: d.time, pos: pt, onDone: () => this.repDone(inst, p) };
        break;
      case 'stack':
        if (!p.ridingOn) return this.m.toast(p.id, 'Too high! Climb on another minion\'s back first (E on a minion).', 'warn');
        if (!needTool(d.tool)) return;
        p.hold = { target, uid: inst.uid, need: d.time, pos: pt, high: true, onDone: () => this.complete(inst, [p, this.m.P(p.ridingOn)]) };
        break;
      case 'fetch': case 'books': this.useFetch(p, inst, part, pt, needTool); break;
      case 'coop': p.hold = { target, uid: inst.uid, need: Infinity, pos: pt, handle: +part.slice(1) }; break;
      case 'bell': this.pullBell(p, inst, +part.slice(1)); break;
      case 'carry': this.grabHandle(p, inst, +part.slice(1)); break;
      case 'relay':
        if (part === 'pile') {
          if ([...this.items.values()].some(i => i.taskUid === inst.uid)) return this.m.toast(p.id, 'A sandbag is already waiting to be carried.');
          p.hold = { target, uid: inst.uid, need: d.time, pos: pt, onDone: () => { const it = this.makeItem('sandbag', d.drop.x, 0.2, d.drop.z, inst.uid); it.dropper = p.id; inst.participants.add(p.id); this.m.toast(p.id, 'Sandbag dropped — your partner must haul it to the acid!'); } };
        } else if (part === 'goal') {
          const it = this.items.get(p.heldItem);
          if (!it || it.taskUid !== inst.uid) return this.m.toast(p.id, 'Bring a sandbag here.');
          if (it.dropper === p.id) return this.m.toast(p.id, 'Relay! The bag must be hauled by a different minion than the dropper.', 'warn');
          inst.participants.add(p.id); this.deleteItem(it); p.heldItem = null; inst.rep++;
          inst.progress = inst.rep / d.reps;
          this.m.fx('thud', { x: pt.x, z: pt.z });
          if (inst.rep >= d.reps) this.complete(inst, [...inst.participants].map(id => this.m.P(id)));
        }
        break;
      case 'carcass': {
        const it = this.items.get(p.heldItem);
        if (!it || it.taskUid !== inst.uid) return this.m.toast(p.id, 'Bring the frozen carcass from the Cold Room.');
        const helpers = [...inst.data.helpers].filter(id => id !== p.id);
        this.deleteItem(it); p.heldItem = null;
        this.complete(inst, [p, ...helpers.map(id => this.m.P(id))]);
        break;
      }
      case 'calib':
        if (part === 'scroll') { inst.data.readers.add(p.id); this.m.send(p.id, { t: 'recipe', uid: inst.uid, recipe: inst.data.recipe, names: REAGENTS }); }
        else this.m.send(p.id, { t: 'calibUI', uid: inst.uid, names: REAGENTS });
        break;
      case 'runes': {
        const opts = shuffle([inst.data.rune, ...shuffle(RUNES.map((_, i) => i).filter(i => i !== inst.data.rune)).slice(0, 5)]);
        this.m.send(p.id, { t: 'runesUI', uid: inst.uid, options: opts });
        break;
      }
      default: break;
    }
  }

  useFetch(p, inst, part, pt, needTool) {
    const d = inst.def;
    if (part === 'src') {
      if (d.tool) {
        if (!needTool(d.tool)) return;
        if (p.load) return this.m.toast(p.id, 'Your shovel is already loaded.');
        p.load = { type: d.item, uid: inst.uid, step: 0 };
        this.m.fx('scoop', { x: pt.x, z: pt.z });
      } else {
        if (p.heldItem) return this.m.toast(p.id, 'Your hands are full (Q to drop).');
        if (p.heldTool) this.dropTool(p);
        const it = this.makeItem(d.item, pt.x, pt.y, pt.z, inst.uid);
        it.heldBy = p.id; p.heldItem = it.id;
      }
      return;
    }
    const si = +part.slice(1);
    const step = d.steps[si];
    let carrier = null;
    if (d.tool) { if (p.load && p.load.uid === inst.uid && p.load.step === si) carrier = p.load; }
    else { const it = this.items.get(p.heldItem); if (it && it.taskUid === inst.uid && it.step === si) carrier = it; }
    if (!carrier) return this.m.toast(p.id, si === 0 ? `Bring the ${ITEM_TYPES[d.item].name} here.` : 'Process it at the previous station first.');
    const finish = () => {
      carrier.step++;
      inst.participants.add(p.id);
      if (carrier.step >= d.steps.length) {
        if (d.tool) p.load = null; else { const it = this.items.get(p.heldItem); if (it) this.deleteItem(it); p.heldItem = null; }
        this.repDone(inst, p);
        if (d.mech === 'books' && inst.rep < d.reps && this.active.has(inst.uid)) this.spawnBook(inst);
      } else this.m.fx('taskstep', { x: pt.x, y: pt.y, z: pt.z });
    };
    if (step.time > 0) p.hold = { target: pt.id, uid: inst.uid, need: step.time, pos: pt, onDone: finish };
    else finish();
  }

  repDone(inst, p) {
    inst.rep++;
    inst.participants.add(p.id);
    inst.progress = inst.rep / (inst.def.reps || 1);
    const pos = this.mainPoint(inst);
    this.m.fx('taskstep', { x: pos.x, y: pos.y, z: pos.z });
    if (inst.rep >= (inst.def.reps || 1)) this.complete(inst, [...inst.participants].map(id => this.m.P(id)));
  }

  pickTool(p, id) {
    const t = this.tools.get(id);
    if (!t || t.heldBy) return;
    if (!this.inRange(p, { x: t.x, y: t.y + 0.5, z: t.z }, 0.8)) return;
    if (p.heldItem) this.dropItem(p);
    if (p.heldTool) this.dropTool(p);
    t.heldBy = p.id; p.heldTool = id; t.idle = 0;
    this.m.toast(p.id, `Picked up: ${TOOLS[t.type].name}  [Q] drop`);
  }

  pickItem(p, id) {
    const it = this.items.get(id);
    if (!it || it.heldBy) return;
    if (!this.inRange(p, it, it.wild ? 1.2 : 0.8)) return;
    if (p.heldItem) return this.m.toast(p.id, 'Your hands are full (Q to drop).');
    if (p.rider || p.ridingOn) return this.m.toast(p.id, 'Not while stacked.');
    if (p.heldTool) this.dropTool(p);
    it.heldBy = p.id; it.wild = false; p.heldItem = id;
    if (it.type === 'book') this.m.toast(p.id, 'Got the biting book! Strap it at the table, then shelve it.');
    if (it.type === 'carcass') this.m.toast(p.id, 'Heavy! Haul it to the butcher table — someone must hold the Cold Room door.');
  }

  pullBell(p, inst, rope) {
    const D = inst.data, now = this.m.time;
    const last = D.seq[D.seq.length - 1];
    const stale = last && now - last.t >= 1.8;
    if (stale) D.seq = [];
    const ok = rope === D.seq.length && !D.seq.some(s => s.pid === p.id);
    this.m.fx('bell', { x: inst.def.handles[rope].x, z: inst.def.handles[rope].z, tone: rope, ok });
    if (!ok) {
      // Bad timing → shockwave knocks everyone nearby down
      D.seq = [];
      this.m.fx('shockwave', { x: -5.6, z: -7.2 });
      for (const q of this.m.list) if (dist2(q.body, { x: -5.6, z: -7.2 }) < 7) this.m.ragdoll(q, 1.8, 7, q.body.x + 5.6, q.body.z + 7.2);
      this.m.toast(p.id, 'DONG! Wrong rhythm — the blast floors everyone.', 'warn');
      return;
    }
    D.seq.push({ pid: p.id, t: now });
    inst.participants.add(p.id);
    if (D.seq.length === 3) {
      D.rounds++; D.seq = [];
      inst.progress = D.rounds / inst.def.rounds;
      if (D.rounds >= inst.def.rounds) this.complete(inst, [...inst.participants].map(id => this.m.P(id)));
    }
  }

  grabHandle(p, inst, h) {
    const D = inst.data;
    if (p.carryHandle && p.carryHandle.uid === inst.uid) return this.releaseHandle(p);
    if (D.holders[h]) return this.m.toast(p.id, 'Someone holds that handle.');
    if (p.heldItem) this.dropItem(p);
    if (p.carryHandle) this.releaseHandle(p);
    D.holders[h] = p.id; p.carryHandle = { uid: inst.uid, h };
    inst.participants.add(p.id);
    if (!D.holders[1 - h]) this.m.toast(p.id, 'Too heavy alone! A partner must grab the other handle.');
  }
  releaseHandle(p) {
    const ch = p.carryHandle; p.carryHandle = null;
    if (!ch) return;
    const inst = this.active.get(ch.uid);
    if (inst) inst.data.holders[ch.h] = null;
  }

  onLanding(p) {
    if (this.m.phase !== PHASE.WORK) return;
    for (const inst of this.active.values()) {
      if (inst.def.mech !== 'bellows') continue;
      const D = inst.data;
      inst.def.handles.forEach((pad, i) => {
        if (dist2(p.body, pad) > 1.1) return;
        if (i !== D.lastPad && (D.lastPid !== p.id || D.count === 0)) {
          D.count++; D.lastPad = i; D.lastPid = p.id; D.lastT = this.m.time; D.players.add(p.id);
          inst.participants.add(p.id);
          this.m.fx('puff', { x: pad.x, z: pad.z });
          inst.progress = Math.min(1, D.count / inst.def.count);
          if (D.count >= inst.def.count && D.players.size >= 2) this.complete(inst, [...D.players].map(id => this.m.P(id)));
        }
      });
    }
  }

  // ---------------------------------------------------------------- calib / runes answers
  answerCalib(p, uid, amounts) {
    const inst = this.active.get(uid);
    if (!inst || inst.def.mech !== 'calib' || !this.inRange(p, inst.def.scale, 1)) return;
    const ok = Array.isArray(amounts) && inst.data.recipe.every((v, i) => (amounts[i] | 0) === v);
    const readers = [...inst.data.readers].filter(id => id !== p.id);
    if (ok && readers.length) { this.complete(inst, [p, this.m.P(readers[readers.length - 1])]); return; }
    if (ok) return this.m.toast(p.id, 'Correct... but a guess doesn\'t count! A partner must read the scroll in the Library.', 'warn');
    inst.data.recipe = this.newRecipe(); inst.data.readers.clear();
    this.m.fx('fizzle', { x: inst.def.scale.x, z: inst.def.scale.z });
    this.m.toast(p.id, 'Wrong ratio! The mixture fizzles — the recipe changed, read it again.', 'warn');
  }
  answerRunes(p, uid, choice) {
    const inst = this.active.get(uid);
    if (!inst || inst.def.mech !== 'runes' || !this.inRange(p, inst.def.spots[0], 1)) return;
    if (choice === inst.data.rune) {
      inst.data.rune = randInt(0, RUNES.length - 1);
      this.repDone(inst, p);
    } else {
      this.m.toast(p.id, 'Wrong rune! The dictionary snaps shut on your fingers.', 'warn');
      this.m.ragdoll(p, 0.8, 2);
    }
  }

  // ---------------------------------------------------------------- tick
  tick(dt) {
    // respawns
    for (let i = this.respawnQ.length - 1; i >= 0; i--) {
      this.respawnQ[i] -= dt;
      if (this.respawnQ[i] <= 0) { this.respawnQ.splice(i, 1); if (this.active.size < this.poolSize) this.spawnTask(); }
    }
    if (this.active.size < this.poolSize && !this.respawnQ.length) this.respawnQ.push(this.m.timers.taskRespawnDelay);

    // holds
    for (const p of this.m.list) {
      const h = p.hold;
      if (!h) continue;
      if (p.body.ragdoll > 0 || p.frozen || (h.uid && !this.active.has(h.uid)) || !this.inRange(p, h.pos, h.high ? 1.4 : 1.0)) { this.m.releaseHold(p); continue; }
      if (h.need === Infinity) continue;
      p.holdT += dt;
      if (p.holdT >= h.need) { const fn = h.onDone; this.m.releaseHold(p); fn && fn(); }
    }

    for (const inst of [...this.active.values()]) {
      const d = inst.def, D = inst.data;
      if (d.mech === 'coop') {
        const holders = d.handles.map((_, i) => this.m.list.find(p => p.hold && p.hold.uid === inst.uid && p.hold.handle === i));
        const ids = new Set(holders.filter(Boolean).map(p => p.id));
        if (ids.size === d.handles.length) {
          inst.progress = Math.min(1, inst.progress + dt / d.time);
          holders.forEach(p => inst.participants.add(p.id));
          if (inst.progress >= 1) this.complete(inst, holders);
        } else inst.progress = Math.max(0, inst.progress - dt * 0.05);
      } else if (d.mech === 'carry') {
        const [a, b] = D.holders.map(id => id && this.m.P(id));
        const o = D.obj;
        for (const [i, h] of [[0, a], [1, b]]) {
          if (!h) continue;
          const hp = { x: o.x + (i ? 1 : -1) * d.handleOff, z: o.z };
          if (dist2(h.body, hp) > (a && b ? 2.4 : 1.6) || h.body.ragdoll > 0) { this.releaseHandle(h); }
        }
        if (D.holders[0] && D.holders[1]) {
          const mx = (a.body.x + b.body.x) / 2, mz = (a.body.z + b.body.z) / 2;
          const k = Math.min(1, dt * 6);
          o.x += (mx - o.x) * k; o.z += (mz - o.z) * k;
        }
        inst.progress = Math.max(0, 1 - dist2(o, d.target) / Math.max(1, dist2(d.obj, d.target)));
        if (dist2(o, d.target) < d.radius) this.complete(inst, [...inst.participants].map(id => this.m.P(id)));
      } else if (d.mech === 'bellows') {
        if (D.count > 0 && this.m.time - D.lastT > 3) { D.count = 0; D.lastPad = -1; inst.progress = 0; }
      } else if (d.mech === 'carcass') {
        for (const p of this.m.list) if (p.hold && p.hold.target.startsWith('door')) D.helpers.add(p.id);
        const it = this.items.get(D.item);
        inst.progress = it && it.heldBy ? 0.5 : 0;
      } else if (d.mech === 'books') {
        const it = this.items.get(D.book);
        if (it && it.wild) {
          it.hopT -= dt;
          if (it.hopT <= 0) { it.hopT = rand(0.6, 1.4); const a = Math.random() * Math.PI * 2; it.vx = Math.cos(a) * 2.2; it.vz = Math.sin(a) * 2.2; it.vy = 3.5; }
          it.x += it.vx * dt; it.z += it.vz * dt; it.vy = (it.vy ?? 0) - 18 * dt; it.y = Math.max(0.2, it.y + it.vy * dt);
          const A = d.area; it.x = Math.max(A.x0, Math.min(A.x1, it.x)); it.z = Math.max(A.z0, Math.min(A.z1, it.z));
          for (const p of this.m.list) if (dist2(p.body, it) < 0.7 && Math.random() < dt * 2) { this.m.ragdoll(p, 0.6, 2.5, p.body.x - it.x, p.body.z - it.z); this.m.toast(p.id, 'The grimoire BIT you!'); }
        }
      }
    }
    this.tickHazards(dt);
  }

  tickHazards(dt) {
    // Steam geysers in the Boiler Room
    const S = this.steam;
    S.t -= dt;
    if (S.warn) {
      S.warn.t -= dt;
      if (S.warn.t <= 0) {
        const v = S.warn.v;
        this.m.fx('steam', { x: v.x, z: v.z });
        for (const p of this.m.list) {
          const d = dist2(p.body, v);
          if (d < 1.6 && p.body.y < 2.5) this.m.ragdoll(p, 1.4, 6, p.body.x - v.x + 0.01, p.body.z - v.z);
        }
        S.warn = null;
      }
    } else if (S.t <= 0) {
      S.t = rand(4, 8);
      const v = pick(STEAM_VENTS);
      S.warn = { v, t: 1.1 };
      this.m.fx('steam_warn', { x: v.x, z: v.z });
    }
    // Lard slips (only when running)
    for (const p of this.m.list) {
      p.slipCd = Math.max(0, (p.slipCd || 0) - dt);
      if (p.slipCd > 0 || !p.body.onGround || p.body.ragdoll > 0) continue;
      const sp = Math.hypot(p.body.vx, p.body.vz);
      if (sp < 5) continue;
      for (const l of this.lard.values()) {
        if (dist2(p.body, l) < 1.2) { p.slipCd = 3; this.m.ragdoll(p, 1.5, sp * 1.1, p.body.vx, p.body.vz); this.m.toast(p.id, 'Whoops! Slipped on lard. (Walk, don\'t run.)'); break; }
      }
    }
    this.lardT -= dt;
    if (this.lardT <= 0) { this.lardT = 25; if (this.lard.size < 2) this.addLard(); }
  }
  tickHazardsOnly() { /* ceremony: hazards paused (Red Bar frozen) */ }

  tickItems(dt) {
    for (const p of this.m.list) for (const c of [...this.coins.values()]) {
      if (dist2(p.body, c) < 0.9 && p.body.ragdoll <= 0) { p.gold += c.amount; this.coins.delete(c.id); this.m.send(p.id, { t: 'coins', amount: c.amount }); }
    }
    for (const t of this.tools.values()) {
      if (t.heldBy) { const p = this.m.P(t.heldBy); if (!p || p.heldTool !== t.id) t.heldBy = null; continue; }
      if (dist2(t, t.home) > 0.5) { t.idle += dt; if (t.idle > 45) Object.assign(t, { x: t.home.x, y: t.home.y, z: t.home.z, idle: 0 }); }
    }
    for (const it of this.items.values()) {
      if (!it.heldBy) continue;
      const p = this.m.P(it.heldBy);
      if (!p || p.heldItem !== it.id) { it.heldBy = null; continue; }
      it.x = p.body.x; it.z = p.body.z; it.y = p.body.y + 0.6;
    }
  }

  // ---------------------------------------------------------------- serialization
  serializeTasks() {
    return [...this.active.values()].map(inst => ({
      uid: inst.uid, key: inst.key, name: inst.def.name, room: inst.def.room, tag: ROOM_TAGS[inst.def.room], type: inst.def.type,
      coins: COIN_BY_TYPE[inst.def.type], progress: +inst.progress.toFixed(3), rep: inst.rep, reps: inst.def.reps || 1,
      points: this.points(inst).map(q => ({ ...q, x: +q.x.toFixed(2), y: +(q.y ?? 1).toFixed(2), z: +q.z.toFixed(2) })),
      rune: inst.def.mech === 'runes' ? inst.data.rune : undefined, wall: inst.def.wall,
      obj: inst.data.obj ? { x: +inst.data.obj.x.toFixed(2), z: +inst.data.obj.z.toFixed(2) } : undefined,
      holders: inst.data.holders, count: inst.data.count, seq: inst.data.seq ? inst.data.seq.length : undefined,
    }));
  }
  serializeWorld() {
    return {
      tools: [...this.tools.values()].map(t => ({ id: t.id, type: t.type, x: +t.x.toFixed(2), y: t.y, z: +t.z.toFixed(2), heldBy: t.heldBy })),
      items: [...this.items.values()].map(i => ({ id: i.id, type: i.type, x: +i.x.toFixed(2), y: +i.y.toFixed(2), z: +i.z.toFixed(2), heldBy: i.heldBy, wild: !!i.wild, step: i.step })),
      coins: [...this.coins.values()],
      lard: [...this.lard.values()],
      door: { open: this.coldDoorOpen(), bolted: this.bolted },
    };
  }
}
