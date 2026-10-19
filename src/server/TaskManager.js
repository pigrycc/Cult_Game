// ============================================================================
//  TASK MANAGER — maintenance chores, tools, carried items, hazards.
//  All validation (range, tool requirements, co-op occupancy) happens here on
//  the host. Clients only send "use <targetId>" / "release" intents.
// ============================================================================
import { TASKS, TASK_KEYS, TOOL_SPAWNS, TOOLS, ITEM_TYPES, RUNES, REAGENTS, ROOM_TAGS, BOT_MECHS, TASK_COLORS } from '../shared/tasks.js';
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
  /** Number of Humanlike bots that will be doing chores (0 when bots are not in that mode). */
  botCrew() { return this.m.dbg.botMode === 'human' ? this.m.list.filter(p => p.isBot && !p.ghost).length : 0; }

  /** Can a Humanlike bot crew of this size really perform this chore? (co-op needs two bots) */
  botDoable(def, crew = this.botCrew()) { return BOT_MECHS.has(def.mech) && (def.mech !== 'coop' || crew >= 2); }

  /**
   * Self-heal: the board is full, bots are the crew, and NOTHING on it is something they can do (for example the
   * "max tasks" limit was lowered mid-match and a chore they refuse is left in the only slot). Retire the oldest chore
   * nobody has touched so a doable one can spawn. A task a player is working on is never removed.
   */
  unjam(dt) {
    this.unjamT = (this.unjamT ?? 0) - dt;
    if (this.unjamT > 0) return;
    this.unjamT = 1.5;
    const crew = this.botCrew();
    if (!crew || this.poolSize < 1 || this.active.size === 0 || this.active.size < this.poolSize) return;
    const all = [...this.active.values()];
    if (all.some(t => this.botDoable(t.def, crew))) return;
    // Nothing on a full board is bot-doable. Retire the oldest UNTOUCHED refused chore so a doable one can spawn.
    // When the WHOLE board is refused chores (e.g. a 1-task cap) act fast (3 s) — otherwise be patient (15 s) in case a
    // human is on the way to it.
    const grace = all.every(t => !this.botDoable(t.def, crew)) ? 3 : 15;
    const idle = all.filter(t => t.progress === 0 && t.rep === 0 && t.participants.size === 0 && this.m.time - t.born > grace
      && !this.m.list.some(p => p.hold?.uid === t.uid || p.carryHandle?.uid === t.uid) && !(t.data.holders && t.data.holders.some(Boolean)));
    if (!idle.length) return;
    idle.sort((a, b) => a.born - b.born);
    // retire enough untouched chores to open one slot in a single pass (a new chore only spawns once the board is below its limit)
    let n = 0;
    while (idle.length && this.active.size >= this.poolSize) {
      const victim = idle.shift();
      this.m.log(`The crypt shuffles its chores: "${victim.def.name}" was retired (no minion could take it).`);
      this.removeTask(victim); n++;
    }
    if (n) { this.replenishT = 0.5; this.reassign(); }        // refill the freed slot right away with bot-doable work
  }

  /** Hold duration after the debug multiplier. */
  need(sec) { return sec * (this.m.dbg.holdMul ?? 1); }

  // ============================================================ PERSONAL TASK LISTS
  // Each living, non-ghost minion owns a short personal list: SOLO_PER (2) solo tasks + a share of ONE co-op task.
  // Tasks still live in the single `active` map (so completion / hazards / jam logic are unchanged); `assignedTo` is the
  // list of player ids the task appears for, and `kind` is 'solo' or 'coop'. The board size is derived from the roster,
  // not a fixed pool, so nobody sees a 9-task wall. `maxConcurrent` (debug) still caps the TOTAL number of live tasks.
  get SOLO_PER() { return 2; }
  /** Players who should receive personal tasks right now (alive, not ghosts, in the work phase). */
  assignees() { return this.m.list.filter(p => !p.ghost); }
  /** How many solo + co-op slots the current roster wants (ignoring the debug cap). */
  wantSolo() { return this.assignees().length * this.SOLO_PER; }
  wantCoopTasks() { return Math.max(1, Math.round(this.assignees().length / 2)); }    // ~1 co-op task per 2 minions
  /** Hard cap on how many tasks may be live at once (debug override still wins). */
  get poolSize() { return this.m.dbg.maxConcurrent ?? Math.min(this.m.balance.pool + 8, this.wantSolo() + this.wantCoopTasks() + 2); }
  coopSeats(def) { return def.type === 'coop3' ? 3 : 2; }

  /** True when `p` sees this task on their personal list: it is assigned to them, it is still-unassigned legacy state,
   *  or a teammate has "called for help" on this co-op task (then it is shown to the whole crew). */
  assignedToPlayer(inst, pid) {
    if (!inst.assignedTo || inst.assignedTo.length === 0) return true;
    if (inst.assignedTo.includes(pid)) return true;
    if (inst.helpCall && inst.kind === 'coop') return true;
    return false;
  }

  fillPool() { this.reassign(); }

  /**
   * Keep every assignee stocked with SOLO_PER solo tasks + membership in one co-op task. Called on a short cadence from
   * tick() and immediately after a completion. Never exceeds poolSize; respects the bot-doable floor so a bots-only crew
   * is never handed a board of chores it refuses.
   */
  reassign() {
    if (this.m.phase !== PHASE.WORK) return;
    const live = this.assignees();
    const liveIds = new Set(live.map(p => p.id));
    // Drop assignments for players who left / died.
    for (const inst of this.active.values()) if (inst.assignedTo) inst.assignedTo = inst.assignedTo.filter(id => liveIds.has(id));

    const crew = this.botCrew();
    const soloCount = p => [...this.active.values()].filter(t => t.kind === 'solo' && t.assignedTo.includes(p.id)).length;

    // When a Humanlike bot crew exists, give the BOTS their solo (bot-doable) work FIRST. A tiny debug "max tasks" cap must
    // never be filled with co-op / refused chores before the bots get something they can actually do, or the match stalls.
    if (crew > 0) {
      for (const p of live.filter(q => q.isBot)) {
        let guard = 0;
        while (soloCount(p) < this.SOLO_PER && this.active.size < this.poolSize && guard++ < 20) {
          if (!this.spawnTask(null, 'solo', p)) break;
        }
      }
    }

    // ----- co-op: enough co-op tasks exist and each assignee is a member of one (co-op needs ≥2 bots to be bot-doable) -----
    if (crew === 0 || crew >= 2 || live.some(p => !p.isBot)) {
      let coop = [...this.active.values()].filter(t => t.kind === 'coop');
      const coopMembers = new Set(coop.flatMap(t => t.assignedTo));
      const needCoopMembers = live.filter(p => !coopMembers.has(p.id));
      while (needCoopMembers.length && this.active.size < this.poolSize) {
        let host = coop.find(t => t.assignedTo.length < this.coopSeats(t.def));
        if (!host) { host = this.spawnTask(null, 'coop'); if (!host) break; coop.push(host); }
        const seats = this.coopSeats(host.def) - host.assignedTo.length;
        for (let i = 0; i < seats && needCoopMembers.length; i++) host.assignedTo.push(needCoopMembers.shift().id);
      }
    }

    // ----- solo: top every assignee (humans first now, bots already done) up to SOLO_PER -----
    for (const p of live) {
      let guard = 0;
      while (soloCount(p) < this.SOLO_PER && this.active.size < this.poolSize && guard++ < 20) {
        if (!this.spawnTask(null, 'solo', p)) break;
      }
    }
    // keep the lard puddle task honest
    if (this.lard.size === 0) for (const t of [...this.active.values()]) if (t.def.lard) this.removeTask(t);
  }

  /**
   * Add one task to the board. `kind` ('solo'|'coop') steers the catalogue filter; `owner` (a player) is pre-assigned to
   * a fresh solo task. Returns the instance, or false when nothing suitable is free.
   */
  spawnTask(forceKey = null, kind = null, owner = null) {
    const activeKeys = new Set([...this.active.values()].map(t => t.key));
    let key = forceKey;
    if (!key) {
      const wantCoop = kind === 'coop';
      let cands = TASK_KEYS.filter(k => !activeKeys.has(k) && (k !== 'mop' || this.lard.size > 0));
      if (kind) { const typed = cands.filter(k => (TASKS[k].type !== 'solo') === wantCoop); if (typed.length) cands = typed; }
      // A bots-only crew must always get work it can really do (otherwise the tasks they refuse fill every slot and the
      // match stalls). For a solo task they will be assigned, keep it bot-doable.
      const crew = this.botCrew();
      if (crew > 0 && owner?.isBot && kind === 'solo') { const only = cands.filter(k => this.botDoable(TASKS[k], crew)); if (only.length) cands = only; }
      else if (crew > 0 && kind !== 'coop') {
        const have = [...this.active.values()].filter(t => this.botDoable(t.def, crew)).length;
        if (have < Math.max(1, Math.round(this.poolSize * 0.4))) { const only = cands.filter(k => this.botDoable(TASKS[k], crew)); if (only.length) cands = only; }
      }
      if (!cands.length) return false;
      key = pick(cands);
    } else if (activeKeys.has(key)) {
      const old = [...this.active.values()].find(t => t.key === key); this.removeTask(old);
    }
    const def = TASKS[key];
    if (key === 'mop' && !this.lard.size) this.addLard();
    // Every active task gets its own colour (lowest free palette slot); all its markers, tools and items share it.
    const usedC = new Set([...this.active.values()].map(t => t.color));
    let color = 0; while (usedC.has(color) && color < TASK_COLORS - 1) color++;
    if (usedC.has(color)) color = UID % TASK_COLORS;
    const kindFinal = kind || (def.type === 'solo' ? 'solo' : 'coop');
    const inst = { uid: UID++, key, def, rep: 0, progress: 0, participants: new Set(), data: {}, born: this.m.time, color,
      kind: kindFinal, assignedTo: owner ? [owner.id] : [], helpCall: false };
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
      case 'collect':
        inst.data.placed = def.steps.map(() => false); inst.data.carrier = null;
        // spawn the items as visible props lying on the ground/table BEFORE pickup (one per rep)
        inst.data.items = def.steps.map((_, i) => { const s = def.srcs[i % def.srcs.length]; return this.makeItem(def.item, s.x, s.y ?? 0.15, s.z, inst.uid).id; });
        break;
      default: break;
    }
    this.active.set(inst.uid, inst);
    return inst;
  }

  removeTask(inst, reason = 'cancel') {
    if (!inst) return;
    for (const p of this.m.list) {
      if (p.hold?.uid === inst.uid) this.m.releaseHold(p, reason);
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
    for (const p of participants) { if (!p) continue; p.gold += coins; names.push(p.name); if (p.obs) p.obs.tasks++; this.m.send(p.id, { t: 'coins', amount: coins }); }
    const pos = this.mainPoint(inst);
    this.m.fx('taskdone', { x: pos.x, y: pos.y, z: pos.z, name: inst.def.name });
    this.m.log(`${inst.def.name} done by ${names.join(', ')}`, 'task');
    if (inst.def.lard && inst.data.lardId) this.lard.delete(inst.data.lardId);
    // Put the tool down as soon as the job is finished, so nobody wanders off to another room with it.
    if (inst.def.tool) for (const p of participants) {
      if (p && p.heldTool && this.tools.get(p.heldTool)?.type === inst.def.tool) {
        const nm = TOOLS[inst.def.tool].name; this.dropTool(p); this.m.toast(p.id, `Job done — you put the ${nm} down.`);
      }
    }
    for (const p of participants) this.m.maybeDropRole(p);          // Simplified Mode: chores may yield a role card
    this.removeTask(inst, 'done');
    // Personal lists: a finished task frees its owners' slots. Refill after a short delay so the HUD doesn't flicker.
    this.respawnQ.push(this.m.timers.taskRespawnDelay);
    this.m.bars.addTaskProgress(1);
  }
  forceComplete(inst, participants = []) { this.complete(inst, participants); }

  /** A player broadcasts a co-op task to the whole crew ("I need a partner here!"). It then shows for everyone. */
  callForHelp(p, uid) {
    const inst = this.active.get(+uid);
    if (!inst || inst.kind !== 'coop' || !this.assignedToPlayer(inst, p.id)) return;
    inst.helpCall = true;
    const partners = inst.assignedTo.filter(id => id !== p.id).map(id => this.m.P(id)?.name).filter(Boolean);
    this.m.toastAll(`🆘 ${p.name} needs help: ${inst.def.name} (${ROOM_TAGS[inst.def.room]})${partners.length ? ' — with ' + partners.join(' & ') : ''}`, 'info');
  }

  /**
   * Auto-ping the paired partner(s) when a minion engages a co-op station alone, so they know to come help.
   * Fires once per ~6 s per task while a partner isn't already on it (toast + a chime fx at the station for the partner).
   */
  pingCoopPartner(p, inst) {
    if (inst.kind !== 'coop' || !inst.assignedTo) return;
    const partners = inst.assignedTo.filter(id => id !== p.id).map(id => this.m.P(id)).filter(q => q && !q.ghost);
    if (!partners.length) return;
    // don't nag if a partner is already working this task
    if (partners.some(q => q.hold?.uid === inst.uid || q.carryHandle?.uid === inst.uid)) return;
    if (this.m.time - (inst.data.pingAt ?? -99) < 6) return;
    inst.data.pingAt = this.m.time;
    inst.helpCall = true;                                        // also surface it on the HUD board
    const pos = this.mainPoint(inst);
    for (const q of partners) {
      this.m.send(q.id, { t: 'coopPing', x: pos.x, z: pos.z, label: inst.def.name, from: p.name, room: ROOM_TAGS[inst.def.room] });
      this.m.send(q.id, { t: 'fx', type: 'chime', id: q.id });
    }
  }

  // ---------------------------------------------------------------- bot support
  heldToolType(p) { return p.heldTool ? this.tools.get(p.heldTool)?.type ?? null : null; }

  /**
   * Mechanical bar for scripted (abstract) bot work: a bot can neither make progress on, nor complete,
   * a task whose tool it is not holding. Returns false (and changes nothing) when it is empty-handed.
   */
  botMayWork(p, inst) { return !inst.def.tool || this.heldToolType(p) === inst.def.tool; }
  botComplete(p, inst) {
    if (!this.botMayWork(p, inst)) return false;
    this.complete(inst, [p]);
    return true;
  }

  /** Nearest tool of `type` that nobody is holding. */
  nearestFreeTool(type, from) {
    let best = null, bd = Infinity;
    for (const t of this.tools.values()) {
      if (t.type !== type || t.heldBy) continue;
      const d = dist2(from, t);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // ---------------------------------------------------------------- items & tools
  makeItem(type, x, y, z, taskUid = null) {
    const it = { id: 'i' + (UID++), type, x, y, z, heldBy: null, taskUid, step: 0, dropper: null };
    this.items.set(it.id, it); return it;
  }
  deleteItem(it) {
    if (it.heldBy) { const p = this.m.P(it.heldBy); if (p && p.heldItem === it.id) p.heldItem = null; }
    this.clearCollectCarrier(it);
    this.items.delete(it.id);
  }
  itemHeavy(itemId) { const it = this.items.get(itemId); return it ? ITEM_TYPES[it.type]?.heavy || 0 : 0; }
  /** When a 'collect' item leaves a player's hand, free that task's carrier slot so a new item can be fetched. */
  clearCollectCarrier(it) {
    const inst = it.taskUid != null ? this.active.get(it.taskUid) : null;
    if (inst && inst.def.mech === 'collect' && inst.data.carrier === it.heldBy) inst.data.carrier = null;
  }

  dropItem(p) {
    const it = this.items.get(p.heldItem);
    p.heldItem = null;
    if (!it) return;
    // A collect item dropped loose (not placed) stays as a world prop on the floor and frees the carrier slot,
    // so it remains visible and can be picked up again.
    if (it.taskUid != null && this.active.get(it.taskUid)?.def.mech === 'collect') this.clearCollectCarrier(it);
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
  /** Scatter `amount` gold as individual coin piles (max 10) around the impact point; each is picked up with a short [E] hold. */
  spawnCoins(x, z, amount) {
    const n = Math.max(1, Math.min(10, amount));
    const base = Math.floor(amount / n); let extra = amount - base * n;
    for (let i = 0; i < n; i++) {
      const id = 'c' + (UID++), a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.9;
      this.coins.set(id, { id, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, amount: base + (extra-- > 0 ? 1 : 0) });
    }
  }

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
        if (s) pt('spot', s, `${d.name}${d.tool ? ' — needs ' + TOOLS[d.tool].name : ''} (hold E)`, true, { tool: d.tool, need: this.need(d.time), verb: d.name });
        break;
      }
      case 'stack': pt('spot', d.spots[0], `${d.name} — ride a friend's back (E on them)${d.tool ? ' + ' + TOOLS[d.tool].name : ''}, hold E`, true, { tool: d.tool, high: true, need: this.need(d.time), verb: d.name }); break;
      case 'fetch': case 'books':
        if (d.src) pt('src', d.src, d.tool ? `Scoop ${ITEM_TYPES[d.item].name} (needs ${TOOLS[d.tool].name})` : `Take ${ITEM_TYPES[d.item].name}`, false, { tool: d.tool });
        d.steps.forEach((s, i) => pt('s' + i, s, `${i === d.steps.length - 1 ? 'Deliver' : 'Process'} ${ITEM_TYPES[d.item].name}${s.time ? ' (hold E)' : ''}`, s.time > 0, { step: i, need: this.need(s.time || 0), verb: `${i === d.steps.length - 1 ? 'Delivering' : 'Processing'} ${ITEM_TYPES[d.item].name}` }));
        break;
      case 'collect': {
        const placed = inst.data.placed || [];
        // show the "take" marker over a remaining source prop (none while someone is carrying one)
        if (!this.m.P(this.carrierOf(inst))) { const free = [...this.items.values()].find(i => i.taskUid === inst.uid && !i.heldBy && i.step === 0); if (free) pt('src', { x: free.x, y: 0.4, z: free.z }, `Take ${ITEM_TYPES[d.item].name}`, false, { collectSrc: true }); }
        d.steps.forEach((s, i) => { if (!placed[i]) pt('d' + i, s, `Place ${ITEM_TYPES[d.item].name} here (E)`, false, { slot: i, goal: true }); });
        break;
      }
      case 'coop': d.handles.forEach((h, i) => pt('h' + i, h, `${d.name} — handle ${i + 1}/${d.handles.length} (hold E together)`, true, { need: 0, verb: d.name, coop: true })); break;
      case 'bell': d.handles.forEach((h, i) => pt('r' + i, h, `Bell rope ${i + 1} — pull in order 1-2-3 (3 minions)`, false)); break;
      case 'bellows': d.handles.forEach((h, i) => pt('p' + i, h, `Bellows pad ${i + 1} — jump on it, alternate with partner`, false, { pad: true })); break;
      case 'carry': {
        const o = inst.data.obj;
        [-1, 1].forEach((sgn, i) => pt('h' + i, { x: o.x + sgn * d.handleOff, y: 0.8, z: o.z }, `${d.name} — grab handle ${i + 1} (E)`, false));
        pt('goal', d.target, `Destination: ${d.name}`, false, { goal: true });
        break;
      }
      case 'relay': pt('pile', d.pile, 'Drop a sandbag over the threshold (hold E)', true, { need: this.need(d.time), verb: 'Dropping a sandbag' }); pt('goal', d.target, 'Acid puddle — dump the sandbag (E)', false); break;
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
    if (this.m.phase !== PHASE.WORK) return;
    if (p.frozen || p.body.ragdoll > 0 || p.carriedBy) return;
    if (target.startsWith('tool:')) return this.pickTool(p, target.slice(5));
    if (target.startsWith('item:')) return this.pickItem(p, target.slice(5));
    if (target.startsWith('coin:')) {
      const c = this.coins.get(target.slice(5));
      if (!c || dist2(p.body, c) > 2.6) return;
      p.hold = { target, uid: null, need: this.m.timers.coinPickup, pos: { x: c.x, y: 0.1, z: c.z }, onDone: () => {
        if (!this.coins.has(c.id)) return this.m.toast(p.id, 'Someone grabbed those coins first!');
        p.gold += c.amount; this.coins.delete(c.id); this.m.send(p.id, { t: 'coins', amount: c.amount });
      } };
      return;
    }
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
        if (d.game) {                              // 2D minigame (e.g. scrub): open the overlay instead of a timed hold
          inst.data.gamePart = part; inst.data.gameAt = this.m.time;
          this.m.send(p.id, { t: 'minigame', uid: inst.uid, game: d.game, part, name: d.name, tool: d.tool, cfg: this.gameCfg(d) });
          return;
        }
        p.hold = { target, uid: inst.uid, need: this.need(d.time), pos: pt, onDone: () => this.repDone(inst, p) };
        break;
      case 'collect': this.useCollect(p, inst, part, pt); break;
      case 'stack':
        if (!p.ridingOn) return this.m.toast(p.id, 'Too high! Climb on another minion\'s back first (E on a minion).', 'warn');
        if (d.tool && !needTool(d.tool)) return;
        p.hold = { target, uid: inst.uid, need: this.need(d.time), pos: pt, high: true, onDone: () => this.complete(inst, [p, this.m.P(p.ridingOn)]) };
        break;
      case 'fetch': case 'books': this.useFetch(p, inst, part, pt, needTool); break;
      case 'coop': p.hold = { target, uid: inst.uid, need: Infinity, pos: pt, handle: +part.slice(1) }; this.pingCoopPartner(p, inst); break;
      case 'bell': this.pullBell(p, inst, +part.slice(1)); break;
      case 'carry': this.grabHandle(p, inst, +part.slice(1)); this.pingCoopPartner(p, inst); break;
      case 'relay':
        if (part === 'pile') {
          if ([...this.items.values()].some(i => i.taskUid === inst.uid)) return this.m.toast(p.id, 'A sandbag is already waiting to be carried.');
          p.hold = { target, uid: inst.uid, need: this.need(d.time), pos: pt, onDone: () => { const it = this.makeItem('sandbag', d.drop.x, 0.2, d.drop.z, inst.uid); it.dropper = p.id; inst.participants.add(p.id); this.m.toast(p.id, 'Sandbag dropped — your partner must haul it to the acid!'); } };
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

  // ---------------------------------------------------------------- minigames + collect
  carrierOf(inst) { return inst.data.carrier; }
  /** Per-minigame config the client overlay needs (kept small; the server stays authoritative over task progress). */
  gameCfg(d) {
    const R = (a, b) => a + Math.random() * (b - a);
    switch (d.game) {
      case 'scrub':  return { threshold: 0.9, dirty: d.tool === 'mop' ? 'lard' : d.tool === 'rag' ? 'dust' : 'soot' };
      case 'catch':  return { quota: 8, speed: 1 };                                   // Drain Condensate — catch 8 drips
      case 'derust': return { gears: 7, rusty: shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, 3 + randInt(0, 1)).sort((a, b) => a - b) };  // 3–4 rusted gears
      case 'whack':  return { hits: 7, label: d.tool === 'cleaver' ? 'chop' : 'strike' };
      case 'grind':  return { sweetLo: +R(0.55, 0.68).toFixed(3), sweetHi: +R(0.78, 0.92).toFixed(3), speed: +R(0.55, 0.8).toFixed(3) };
      case 'mix':    return this.newMix();                                            // target colour + 3 base pours
      case 'simon':  return { vials: 8, rounds: 3, seq: Array.from({ length: 3 }, () => randInt(0, 7)) };
      case 'pour':   return { sweetLo: +R(0.6, 0.72).toFixed(3), sweetHi: +R(0.82, 0.95).toFixed(3), fill: +R(0.6, 0.95).toFixed(3) };
      case 'plunge': return { plunges: 6 };
      case 'gauges': return { gauges: 3 };
      default:       return {};
    }
  }
  /** Colour-mix target: 3 base pours (R/Y/B) chosen server-side; the client must recreate the mix. */
  newMix() {
    const bases = ['r', 'y', 'b'];
    const recipe = Array.from({ length: 3 }, () => bases[randInt(0, 2)]).sort();
    return { bases, recipe };
  }
  /**
   * A minigame overlay reports success. We validate the player is still at the task, holds the right tool, and that a
   * minimum play time passed (so a tampered client can't instant-finish), then advance one rep exactly like a hold.
   */
  minigameDone(p, uid, part) {
    const inst = this.active.get(+uid);
    if (!inst || !inst.def.game) return;
    const r = this.resolvePoint(`task:${inst.uid}:${part || inst.data.gamePart || 'spot'}`);
    const pt = r ? r.pt : this.mainPoint(inst);
    if (!this.inRange(p, pt, 1.0)) return this.m.toast(p.id, 'You moved away from the task.', 'warn');
    if (inst.def.tool && this.heldToolType(p) !== inst.def.tool) return this.m.toast(p.id, `You need the ${TOOLS[inst.def.tool].name}.`, 'warn');
    if (this.m.time - (inst.data.gameAt ?? 0) < 0.6) return;        // too fast to be real — ignore
    this.repDone(inst, p);
  }

  /** collect: pick an item at the source, carry it (held in hand), place it on the next free slot; repeat for `reps`. */
  useCollect(p, inst, part, pt) {
    const d = inst.def;
    if (part === 'src') {
      if (p.heldItem || p.load) return this.m.toast(p.id, 'Your hands are full.');
      if (inst.data.carrier) return this.m.toast(p.id, `Someone is already carrying a ${ITEM_TYPES[d.item].name}.`);
      // pick up one of the visible source props lying there (they exist in the world before pickup)
      const it = [...this.items.values()].find(i => i.taskUid === inst.uid && !i.heldBy && i.step === 0);
      if (!it) return this.m.toast(p.id, `No ${ITEM_TYPES[d.item].name} left to carry.`);
      it.heldBy = p.id; p.heldItem = it.id; inst.data.carrier = p.id;
      this.m.fx('lift', { x: it.x, z: it.z });
      this.m.toast(p.id, `Carry the ${ITEM_TYPES[d.item].name} to a glowing slot and press E.`);
      return;
    }
    // placing at slot d<i>
    const slot = +part.slice(1);
    const it = this.items.get(p.heldItem);
    if (!it || it.taskUid !== inst.uid) return this.m.toast(p.id, `Take a ${ITEM_TYPES[d.item].name} first.`);
    if (inst.data.placed[slot]) return this.m.toast(p.id, 'That slot is already filled.');
    inst.data.placed[slot] = true; inst.data.carrier = null;
    this.deleteItem(it); p.heldItem = null;
    inst.participants.add(p.id);
    this.m.fx('taskstep', { x: pt.x, y: pt.y, z: pt.z });
    inst.rep = inst.data.placed.filter(Boolean).length;
    inst.progress = inst.rep / (d.reps || d.steps.length);
    if (inst.rep >= (d.reps || d.steps.length)) this.complete(inst, [...inst.participants].map(id => this.m.P(id)));
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
    if (step.time > 0) p.hold = { target: pt.id, uid: inst.uid, need: this.need(step.time), pos: pt, onDone: finish };
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
    this.unjam(dt);
    // Personal task lists: top everyone up after the respawn delay (so a finished task's slot refills after 2–3 s).
    this.replenishT = (this.replenishT ?? 0) - dt;
    if (this.replenishT <= 0) { this.replenishT = this.m.timers.taskRespawnDelay; this.reassign(); }

    // holds
    for (const p of this.m.list) {
      const h = p.hold;
      if (!h) continue;
      if (p.body.ragdoll > 0 || p.frozen || (h.uid && !this.active.has(h.uid)) || !this.inRange(p, h.pos, h.high ? 1.4 : 1.0)) { this.m.releaseHold(p); continue; }
      if (h.need === Infinity) continue;
      p.holdT += dt;
      if (p.holdT >= h.need) { const fn = h.onDone; this.m.releaseHold(p, 'done'); fn && fn(); }
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
  /**
   * Per-viewer: only the tasks on THIS player's personal list (their 2 solo + 1 co-op), plus any co-op task that a
   * teammate has "called for help" on. Co-op entries carry their partners so the HUD can show "with 🔴 Bob".
   */
  serializeTasks(viewer = null) {
    const out = [];
    for (const inst of this.active.values()) {
      if (viewer && !this.assignedToPlayer(inst, viewer.id)) continue;
      const partners = inst.kind === 'coop' && viewer
        ? inst.assignedTo.filter(id => id !== viewer.id).map(id => { const q = this.m.P(id); return q ? { name: q.name, color: q.color } : null; }).filter(Boolean)
        : [];
      out.push({
        uid: inst.uid, key: inst.key, name: inst.def.name, room: inst.def.room, tag: ROOM_TAGS[inst.def.room], type: inst.def.type,
        color: inst.color, tool: inst.def.tool || undefined, kind: inst.kind, partners, helpCall: !!inst.helpCall,
        mine: viewer ? (inst.assignedTo || []).includes(viewer.id) : true,
        coins: COIN_BY_TYPE[inst.def.type], progress: +inst.progress.toFixed(3), rep: inst.rep, reps: inst.def.reps || 1,
        points: this.points(inst).map(q => ({ ...q, x: +q.x.toFixed(2), y: +(q.y ?? 1).toFixed(2), z: +q.z.toFixed(2) })),
        rune: inst.def.mech === 'runes' ? inst.data.rune : undefined, wall: inst.def.wall,
        obj: inst.data.obj ? { x: +inst.data.obj.x.toFixed(2), z: +inst.data.obj.z.toFixed(2) } : undefined,
        holders: inst.data.holders, count: inst.data.count, seq: inst.data.seq ? inst.data.seq.length : undefined,
      });
    }
    return out;
  }
  serializeWorld() {
    return {
      tools: [...this.tools.values()].map(t => ({ id: t.id, type: t.type, x: +t.x.toFixed(2), y: t.y, z: +t.z.toFixed(2), heldBy: t.heldBy })),
      items: [...this.items.values()].map(i => ({ id: i.id, type: i.type, x: +i.x.toFixed(2), y: +i.y.toFixed(2), z: +i.z.toFixed(2), heldBy: i.heldBy, wild: !!i.wild, step: i.step, task: i.taskUid })),
      coins: [...this.coins.values()],
      lard: [...this.lard.values()],
      door: { open: this.coldDoorOpen(), bolted: this.bolted },
    };
  }
}
