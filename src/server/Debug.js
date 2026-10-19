// ============================================================================
//  DEVELOPER DEBUG SUITE — server-side command handlers (host-authorised).
//  The client overlay (F1) sends {t:'debug', cmd, a:{...}}.
// ============================================================================
import { PHASE, CER, FACTIONS, ROLE_BY_ID, CURSES, CURSE_KEYS, MILESTONE_EVENTS, DEFAULT_TIMERS } from '../shared/constants.js';
import { TASKS } from '../shared/tasks.js';

export class Debug {
  constructor(m) { this.m = m; }

  run(p, cmd, a = {}) {
    const m = this.m;
    if (!m.isDebugAllowed(p)) return m.toast(p.id, 'Debug console is host-only (host can enable it for everyone).', 'warn');
    const target = a.pid ? m.P(+a.pid) : p;
    const ok = msg => m.toast(p.id, '🛠 ' + msg);
    switch (cmd) {
      // ---- 1. Identity & role overrides
      case 'force_faction': {
        if (!target || !Object.values(FACTIONS).includes(a.faction)) return;
        m.dbg.forceFaction.set(target.id, a.faction);
        if (m.phase !== PHASE.LOBBY) { target.faction = a.faction; target.origFaction = a.faction; if (a.faction === FACTIONS.CHAOS && !m.P(m.chaosLeaderId)) m.chaosLeaderId = target.id; }
        return ok(`${target.name} → ${a.faction}${m.phase === PHASE.LOBBY ? ' (applied at deal)' : ''}`);
      }
      case 'force_role': {
        const r = +a.role; if (!target || !ROLE_BY_ID[r]) return;
        m.dbg.forceRole.set(target.id, r);
        if (m.phase !== PHASE.LOBBY) { target.roleId = r; target.cardUsed = false; target.roleRevealed = false; m.send(target.id, { t: 'roleChanged', roleId: r }); }
        return ok(`${target.name} → role ${ROLE_BY_ID[r].name}`);
      }
      case 'chaos_leader': if (target) { m.chaosLeaderId = target.id; target.faction = FACTIONS.CHAOS; ok(`${target.name} is now the Chaos Leader`); } return;
      case 'reset_card': if (target) { target.cardUsed = false; ok(`${target.name}'s card re-armed`); } return;
      case 'god_mode': p.godMode = !!a.on; return ok(`God Mode ${a.on ? 'ON' : 'OFF'}`);
      case 'infinite_mana': if (target) { target.infiniteMana = !!a.on; if (a.on) target.crystals = Math.max(target.crystals, 5); ok(`Infinite mana ${a.on ? 'ON' : 'OFF'}`); } return;
      // ---- 2. Bots
      case 'spawn_bots': {
        if (m.phase !== PHASE.LOBBY) return ok('Bots can only be added in the lobby.');
        const want = Math.max(0, Math.min(10, a.n | 0));
        const have = m.list.filter(q => q.isBot).length;
        if (want > have) m.bots.spawn(want - have);
        else for (const q of m.list.filter(q => q.isBot).slice(want)) m.players.delete(q.id);
        return ok(`Bots: ${m.list.filter(q => q.isBot).length}`);
      }
      case 'bot_delay': m.dbg.botDecisionDelaySeconds = Math.max(0, Math.min(10, +a.s)); return ok(`Humanlike reaction delay: ${m.dbg.botDecisionDelaySeconds}s (±33%)`);
      // ---- 0. Game mode (Simplified Mode can only be switched in the lobby)
      case 'simplified':
        if (m.phase !== PHASE.LOBBY) return ok('Simplified Mode can only be changed in the lobby.');
        m.dbg.simplified = !!a.on; return ok(`Simplified Mode ${a.on ? 'ON' : 'OFF'} (applies to the next match)`);
      case 'role_drop': m.dbg.roleDropPct = Math.max(0, Math.min(100, +a.pct || 0)); return ok(`Role drop chance per finished task: ${m.dbg.roleDropPct}%`);
      case 'simple_events': m.dbg.simpleEvents = !!a.on; return ok(`Milestone events in Simplified Mode: ${a.on ? 'ON' : 'OFF'}`);
      case 'eliminate_timer': m.dbg.eliminateSec = Math.max(1, Math.min(300, +a.s || 20)); return ok(`Master captive elimination timer: ${m.dbg.eliminateSec}s`);
      case 'voice_range': m.dbg.voiceRange = Math.max(3, Math.min(60, +a.v || 20)); return ok(`Proximity voice range: ${m.dbg.voiceRange} units`);
      case 'chaos_on_explode': m.dbg.destabilizationTriggersChaosWin = !!a.on; return ok(`Red Bar destabilisation = ${a.on ? 'CHAOS VICTORY' : 'everyone loses (default)'}`);
      case 'bot_chat': m.dbg.botChat = !!a.on; return ok(`Bot banter ${a.on ? 'ON' : 'OFF'}`);
      case 'bot_speed': m.dbg.botSpeed = Math.max(0.1, Math.min(4, +a.m || 1)); return ok(`Bot movement speed ×${m.dbg.botSpeed}`);
      case 'disable_sprint': m.dbg.noSprint = !!a.on; return ok(`Sprint (Shift) ${a.on ? 'DISABLED' : 'enabled'} for everyone`);
      case 'shove_drop': m.dbg.shoveDropPct = Math.max(0, Math.min(100, +a.pct || 0)); return ok(`Shove coin drop: ${m.dbg.shoveDropPct}%`);
      case 'bot_mode': if (['idle', 'roamer', 'voter', 'human'].includes(a.mode)) { m.dbg.botMode = a.mode; ok('Bot behaviour: ' + a.mode); } return;
      // ---- 3. Pacing & progress bars
      case 'red_tick': m.dbg.redX = a.x == null || a.x === '' ? null : Math.max(0, +a.x); m.dbg.redT = Math.max(0.1, +a.T || 1.5); return ok(`Red tick: ${m.dbg.redX ?? 'auto'} every ${m.dbg.redT}s`);
      case 'freeze_red': m.dbg.freezeRed = !!a.on; return ok(`Red bar ${a.on ? 'FROZEN' : 'running'}`);
      case 'yellow_mul': m.dbg.yellowMul = Math.max(0, +a.m || 1); return ok(`Yellow multiplier ×${m.dbg.yellowMul}`);
      case 'fill_milestone': if (m.phase === PHASE.WORK) m.bars.fillToNext(); return;
      case 'explode': if (m.phase === PHASE.WORK || m.phase === PHASE.CEREMONY) m.bars.explode(); return;
      case 'timescale': m.timeScale = Math.max(0.1, Math.min(8, +a.s || 1)); return ok(`Time scale ×${m.timeScale}`);
      // ---- 4. Ceremony & altar
      case 'force_duo': {
        const mm = a.master ? +a.master : null, ex = a.exec ? +a.exec : null;
        m.dbg.forcedDuo = { master: mm, exec: ex };
        if (mm && m.P(mm) && m.phase !== PHASE.LOBBY) { m.masterId = mm; }
        if (ex && m.phase === PHASE.CEREMONY && m.cer.sub === CER.NOMINATE) m.cer.nominate(ex);
        return ok(`Forced duo: master=${m.P(mm)?.name ?? '-'} exec=${m.P(ex)?.name ?? '-'}`);
      }
      case 'force_event': m.dbg.forcedEvent = a.ev && MILESTONE_EVENTS[a.ev] ? a.ev : null; return ok(`Forced milestone event: ${m.dbg.forcedEvent ?? 'track default'}`);
      case 'npc_config': {
        const list = (a.list || []).map(c => ({ faction: Object.values(FACTIONS).includes(c.faction) ? c.faction : undefined, curse: CURSES[c.curse] ? c.curse : undefined }));
        m.dbg.forcedNpcs = list.length ? list : null;
        if (m.phase === PHASE.WORK && !m.npcs.masterVisited) m.npcs.forcedLayout(list);
        return ok('Selection Chamber layout configured.');
      }
      case 'npc_clear': m.dbg.forcedNpcs = null; return ok('NPC layout: random');
      case 'debate_timer': m.dbg.debateSec = a.sec ? Math.max(1, +a.sec) : null; m.dbg.debateInfinite = !!a.infinite; return ok(`Debate: ${a.infinite ? '∞' : (m.dbg.debateSec ?? 'default') + 's'}`);
      case 'debate_skip': if (m.cer.sub === CER.DEBATE) m.cer.t = 0; return;
      case 'skip_step': if (m.phase === PHASE.CEREMONY) m.cer.t = 0; else if (m.phase === PHASE.REVEAL) m.phaseT = 0; return;
      case 'altar_tally': m.tally = { fire: a.fire | 0, blood: a.blood | 0, chaos: a.chaos | 0 }; return ok(`Altar tally F${m.tally.fire} B${m.tally.blood} C${m.tally.chaos}`);
      // ---- 5. Tasks
      case 'spawn_task': if (TASKS[a.key] && m.phase === PHASE.WORK) { m.tasks.spawnTask(a.key); ok('Spawned ' + TASKS[a.key].name); } return;
      case 'clear_tasks': for (const t of [...m.tasks.active.values()]) m.tasks.removeTask(t); m.tasks.respawnQ = []; return ok('All tasks cleared');
      case 'complete_task': { const t = m.tasks.active.get(+a.uid); if (t) m.tasks.forceComplete(t, [p]); return; }
      case 'max_concurrent': m.dbg.maxConcurrent = a.n ? Math.max(1, Math.min(30, a.n | 0)) : null; return ok(`Max concurrent tasks: ${m.tasks.poolSize}`);
      // ---- 6. Economy & statuses
      case 'set_crystals': if (target) { target.crystals = Math.max(0, Math.min(9, a.n | 0)); ok(`${target.name}: ${target.crystals} 💎`); } return;
      case 'add_gold': if (target) { target.gold = Math.max(0, target.gold + (a.n | 0)); ok(`${target.name}: ${target.gold} 💰`); } return;
      case 'mutiny_threshold': m.dbg.mutinyThreshold = a.n ? Math.max(1, Math.min(9, a.n | 0)) : null; return ok(`Mutiny threshold: ${m.dbg.mutinyThreshold ?? 'table'}`);
      case 'status': {
        if (!target) return;
        switch (a.effect) {
          case 'fumes': target.fumesT = m.timers.fumes; break;
          case 'silence': target.muted = !target.muted; target.mutedSince = m.ceremonyIndex; break;
          case 'exhaust': if (target.exhausted) m.exhaustedQueue = m.exhaustedQueue.filter(id => id !== target.id); else m.exhaustedQueue.push(target.id); m.refreshExhausted(); break;
          case 'ragdoll': m.ragdoll(target, 1.8, 5); break;
          case 'dismount': if (target.ridingOn) m.dismount(target, true); else if (target.rider) m.dismount(m.P(target.rider), true); else ok('Target is not stacked.'); break;
          case 'key': target.hasKey = !target.hasKey; break;
          case 'clear': target.fumesT = 0; target.muted = false; target.gagged = false; break;
          default: return;
        }
        return ok(`${a.effect} → ${target.name}`);
      }
      // ---- 7. Timers (all phase durations & countdowns)
      case 'set_timers': {
        const changed = [];
        for (const [k, v] of Object.entries(a.timers || {})) {
          if (!(k in DEFAULT_TIMERS) || v === '' || v == null || !isFinite(+v)) continue;
          const val = Math.max(0, Math.min(600, +v));
          if (k === 'revealBack' || k === 'revealFront') { if (val < 0.5) continue; }
          if (m.timers[k] !== val) { m.timers[k] = val; changed.push(`${k}=${val}`); }
        }
        if ('workSec' in a) m.dbg.workSec = a.workSec === '' || a.workSec == null ? null : Math.max(5, Math.min(600, +a.workSec));
        if ('holdMul' in a && isFinite(+a.holdMul)) m.dbg.holdMul = Math.max(0.05, Math.min(10, +a.holdMul));
        if ('debateSec' in a) m.dbg.debateSec = a.debateSec === '' || a.debateSec == null ? null : Math.max(1, +a.debateSec);
        // apply to a running countdown if requested
        if (a.applyNow && m.phase === PHASE.CEREMONY && m.cer.sub === CER.VOTE && 'vote' in (a.timers || {})) m.cer.t = Math.min(m.cer.t, m.timers.vote);
        return ok(`Timers updated ${changed.join(' ')} • work=${m.dbg.workSec ?? 'table'}s • hold×${m.dbg.holdMul} • debate=${m.dbg.debateSec ?? 'table'}`);
      }
      case 'reset_timers': m.timers = { ...DEFAULT_TIMERS }; m.dbg.workSec = null; m.dbg.holdMul = 1; m.dbg.debateSec = null; return ok('All timers reset to defaults');
      case 'extended_curses': m.dbg.extendedCurses = !!a.on; return ok(`Extended curses (Call of the Abyss, Dark Initiation) in random pool: ${a.on ? 'ON' : 'OFF'}`);
      case 'curse_weights': {
        // a.weights = { CURSE_KEY: number } relative spawn odds; a.on=false clears the override (back to uniform)
        if (a.on === false || !a.weights) { m.dbg.curseWeights = null; return ok('Curse odds: uniform (default)'); }
        const w = {};
        for (const k of CURSE_KEYS) if (a.weights[k] != null && isFinite(+a.weights[k])) w[k] = Math.max(0, Math.min(100, +a.weights[k]));
        m.dbg.curseWeights = w;
        return ok(`Curse odds updated: ${CURSE_KEYS.filter(k => w[k] != null).map(k => `${CURSES[k].name} ${w[k]}`).join(', ')}`);
      }
      case 'teleport': if (target && isFinite(+a.x) && isFinite(+a.z)) { Object.assign(target.body, { x: +a.x, y: 0, z: +a.z, vx: 0, vy: 0, vz: 0 }); m.send(target.id, { t: 'teleport', x: +a.x, z: +a.z, yaw: target.body.yaw }); ok(`${target.name} teleported (keeps held tool)`); } return;
      case 'note': return ok(String(a.text || '').slice(0, 120));
      case 'reset_overrides': {
        Object.assign(m.dbg, { destabilizationTriggersChaosWin: false, freezeRed: false, debateInfinite: false, debateSec: null, yellowMul: 1, maxConcurrent: null, workSec: null, holdMul: 1, redX: null, redT: 1.5 });
        m.timeScale = 1;
        return ok('Match-affecting overrides reset to normal');
      }
      case 'allow_debug_all': if (p.id === m.hostId) { m.dbg.debugAll = !!a.on; ok(`Debug for everyone: ${a.on}`); } return;
      default: return ok('Unknown debug command ' + cmd);
    }
  }

