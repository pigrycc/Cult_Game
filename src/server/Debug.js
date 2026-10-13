// ============================================================================
//  DEVELOPER DEBUG SUITE — server-side command handlers (host-authorised).
//  The client overlay (F1) sends {t:'debug', cmd, a:{...}}.
// ============================================================================
import { PHASE, CER, FACTIONS, ROLE_BY_ID, CURSES, MILESTONE_EVENTS } from '../shared/constants.js';
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
        if (m.phase !== PHASE.LOBBY) { target.roleId = r; target.cardUsed = false; m.send(target.id, { t: 'roleChanged', roleId: r }); }
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
      case 'bot_mode': if (['idle', 'roamer', 'voter'].includes(a.mode)) { m.dbg.botMode = a.mode; ok('Bot behaviour: ' + a.mode); } return;
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
      case 'allow_debug_all': if (p.id === m.hostId) { m.dbg.debugAll = !!a.on; ok(`Debug for everyone: ${a.on}`); } return;
      default: return ok('Unknown debug command ' + cmd);
    }
  }

  serialize() {
    const d = this.m.dbg;
    return {
      freezeRed: d.freezeRed, redX: d.redX, redT: d.redT, yellowMul: d.yellowMul, debateSec: d.debateSec, debateInfinite: d.debateInfinite,
      maxConcurrent: d.maxConcurrent, mutinyThreshold: d.mutinyThreshold, forcedEvent: d.forcedEvent, botMode: d.botMode,
      timeScale: this.m.timeScale, debugAll: d.debugAll, forcedNpcs: d.forcedNpcs,
    };
  }
}
