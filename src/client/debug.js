// ============================================================================
//  DEBUG MENU / DEV CONSOLE (F1) — ImGui-style overlay. Every control sends a
//  host-validated {t:'debug', cmd, a} packet (see server/Debug.js).
// ============================================================================
import { ROLES, FACTIONS, CURSES, MILESTONE_EVENTS, CURSE_KEYS } from '../shared/constants.js';
import { TASKS, TASK_KEYS } from '../shared/tasks.js';

const opt = (v, l, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${l}</option>`;

export class DebugMenu {
  constructor(net) {
    this.net = net; this.el = document.getElementById('debug'); this.open = false; this.st = null; this.built = false; this.playersKey = '';
  }
  toggle() { this.open = !this.open; this.el.classList.toggle('hidden', !this.open); if (this.open) this.build(); return this.open; }
  cmd(cmd, a = {}) { this.net.send({ t: 'debug', cmd, a }); }

  playerOptions(includeNone = false) {
    const ps = this.st?.players || [];
    return (includeNone ? opt('', '— none —') : '') + ps.map(p => opt(p.id, `${p.name}${p.bot ? ' 🤖' : ''}${p.id === this.st.you.id ? ' (you)' : ''}`, p.id === this.st?.you.id && !includeNone)).join('');
  }

  build() {
    if (!this.st) return;
    const st = this.st, d = st.dbg || {};
    if (!st.you.debug) { this.el.innerHTML = '<div class="dbgHead">🛠 DEBUG</div><p>The host has not enabled the debug console for clients.</p>'; return; }
    this.playersKey = st.players.map(p => p.id + p.name).join();
    this.el.innerHTML = `
      <div class="dbgHead">🛠 DEV CONSOLE <span>(F1 to close • Esc frees mouse)</span></div>
      <details open><summary>1. Identity & Role Overrides</summary>
        <label>Target <select id="dTarget">${this.playerOptions()}</select></label>
        <label>Force Faction <select id="dFac">${Object.values(FACTIONS).map(f => opt(f, f)).join('')}</select><button data-c="faction">Apply</button></label>
        <label>Force Role <select id="dRole">${ROLES.map(r => opt(r.id, `${r.id}. ${r.icon} ${r.name}`)).join('')}</select><button data-c="role">Apply</button></label>
        <button data-c="leader">Make Chaos Leader</button> <button data-c="reset_card">Reset Role Cooldown / Re-arm Card</button>
        <label><input type="checkbox" id="dGod" ${st.you.god ? 'checked' : ''}> God Mode: Reveal All Info</label>
        <label><input type="checkbox" id="dInf" ${st.you.infiniteMana ? 'checked' : ''}> Infinite Mana (target)</label>
      </details>
      <details open><summary>2. Bot Management</summary>
        <label>Spawn Bot Count <input type="range" id="dBots" min="0" max="10" value="${st.players.filter(p => p.bot).length}"><b id="dBotsV">${st.players.filter(p => p.bot).length}</b><button data-c="bots">Apply (lobby)</button></label>
        <label>Bot Behaviour <select id="dBotMode">${[['idle', 'Dummy / Idle'], ['roamer', 'Random Task Roamer'], ['voter', 'Ceremony Auto-Voter']].map(([v, l]) => opt(v, l, d.botMode === v)).join('')}</select></label>
        <div class="small">Force Bot Role/Faction: pick the bot as Target in section 1.</div>
      </details>
      <details open><summary>3. Pacing & Progress Bars</summary>
        <label>Red Bar Tick: +<input id="dRedX" type="number" step="0.001" placeholder="auto" value="${d.redX ?? ''}" style="width:70px"> every <input id="dRedT" type="number" step="0.1" value="${d.redT ?? 1.5}" style="width:50px">s <button data-c="redtick">Set</button></label>
        <label><input type="checkbox" id="dFreeze" ${d.freezeRed ? 'checked' : ''}> Freeze Red Bar</label>
        <label>Yellow Reward Multiplier <input id="dYM" type="number" step="0.1" value="${d.yellowMul ?? 1}" style="width:60px"><button data-c="ymul">Set</button></label>
        <label>Server Time Scale <input id="dTS" type="number" step="0.5" value="${d.timeScale ?? 1}" style="width:60px"><button data-c="ts">Set</button></label>
        <button data-c="fill">Instant Fill to Next Milestone</button> <button data-c="explode" class="danger">Trigger Crypt Explosion</button>
      </details>
      <details><summary>4. Ceremony Phase & Altar</summary>
        <label>Force Master <select id="dMaster">${this.playerOptions(true)}</select> Executioner <select id="dExec">${this.playerOptions(true)}</select><button data-c="duo">Apply</button></label>
        <label>Force Milestone Event <select id="dEv">${opt('', 'Track default')}${['EMPTY', 'INSPECTION', 'FLOGGING', 'RENEWAL', 'MUTENESS', 'LIVING'].map(k => opt(k, MILESTONE_EVENTS[k].icon + ' ' + MILESTONE_EVENTS[k].name, d.forcedEvent === k)).join('')}</select><button data-c="ev">Set</button></label>
        <div class="npcCfg">${[0, 1, 2].map(i => `<div>NPC ${i + 1}: <select id="dNF${i}">${opt('', 'random')}${Object.values(FACTIONS).map(f => opt(f, f)).join('')}</select><select id="dNC${i}">${opt('', 'random')}${CURSE_KEYS.map(k => opt(k, CURSES[k].name)).join('')}</select></div>`).join('')}
          <button data-c="npcs">Configure Selection Chamber</button> <button data-c="npcclear">Random</button></div>
        <label>Debate Timer <input id="dDeb" type="number" value="${d.debateSec ?? ''}" placeholder="table" style="width:60px">s <input type="checkbox" id="dDebInf" ${d.debateInfinite ? 'checked' : ''}> ∞ <button data-c="debate">Set</button> <button data-c="debskip">End Debate</button></label>
        <button data-c="skip">Skip current ceremony step</button>
        <label>Override Altar Tally 🔥<input id="dTF" type="number" value="${st.tally.fire}" style="width:40px">🩸<input id="dTB" type="number" value="${st.tally.blood}" style="width:40px">🔮<input id="dTC" type="number" value="${st.tally.chaos}" style="width:40px"><button data-c="tally">Set</button></label>
      </details>
      <details><summary>5. Task Spawner</summary>
        <label>Force Spawn Task <select id="dTask">${TASK_KEYS.map(k => opt(k, `[${TASKS[k].room}] ${TASKS[k].name}`)).join('')}</select><button data-c="spawntask">Spawn</button></label>
        <button data-c="cleartasks">Clear All Active Tasks</button> <button data-c="completeaim">Complete Target Task (crosshair)</button>
        <label>Task Max Concurrent <input id="dMax" type="number" value="${d.maxConcurrent ?? ''}" placeholder="table" style="width:60px"><button data-c="max">Set</button></label>
      </details>
      <details><summary>6. Economy & Physical Statuses</summary>
        <label>Set Mana Crystals (target) <input id="dCry" type="number" min="0" max="5" value="${st.you.crystals}" style="width:50px"><button data-c="cry">Set</button></label>
        <label>Add / Remove Gold <input id="dGold" type="number" value="10" style="width:60px"><button data-c="gold">Apply</button></label>
        <label>Mutiny Threshold Override <input id="dMut" type="number" min="1" max="5" value="${d.mutinyThreshold ?? ''}" placeholder="table" style="width:60px"><button data-c="mut">Set</button></label>
        <div>Apply Status (target): ${[['fumes', 'Toxic Fumes'], ['silence', 'Curse of Silence'], ['exhaust', 'Exhaustion'], ['ragdoll', 'Ragdoll Stumble'], ['dismount', 'Knock off back'], ['key', 'Prison key'], ['clear', 'Clear']].map(([k, l]) => `<button data-s="${k}">${l}</button>`).join(' ')}</div>
        ${st.you.host ? `<label><input type="checkbox" id="dAll" ${d.debugAll ? 'checked' : ''}> Allow debug console for all clients</label>` : ''}
      </details>`;
    const v = id => document.getElementById(id)?.value;
    const tgt = () => +v('dTarget');
    this.el.querySelectorAll('button[data-c]').forEach(b => b.onclick = () => {
      switch (b.dataset.c) {
        case 'faction': this.cmd('force_faction', { pid: tgt(), faction: v('dFac') }); break;
        case 'role': this.cmd('force_role', { pid: tgt(), role: +v('dRole') }); break;
        case 'leader': this.cmd('chaos_leader', { pid: tgt() }); break;
        case 'reset_card': this.cmd('reset_card', { pid: tgt() }); break;
        case 'bots': this.cmd('spawn_bots', { n: +v('dBots') }); break;
        case 'redtick': this.cmd('red_tick', { x: v('dRedX'), T: +v('dRedT') }); break;
        case 'ymul': this.cmd('yellow_mul', { m: +v('dYM') }); break;
        case 'ts': this.cmd('timescale', { s: +v('dTS') }); break;
        case 'fill': this.cmd('fill_milestone'); break;
        case 'explode': this.cmd('explode'); break;
        case 'duo': this.cmd('force_duo', { master: +v('dMaster') || null, exec: +v('dExec') || null }); break;
        case 'ev': this.cmd('force_event', { ev: v('dEv') || null }); break;
        case 'npcs': this.cmd('npc_config', { list: [0, 1, 2].map(i => ({ faction: v('dNF' + i) || undefined, curse: v('dNC' + i) || undefined })) }); break;
        case 'npcclear': this.cmd('npc_clear'); break;
        case 'debate': this.cmd('debate_timer', { sec: +v('dDeb') || null, infinite: document.getElementById('dDebInf').checked }); break;
        case 'debskip': this.cmd('debate_skip'); break;
        case 'skip': this.cmd('skip_step'); break;
        case 'tally': this.cmd('altar_tally', { fire: +v('dTF'), blood: +v('dTB'), chaos: +v('dTC') }); break;
        case 'spawntask': this.cmd('spawn_task', { key: v('dTask') }); break;
        case 'cleartasks': this.cmd('clear_tasks'); break;
        case 'completeaim': { const t = this.aimTarget?.(); const uid = t && t.startsWith('task:') ? +t.split(':')[1] : null; if (uid) this.cmd('complete_task', { uid }); break; }
        case 'max': this.cmd('max_concurrent', { n: +v('dMax') || null }); break;
        case 'cry': this.cmd('set_crystals', { pid: tgt(), n: +v('dCry') }); break;
        case 'gold': this.cmd('add_gold', { pid: tgt(), n: +v('dGold') }); break;
        case 'mut': this.cmd('mutiny_threshold', { n: +v('dMut') || null }); break;
        default: break;
      }
    });
    this.el.querySelectorAll('button[data-s]').forEach(b => b.onclick = () => this.cmd('status', { pid: tgt(), effect: b.dataset.s }));
    document.getElementById('dGod').onchange = e => this.cmd('god_mode', { on: e.target.checked });
    document.getElementById('dInf').onchange = e => this.cmd('infinite_mana', { pid: tgt(), on: e.target.checked });
    document.getElementById('dFreeze').onchange = e => this.cmd('freeze_red', { on: e.target.checked });
    document.getElementById('dBotMode').onchange = e => this.cmd('bot_mode', { mode: e.target.value });
    document.getElementById('dBots').oninput = e => { document.getElementById('dBotsV').textContent = e.target.value; };
    const all = document.getElementById('dAll'); if (all) all.onchange = e => this.cmd('allow_debug_all', { on: e.target.checked });
    this.el.querySelectorAll('input,select').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
  }

  update(st) {
    const first = !this.st;
    this.st = st;
    if (this.open && (first || st.players.map(p => p.id + p.name).join() !== this.playersKey)) this.build();
  }
}