  serialize() {
    const d = this.m.dbg;
    return {
      freezeRed: d.freezeRed, redX: d.redX, redT: d.redT, yellowMul: d.yellowMul, debateSec: d.debateSec, debateInfinite: d.debateInfinite,
      maxConcurrent: d.maxConcurrent, mutinyThreshold: d.mutinyThreshold, forcedEvent: d.forcedEvent, botMode: d.botMode, botSpeed: d.botSpeed, botDecisionDelaySeconds: d.botDecisionDelaySeconds, botChat: d.botChat, destabilizationTriggersChaosWin: !!d.destabilizationTriggersChaosWin, simplified: !!d.simplified, roleDropPct: d.roleDropPct, simpleEvents: !!d.simpleEvents, eliminateSec: d.eliminateSec, voiceRange: d.voiceRange, inLobby: this.m.phase === PHASE.LOBBY, matchSimple: !!this.m.simple, noSprint: d.noSprint, shoveDropPct: d.shoveDropPct,
      timeScale: this.m.timeScale, debugAll: d.debugAll, forcedNpcs: d.forcedNpcs,
      timers: this.m.timers, workSec: d.workSec, holdMul: d.holdMul, extendedCurses: d.extendedCurses, curseWeights: d.curseWeights, workDefault: this.m.balance.work, debateDefault: this.m.balance.debate,
    };
  }
}
