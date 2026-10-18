// ============================================================================
//  UI — DOM overlays: menu, reveal cards, HUD (dual bar, task board, card,
//  crystals/gold), nameplates, NPC glyph tooltips, ceremony panels, modals,
//  finale & scoreboard.
// ============================================================================
import { FACTION_INFO, ROLE_BY_ID, ROLES, CURSES, MILESTONE_EVENTS, PHASE, CER, ROBE_COLORS, STATUS_ICONS, roleCard, FACTION_OBJECTIVE, curseDesc } from '../shared/constants.js';
import { TOOLS, ITEM_TYPES, RUNES, TASK_PALETTE } from '../shared/tasks.js';
import { matchAffectingOverrides } from './overrides.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
/** Coloured minion portrait chip (hood + two glowing eyes) followed by the name. */
export const avatar = (p, withName = true) => p ? `<span class="avc"><span class="av" style="--c:${p.color}"><i></i><i></i></span>${withName ? `<b>${esc(p.name)}</b>` : ''}</span>` : '';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ glyphs
const SHAPES = {
  circle: '<circle cx="32" cy="32" r="18" fill="none" stroke-width="6"/>',
  tri_up: '<path d="M32 10 L54 50 L10 50 Z" fill="none" stroke-width="6" stroke-linejoin="round"/>',
  tri_down: '<path d="M32 54 L54 14 L10 14 Z" fill="none" stroke-width="6" stroke-linejoin="round"/>',
  eye: '<path d="M6 32 Q32 6 58 32 Q32 58 6 32 Z" fill="none" stroke-width="5"/><circle cx="32" cy="32" r="7"/>',
  cloud: '<path d="M16 44 Q6 44 8 34 Q10 24 20 26 Q22 14 34 16 Q46 14 46 26 Q58 26 56 36 Q56 44 46 44 Z" fill="none" stroke-width="5"/>',
  key: '<circle cx="20" cy="32" r="10" fill="none" stroke-width="5"/><path d="M30 32 H56 M48 32 V42 M54 32 V40" stroke-width="5"/>',
  star: '<path d="M32 6 L39 24 L58 25 L43 37 L48 56 L32 45 L16 56 L21 37 L6 25 L25 24 Z" fill="none" stroke-width="4" stroke-linejoin="round"/>',
  seal: '<rect x="12" y="12" width="40" height="40" rx="6" fill="none" stroke-width="5"/><path d="M18 32 H46" stroke-width="6"/>',
};
export function glyphSVG(faction, curse, size = 56) {
  const col = FACTION_INFO[faction]?.glyph || '#888';
  const shape = SHAPES[CURSES[curse]?.shape || 'circle'];
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="filter:drop-shadow(0 0 6px ${col})"><g stroke="${col}" fill="${col}">${shape}</g></svg>`;
}

export class UI {
  constructor() {
    this.root = $('#ui');
    this.toastsEl = $('#toasts');
    this.bigEl = $('#bigText');
    this.platesEl = $('#nameplates');
    this.plates = new Map();
    this.labels = [];
    this.bubbles = new Map();
    this.chatOpen = false;
    this.modalOpen = false;
    this.lastCountKey = '';
    this.reveal = null;
    this.recipe = null;
  }

  // ------------------------------------------------------------------ menu
  showMenu({ electron, onHost, onJoin, onBrowse, error }) {
    const m = $('#menu'); m.classList.remove('hidden');
    $('#menuErr').textContent = error || '';
    $('#hostBox').style.display = electron ? '' : 'none';
    $('#nameIn').value = localStorage.getItem('crypt_name') || `Minion${Math.floor(Math.random() * 900 + 100)}`;
    $('#joinIn').value = localStorage.getItem('crypt_join') || '127.0.0.1:7777';
    $('#hostBtn').onclick = () => { localStorage.setItem('crypt_name', $('#nameIn').value); onHost({ name: $('#nameIn').value, port: +$('#portIn').value || 7777, debugAll: $('#dbgAll').checked, listed: $('#onlineList').checked }); };
    const joinCode = code => { localStorage.setItem('crypt_name', $('#nameIn').value); onJoin({ name: $('#nameIn').value, addr: 'room:' + code }); };
    $('#codeBtn').onclick = () => { const c = $('#codeIn').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length >= 4) joinCode(c); else this.menuError('Enter the 6-character room code.'); };
    const refresh = async () => {
      const box = $('#roomList'); box.innerHTML = '<div class="small">Searching…</div>';
      try {
        const rooms = await onBrowse();
        box.innerHTML = rooms.length ? rooms.map(r => `<div class="roomRow"><span class="roomName">${esc(r.name || "Crypt")}</span> <span class="small">${r.players}/${r.max} • ${r.simple ? 'Simplified' : 'Classic'} • <b class="roomCode">${esc(r.code)}</b></span> <button data-code="${esc(r.code)}">JOIN</button></div>`).join('')
          : '<div class="small">No open lobbies right now. Host one, or ask a friend for their room code.</div>';
        box.querySelectorAll('button[data-code]').forEach(b => b.onclick = () => joinCode(b.dataset.code));
      } catch (e) { box.innerHTML = `<div class="small">⚠ ${esc(e.message)}</div>`; }
    };
    $('#roomsBtn').onclick = refresh;
    if (onBrowse) { refresh(); clearInterval(this.roomIv); this.roomIv = setInterval(() => { if (!$('#menu').classList.contains('hidden')) refresh(); else clearInterval(this.roomIv); }, 8000); }
    $('#joinBtn').onclick = () => { localStorage.setItem('crypt_name', $('#nameIn').value); localStorage.setItem('crypt_join', $('#joinIn').value); onJoin({ name: $('#nameIn').value, addr: $('#joinIn').value }); };
  }
  hideMenu() { $('#menu').classList.add('hidden'); $('#hud').classList.remove('hidden'); }
  menuError(e) { $('#menuErr').textContent = e; }

  // ------------------------------------------------------------------ reveal (2D cards)
  showReveal(msg, onDone) {
    if (msg.simple && !msg.roleId) return this.showFactionReveal(msg, onDone);
    const f = FACTION_INFO[msg.faction], r = ROLE_BY_ID[msg.roleId];
    const el = $('#reveal'); el.classList.remove('hidden'); el.style.opacity = 1;
    el.innerHTML = `
      <div class="objBanner" style="--fc:${f.color}"><b>FACTION OBJECTIVE ${f.icon}</b><span>${esc(FACTION_OBJECTIVE[msg.faction])}</span></div>
      <div class="cardWrap"><div class="card" id="rcard">
        <div class="face back" style="--glow:${f.color}"><div class="crest">${f.icon}</div><div class="runes">ᚠ ᚢ ᚦ ᚨ ᚱ</div></div>
        <div class="face front">${(() => { const c = roleCard(r.id, msg); return `<div class="rWhen"><b>WHEN TO USE:</b> ${esc(c.when)}</div><div class="rIcon">${r.icon}</div><div class="rName">${esc(r.name)}</div><div class="rDesc">${esc(c.text)}</div>`; })()}</div>
      </div><div class="cardGlow" style="background:${f.color}"></div></div>
      <div class="revealTitle" id="rTitle" style="color:${f.color}">${f.name.toUpperCase()}</div>
      <div class="revealSub pulse" id="rSub">Press any key to reveal role</div>
      <div class="revealTimer" id="rTimer">(00:05)</div>`;
    let stage = 1, t = msg.back;
    const flip = () => {
      if (stage !== 1) return;
      stage = 2; t = msg.front;
      $('#rcard').classList.add('flipped');
      $('.cardGlow', el).style.background = '#d8c8a0';
      $('#rTitle').textContent = 'YOUR ROLE'; $('#rTitle').style.color = '#e8dcc0';
      $('#rSub').textContent = msg.faction === 'blood' ? '🩸 Your Blood allies are marked next to their names.' : 'Keep your faction secret. Your card is single-use — [G] to reveal it.';
      $('#rSub').classList.remove('pulse');
    };
    const key = () => flip();
    window.addEventListener('keydown', key); el.onclick = key;
    const iv = setInterval(() => {
      t -= 0.1;
      $('#rTimer').textContent = `(00:0${Math.max(0, Math.ceil(t))})`;
      if (t <= 0) {
        if (stage === 1) flip();
        else { clearInterval(iv); window.removeEventListener('keydown', key); el.style.opacity = 0; setTimeout(() => { el.classList.add('hidden'); onDone && onDone(); }, 700); }
      }
    }, 100);
  }

  /** Simplified Mode: only the faction identity is revealed at the start (no starting role card). */
  showFactionReveal(msg, onDone) {
    const f = FACTION_INFO[msg.faction];
    const el = $('#reveal'); el.classList.remove('hidden'); el.style.opacity = 1;
    el.innerHTML = `
      <div class="objBanner" style="--fc:${f.color}"><b>FACTION OBJECTIVE ${f.icon}</b><span>${esc(FACTION_OBJECTIVE[msg.faction])}</span></div>
      <div class="cardWrap"><div class="card"><div class="face back" style="--glow:${f.color}"><div class="crest">${f.icon}</div><div class="runes">ᚠ ᚢ ᚦ ᚨ ᚱ</div></div></div><div class="cardGlow" style="background:${f.color}"></div></div>
      <div class="revealTitle" style="color:${f.color}">${f.name.toUpperCase()}</div>
      <div class="revealSub">SIMPLIFIED MODE — no role card yet. Every finished chore has a chance to give you one.</div>
      <div class="revealTimer" id="rTimer"></div>`;
    let t = (msg.back || 3) + (msg.front || 3);
    const iv = setInterval(() => {
      t -= 0.1; $('#rTimer').textContent = `(00:${String(Math.max(0, Math.ceil(t))).padStart(2, '0')})`;
      if (t <= 0) { clearInterval(iv); el.style.opacity = 0; setTimeout(() => { el.classList.add('hidden'); onDone && onDone(); }, 700); }
    }, 100);
  }

  /**
   * Simplified Mode: a role card dropped from a chore. Full-screen for 15 s (LMB / click dismisses early), then the card
   * flies down into the bottom-right HUD slot.
   */
  showRoleDrop(roleId) {
    const r = ROLE_BY_ID[roleId]; if (!r) return;
    const el = $('#roleDrop'); clearInterval(this.dropIv); clearTimeout(this.dropFly);
    el.className = ''; el.innerHTML = `<div class="rdBack"></div><div class="rdInner">
      <div class="rdHead">✨ ROLE CARD FOUND ✨</div>
      <div class="rdCard"><div class="rIcon">${r.icon}</div><div class="rName">${esc(r.name)}</div><div class="rDesc">${esc(r.desc)}</div></div>
      <div class="rdHint">Use it during the <b>Mutiny Vote</b> with <b>[G]</b> • hold <b>[Q]</b> 3 s to discard it<br><span id="rdT">15</span> s — click to continue</div></div>`;
    this.roleDropOpen = true;
    let t = 15;
    this.dropIv = setInterval(() => { t -= 0.25; const e = $('#rdT'); if (e) e.textContent = Math.max(0, Math.ceil(t)); if (t <= 0) this.dismissRoleDrop(); }, 250);
    el.onclick = () => this.dismissRoleDrop();
  }
  dismissRoleDrop() {
    if (!this.roleDropOpen) return;
    this.roleDropOpen = false; clearInterval(this.dropIv);
    const el = $('#roleDrop'); el.classList.add('fly');                     // CSS: shrink + slide into the bottom-right slot
    this.dropFly = setTimeout(() => { el.className = 'hidden'; el.innerHTML = ''; }, 750);
  }

  jailer(msg, onReply) {
    const m = this.modal(`<h3>🗝️ Jailer — the captives at the portal</h3><p>Only you see this. Keep these captives, or send them into the abyss and RESPAWN 3 new ones (you will not know their factions).</p>
      <div class="jailList">${msg.captives.map(c => `<div class="jailRow" style="color:${FACTION_INFO[c.faction].glyph}">${FACTION_INFO[c.faction].icon} <b>${FACTION_INFO[c.faction].name}</b></div>`).join('')}</div>
      <button id="jkeep" class="primary">KEEP them</button> <button id="jresp">RESPAWN 3 new</button>`, { onClose: () => onReply(false) });
    $('#jkeep', m).onclick = () => { onReply(false); this.modalOpen = false; m.classList.add('hidden'); };
    $('#jresp', m).onclick = () => { onReply(true); this.modalOpen = false; m.classList.add('hidden'); };
  }
  mirrorPick(ids, onPick) {
    const m = this.modal(`<h3>🪞 Mirror Mage</h3><p>Copy and immediately trigger a role card that was already used:</p>
      <div class="plist">${ids.map(id => { const r = ROLE_BY_ID[id]; return `<button class="pbtn mm" data-id="${id}">${r.icon} <b>${esc(r.name)}</b><br><small>${esc(r.desc)}</small></button>`; }).join('')}</div>`);
    m.querySelectorAll('.mm').forEach(b => b.onclick = () => { this.closeModal(); onPick(+b.dataset.id); });
  }

  // ------------------------------------------------------------------ toasts / big text / labels
  toast(text, kind = 'info') {
    const e = h('div', 'toast ' + kind, esc(text));
    this.toastsEl.prepend(e);
    setTimeout(() => e.classList.add('out'), 5200); setTimeout(() => e.remove(), 6000);
    while (this.toastsEl.children.length > 7) this.toastsEl.lastChild.remove();
  }
  big(text, sub = '', dur = 3, color = '#fff', avatars = null) {
    const av = avatars && avatars.filter(Boolean).length ? `<div class="bigAv">${avatars.filter(Boolean).map(a => avatar(a)).join('<span class="avArrow">➜</span>')}</div>` : '';
    this.bigEl.classList.remove('err');
    this.bigEl.innerHTML = `${av}<div class="bigMain" style="color:${color}">${esc(text)}</div>${sub ? `<div class="bigSub">${esc(sub)}</div>` : ''}`;
    this.bigEl.classList.remove('out'); this.bigEl.style.opacity = 1;
    clearTimeout(this.bigT); this.bigT = setTimeout(() => { this.bigEl.style.opacity = 0; }, Math.max(1.2, dur) * 1000);
  }
  errorFlash(text) {
    this.big(`⛔ ${text}`, '', 2.2, '#ff5a4a');
    void this.bigEl.offsetWidth; this.bigEl.classList.add('err');
  }
  /** Clear every transient on-screen element (used when returning to the lobby). */
  purge() {
    clearTimeout(this.bigT); this.bigEl.style.opacity = 0; this.bigEl.innerHTML = ''; this.bigEl.classList.remove('err');
    this.toastsEl.innerHTML = ''; $('#chatLog').innerHTML = ''; this.closeChat();
    this.labels = []; this.bubbles.clear(); this.holdFx = null; $('#holdBox').classList.remove('done', 'cancel', 'continuous');
    $('#cerPanel').dataset.h = ''; $('#cerPanel').innerHTML = ''; $('#cerPanel').style.display = 'none';
    $('#tooltip').style.display = 'none'; $('#prompt').dataset.t = ''; $('#prompt').innerHTML = '';
    $('#reveal').classList.add('hidden'); $('#score').classList.add('hidden');
    if (this.modalOpen && this.closeModal) this.closeModal();
  }
  label(id, text, color, dur) { this.labels.push({ id, text, color, until: performance.now() + dur * 1000 }); }

  // ------------------------------------------------------------------ chat
  chat(msg, me) {
    const log = $('#chatLog');
    const tag = msg.ch === 'intercom' ? '<span class="ch ic">[PIPE]</span>' : msg.ch === 'global' ? '<span class="ch gl">[SANCTUARY]</span>' : '<span class="ch lc">[NEAR]</span>';
    const e = h('div', 'chatLine', `${tag} <b>${esc(msg.name)}:</b> ${esc(msg.text)}`);
    log.appendChild(e); while (log.children.length > 9) log.firstChild.remove();
    setTimeout(() => e.classList.add('fade'), 15000);
    if (msg.ch !== 'intercom') this.bubbles.set(msg.from, { text: msg.text, until: performance.now() + 5000 });
  }
  openChat(onSend) {
    const inp = $('#chatInput'); this.chatOpen = true; inp.classList.remove('hidden'); inp.value = ''; inp.focus();
    inp.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') { if (inp.value.trim()) onSend(inp.value); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    };
  }
  closeChat() { const inp = $('#chatInput'); inp.blur(); inp.classList.add('hidden'); this.chatOpen = false; }

  // ------------------------------------------------------------------ HUD (called on each state packet)
  updateHud(st, game) {
    const you = st.you, me = st.players.find(p => p.id === you.id);
    const inMatch = st.phase !== PHASE.LOBBY;
    // --- dual progress bar
    const bar = $('#bar'); bar.style.display = inMatch ? '' : 'none';
    if (inMatch) {
      $('#barRed').style.width = (st.bars.red * 100) + '%';
      $('#barYellow').style.width = (st.bars.yellow * 100) + '%';
      const mk = $('#barMarkers');
      const key = st.bars.markers.join(',') + st.track.join(',') + st.bars.reached;
      if (mk.dataset.k !== key) {
        mk.dataset.k = key; mk.innerHTML = '';
        st.bars.markers.forEach((v, i) => {
          const ev = MILESTONE_EVENTS[st.track[i]];
          const d = h('div', 'marker' + (i < st.bars.reached ? ' done' : ''), `<span title="${esc(ev.name)}">${ev.icon}</span>`);
          d.style.left = (v * 100) + '%'; mk.appendChild(d);
        });
      }
      const nextIdx = st.bars.reached;
      const nextEv = MILESTONE_EVENTS[st.track[nextIdx]];
      $('#barLabel').innerHTML = `<span class="red">▮ CRYPT DESTABILIZATION ${(st.bars.red * 100).toFixed(0)}%</span> &nbsp; <span class="yel">▮ STABILIZATION ${(st.bars.yellow * 100).toFixed(0)}%</span> &nbsp; Next: ${nextEv ? nextEv.icon + ' ' + nextEv.name : '—'} ${st.bars.running ? '' : '<span class="frz">❄ RED FROZEN</span>'}`;
    }
    // --- personal task board (your 2 solo + 1 co-op; plus co-op tasks a teammate called for help on)
    const tb = $('#taskBoard'); tb.style.display = st.phase === PHASE.WORK || st.phase === PHASE.CEREMONY ? '' : 'none';
    if (st.tasks) {
      const solo = st.tasks.filter(t => t.kind !== 'coop');
      const coop = st.tasks.filter(t => t.kind === 'coop');
      const partnerChips = t => (t.partners || []).map(p => `<span class="tbMate" style="--c:${p.color}">●</span>${esc(p.name)}`).join(' ');
      const row = t => `<div class="tbRow ${t.kind === 'coop' ? 'coop' : ''}${t.mine ? '' : ' called'}"><span class="tbSw" style="background:${TASK_PALETTE[t.color] || '#fff'}"></span><span class="tbTag">[${t.tag}]</span> ${esc(t.name)}${t.tool ? ` <span class="tbTool" style="color:${TASK_PALETTE[t.color] || '#fff'}">🔧 ${esc(TOOLS[t.tool]?.name || t.tool)}</span>` : ''}${t.kind === 'coop' && t.partners?.length ? ` <span class="tbWith">(with ${partnerChips(t)})</span>` : ''}${!t.mine ? ' <span class="tbHelp">🆘 help!</span>' : ''} <span class="tbCoin">(+${t.coins}💰)</span>${t.progress > 0 ? `<div class="tbProg"><div style="width:${t.progress * 100}%"></div></div>` : ''}</div>`;
      const html = `<div class="tbTitle">YOUR TASKS</div>${solo.map(row).join('')}`
        + (coop.length ? `<div class="tbTitle coop">CO-OP${st.you && !st.simple ? ' <span class="tbHint">[H] call for help</span>' : ' <span class="tbHint">[H] call for help</span>'}</div>${coop.map(row).join('')}` : '');
      if (tb.dataset.h !== html) { tb.dataset.h = html; tb.innerHTML = html; }
    }
    // --- lobby info
    const li = $('#lobbyInfo');
    if (st.lobby) {
      li.style.display = '';
      const L = st.lobby;
      const liHtml = `<div class="pc">PLAYERS: ${L.count} / ${L.max} (MIN. ${L.min})</div>
        <div class="modeLine ${st.simple ? 'simple' : ''}">MODE: <b>${st.simple ? 'SIMPLIFIED' : 'CLASSIC'}</b>${st.simple ? ' — no crystals, roles drop from chores, APPROVE/MUTINY vote' : ''}</div>
        ${game.online?.code ? `<div class="small">🌐 Online room <b class="roomCode">${esc(game.online.code)}</b> ${game.online.listed ? '— listed in Browse Rooms' : '(unlisted — share the code)'} ${game.online.status ? '• ' + esc(game.online.status) : ''}</div>` : ''}
        <div class="small">Host address: ${L.ips.length ? L.ips.map(ip => `<b>${ip}:${L.port}</b>`).join(' / ') : 'localhost:' + L.port}</div>
        <div class="small">Walk to the 🪞 mirror and press <b>E</b> to dye your robe.</div>
        ${you.host ? `<button id="startBtn" ${L.canStart ? '' : 'disabled'}>${L.canStart ? '[START GAME]' : `Waiting for ${L.min - L.count} more…`}</button><div class="small">F1 → Debug: spawn bots to test solo</div>` : '<div class="small">Waiting for the host to start the ritual…</div>'}
        <div class="lobbyList">${st.players.map(p => `<span style="color:${p.color}">●</span> ${esc(p.name)}${p.id === st.hostId ? ' 👑' : ''}${p.bot ? ' 🤖' : ''}`).join('<br>')}</div>`;
      if (li.dataset.h !== liHtml) { li.dataset.h = liHtml; li.innerHTML = liHtml; const sb = $('#startBtn'); if (sb) sb.onclick = () => game.net.send({ t: 'start' }); }
    } else li.style.display = 'none';
    // --- bottom bar
    const bb = $('#bottomBar'); bb.style.display = inMatch && st.phase !== PHASE.REVEAL ? '' : 'none';
    if (inMatch && st.simple && !you.roleId && you.faction) {
      // Simplified Mode, empty card slot
      const f = FACTION_INFO[you.faction];
      const bbHtml = `<div class="res"><div class="gold">💰 ${you.gold}</div><div class="fac" style="color:${f.color}">${f.icon} ${f.name}</div></div>
        <div class="held">${me?.tool ? '✋ ' + esc(TOOLS[me.tool]?.name) + ' <span class="k">[Q]</span>' : me?.item ? '✋ ' + esc(ITEM_TYPES[me.item]?.name) + ' <span class="k">[Q]</span>' : ''}</div><div class="statuses"></div>
        <div id="roleCard" class="roleCard empty"><div class="rcObj" style="--fc:${f.color}"><b>FACTION OBJECTIVE ${f.icon}</b><span>${esc(FACTION_OBJECTIVE[you.faction])}</span></div>
          <div class="rcIcon">🂠</div><div class="rcName">No role card</div><div class="rcText">Finish chores: each one has a ${Math.round(st.roleDropPct ?? 0)}% chance to give you a random role card.</div></div>`;
      if (bb.dataset.h !== bbHtml) { bb.dataset.h = bbHtml; bb.innerHTML = bbHtml; }
    }
    if (inMatch && you.roleId) {
      const r = ROLE_BY_ID[you.roleId], f = FACTION_INFO[you.faction];
      const usable = you.ability.ok;
      const card = roleCard(r.id, { threshold: st.balance.threshold, players: st.balance.players });
      const statuses = [];
      if (me?.master) statuses.push('👑 Master of Ceremonies');
      if (me?.exec) statuses.push('🪓 Executioner');
      if (you.exhausted) statuses.push('💤 Exhausted');
      if (you.muted) statuses.push('🤐 Muted');
      if (you.gagged) statuses.push('🔇 Gagged');
      if (you.fumes > 0) statuses.push(`🤢 Intoxicated ${Math.ceil(you.fumes)}s`);
      if (you.key) statuses.push('🗝️ Prison key');
      if (you.ghost) statuses.push('👻 Ghost');
      if (you.leader) statuses.push('🔮 Chaos Leader');
      const held = me?.tool ? TOOLS[me.tool]?.name : me?.item ? ITEM_TYPES[me.item]?.name : me?.npc ? 'Bound captive' : '';
      const bbHtml = `
        <div class="res">${st.simple ? '' : `<div class="crys">💎 ${you.crystals}${you.infiniteMana ? '∞' : ''}</div>`}<div class="gold">💰 ${you.gold}</div>
          <div class="fac" style="color:${f.color}">${f.icon} ${f.name}</div></div>
        <div class="held">${held ? '✋ ' + esc(held) + (me?.load ? ' + ' + esc(ITEM_TYPES[me.load]?.name) : '') + ' <span class="k">[Q]</span>' : ''}</div>
        <div class="statuses">${statuses.map(s => `<span>${s}</span>`).join('')}</div>
        <div id="roleCard" class="roleCard ${you.cardUsed ? 'used' : ''} ${usable ? 'usable' : ''}">
          <div class="rcObj" style="--fc:${f.color}"><b>FACTION OBJECTIVE ${f.icon}</b><span>${esc(FACTION_OBJECTIVE[you.faction])}</span></div>
          ${r.simple ? '' : `<div class="rcWhen"><b>WHEN TO USE:</b> ${esc(card.when)}</div>`}
          <div class="rcIcon">${r.icon}</div><div class="rcName">${esc(r.name)}</div>
          <div class="rcText">${esc(card.text)}</div>
          <div class="rcState">${you.cardUsed ? (r.simple ? '✖ USED — expended for the rest of the match' : 'USED (face up)') : usable ? '▶ READY — press [G]' : esc(r.simple ? 'Play it during the Mutiny Vote [G]' : you.ability.reason || 'face down')}</div>
          ${r.simple && !you.cardUsed ? `<div class="rcDiscard"><span>hold <b>[Q]</b> 3 s to discard</span><div class="rcDBar"><div id="rcDFill"></div></div></div>` : ''}
        </div>`;
      if (bb.dataset.h !== bbHtml) { bb.dataset.h = bbHtml; bb.innerHTML = bbHtml; $('#roleCard').onclick = () => game.useAbility(); }
    }
    // --- ceremony panel
    this.updateCeremony(st, game);
    // --- phase timer / spy timer
    const pt = $('#phaseTimer');
    if (st.cer) pt.innerHTML = `${st.cer.infinite ? '∞' : Math.ceil(st.cer.t) + 's'} <span>${cerTitle(st)}</span>`;
    else if (st.phase === PHASE.WORK && st.bars.eta != null && st.bars.eta / (st.ts || 1) <= 5) pt.innerHTML = `<span class="collapseWarn">⚠ ${Math.max(1, Math.ceil(st.bars.eta / (st.ts || 1)))}s</span> <span>the Red Bar reaches the milestone — the crypt collapses!</span>`;
    else if (st.spy.active && st.spy.id === you.id) pt.innerHTML = `🕳️ ${Math.ceil(st.spy.t)}s <span>Oubliette Spy window</span>`;
    else pt.innerHTML = '';
    // --- blind / fumes overlays
    const inLobby = st.phase === PHASE.LOBBY;
    $('#blind').style.opacity = !inLobby && you.blind ? 0.97 : 0;
    document.body.classList.toggle('drunk', !inLobby && you.fumes > 0);
    $('#ghostTint').style.opacity = !inLobby && you.ghost ? 0.25 : 0;
    // --- forgotten debug overrides that change how long a match lasts
    this.dbgOverrides = st.dbg && inMatch ? matchAffectingOverrides({ ...st.dbg, timeScale: st.dbg.timeScale }) : [];
    this.dbgGame = game;
    this.mergeLog(st, game);
    if (this.scoreOpen) this.scoreboard(true, st);
    // --- debug panel data
    if (game.debug) game.debug.update(st);
  }

  updateCeremony(st, game) {
    const cp = $('#cerPanel');
    const c = st.cer;
    if (!c) { cp.innerHTML = ''; cp.dataset.h = ''; cp.style.display = 'none'; this.lastCountKey = ''; return; }
    cp.style.display = 'block';
    const you = st.you, name = id => st.players.find(p => p.id === id)?.name ?? '?';
    let html = '';
    if (c.sub === CER.VOTE && c.simple) {
      const P = id => st.players.find(p => p.id === id);
      const mP = P(c.nominatedBy ?? st.masterId), eP = P(st.execId), master = P(st.masterId);
      html += `<div class="cpTitle">${avatar(mP)} nominated ${avatar(eP)} as Executioner — APPROVE or MUTINY?</div>
        <div class="cpNote">⚔️ <b>Strict majority of MUTINY</b>: ${esc(master?.name ?? 'the Master')} & ${esc(eP?.name ?? 'the Executioner')} are overthrown — a random eligible minion becomes Master, picks an Executioner and goes <b>straight to the execution</b> (one vote per milestone).<br>🤝 Tie or majority APPROVE: ${esc(eP?.name ?? 'the Executioner')} executes.</div>`;
      if (c.voter) html += `<div class="voteRow"><button class="vbtn ${c.myVote === 0 ? 'sel' : ''}" data-v="0"><span class="k">1</span> 🤝 APPROVE</button><button class="vbtn mut ${c.myVote === 1 ? 'sel' : ''}" data-v="1"><span class="k">2</span> ⚔️ MUTINY</button></div>`;
      html += `<div class="cpNote">${c.decided ?? 0}/${c.voters ?? 0} decided • 🃏 Role cards can be played NOW with [G]</div>`;
    } else if (c.sub === CER.ELIMINATE) {
      html += `<div class="cpTitle">${esc(name(st.masterId))} chooses which captive falls into the abyss</div>`;
      html += st.masterId === you.id ? '<div class="cpNote big">Aim at a captive to read its glyph • walk to its lever and press <b>E</b> to open the trapdoor</div>' : '<div class="cpNote">Only the Master can read the glyphs. You are frozen until a lever is pulled.</div>';
    } else if (c.sub === CER.VOTE) {
      const P = id => st.players.find(p => p.id === id);
      const mP = P(c.nominatedBy ?? st.masterId), eP = P(st.execId), master = P(st.masterId);
      html += `<div class="cpTitle">${avatar(mP)} nominated ${avatar(eP)} as Executioner. Do you agree?</div>
        <div class="cpNote">⚔️ <b>If the mutiny succeeds</b> (${c.threshold}+ 💎): ${esc(master?.name ?? 'the Master')} is overthrown, the top mutineer takes the staff and nominates anew, and every crystal spent is consumed.<br>🛡️ <b>If it fails</b>: all crystals return to their owners and ${esc(eP?.name ?? 'the Executioner')} carries out the execution.</div>`;
      if (c.voter) {
        const sealed = c.sealed.includes(you.id), prov = c.provoked.includes(you.id);
        const opts = [[0, 'Yes'], [1, 'Disagree — 1 💎'], [2, 'Strongly Disagree — 2 💎'], [3, 'Absolutely Disagree — 3 💎']];
        html += `<div class="voteRow">${opts.map(([v, l], i) => `<button class="vbtn ${c.myVote === v ? 'sel' : ''}" data-v="${v}" ${(v > 0 && (sealed || (v > you.crystals && !you.infiniteMana) || (c.anarchy && v > 1))) ? 'disabled' : ''}><span class="k">${i + 1}</span> ${l}</button>`).join('')}</div>`;
        if (sealed) html += '<div class="cpNote">🤫 You are sealed by the Silence Enchanter.</div>';
        if (prov) html += '<div class="cpNote">📢 You are provoked: you will play at least 1 crystal.</div>';
        if (c.anarchy) html += '<div class="cpNote">🏴 Anarchy: max 1 crystal each, 1 is enough.</div>';
        html += `<div class="cpNote">Threshold to overthrow: <b>${c.threshold}</b> 💎 • the vote closes as soon as everyone has decided.</div>`;
      } else html += `<div class="cpNote">The crew is voting… (${c.voted.length} decided)</div>`;
    } else if (c.sub === CER.COUNT || c.sub === CER.REACTION || (c.result && c.sub === CER.EXECUTION && performance.now() - (this.resT || 0) < 3500)) {
      const key = c.reveal.map(r => r.id).join(',');
      if (key !== this.lastCountKey) { this.lastCountKey = key; this.countStart = performance.now(); this.resT = performance.now(); }
      const elapsed = (performance.now() - this.countStart) / 1000;
      const shown = c.sub === CER.COUNT ? Math.min(c.reveal.length, Math.floor(elapsed / 0.4) + 1) : c.reveal.length;
      let run = 0;
      const rows = c.reveal.slice(0, shown).map(r => { const v = r.pacified ? 0 : r.amount * (r.doubled ? 2 : 1); run += v; return `<div class="cnt ${r.amount ? 'reb' : ''}">${esc(r.name)}: <b>${r.amount}</b> 💎 ${r.doubled ? '×2 📯' : ''}${r.pacified ? ' 🕊️ pacified' : ''}</div>`; }).join('');
      const th = c.threshold, mx = Math.max(th * 1.5, run, 1);
      html += `<div class="cpTitle">${c.sub === CER.REACTION ? 'REACTION TIME — abilities [G]' : 'Counting the Mana Crystals…'}</div>
        <div class="mbar"><div class="mfill ${run >= th ? 'ok' : ''}" style="width:${run / mx * 100}%"></div><div class="mth" style="left:${th / mx * 100}%"><span>${th} needed${c.tribune ? ' (⚖️ halved)' : ''}${c.anarchy ? ' (🏴)' : ''}</span></div></div>
        <div class="cntGrid">${rows}</div><div class="cpNote">Total: <b>${run}</b> / ${th}</div>`;
    } else if (c.sub === CER.NOMINATE) {
      html += `<div class="cpTitle">${esc(name(st.masterId))} — choose an executioner</div>`;
      if (st.masterId === you.id) html += '<div class="cpNote">Aim at a minion and press <b>LMB</b>. Not eligible: 💤 exhausted, 🤐 muted, 👻 ghosts.</div>';
    } else if (c.sub === CER.EXECUTION) {
      html += `<div class="cpTitle">${esc(name(st.execId))} feeds a captive to the portal</div>`;
      if (st.execId === you.id) html += '<div class="cpNote">Aim at a captive on the altar to read its glyph. <b>LMB</b> to lift, walk to the portal, <b>LMB</b> to throw.</div>';
    } else if (c.sub === CER.EVENT) {
      const ev = MILESTONE_EVENTS[c.mode];
      if (ev) html += `<div class="cpTitle">${ev.icon} ${ev.name}</div><div class="cpNote">${esc(ev.desc)}</div>`;
      if (c.mode === 'MUTENESS') html += '<div class="cpNote">Cursed player cannot be nominated for Master of Ceremonies/Executioner during the next sacrifice.</div>';
      if (st.masterId === you.id && ['INSPECTION', 'MUTENESS', 'FLOGGING'].includes(c.mode)) html += `<div class="cpNote big">${c.mode === 'FLOGGING' ? '⛓️ Whip in hand: strike a player (LMB)' : c.mode === 'INSPECTION' ? 'Strike a player to reveal their cult (LMB)' : 'Slap a player to curse them (LMB)'}</div>`;
    } else if (c.sub === CER.CURSE) {
      const m = { eye: c.simple ? '👁️ Insight Eye — the Master learns one minion\'s cult' : '👁️ Eye of Truth — the Executioner peeks at one minion', abyss: '🗝️ Call of the Abyss — the Master hands out the Prison key', initiation: '🔮 Dark Initiation', banner: '' }[c.mode];
      if (m) html += `<div class="cpTitle">${m}</div>`;
      if ((c.mode === 'eye' && (c.eyeHolder ?? st.execId) === you.id) || (c.mode === 'abyss' && st.masterId === you.id) || (c.mode === 'initiation' && you.leader)) html += '<div class="cpNote big">Walk up to a minion and strike them (LMB)</div>';
    } else if (c.sub === CER.DEBATE) {
      html += `<div class="cpTitle">DEBATE — New Hazard in ${c.infinite ? '∞' : Math.ceil(c.t) + 's'}</div><div class="cpNote">Global voice (open mic) & chat [Enter] in the Sanctuary.${c.lastSacrifice ? ` Sacrificed: ${FACTION_INFO[c.lastSacrifice.faction].icon} ${FACTION_INFO[c.lastSacrifice.faction].short} • ${CURSES[c.lastSacrifice.curse].name}` : ''}</div>${c.lastSacrifice?.resolution ? `<div class="cpNote resLine">↳ ${esc(c.lastSacrifice.resolution)}</div>` : ''}`;
    } else if (c.sub === CER.RESULT && c.summary) {
      const s = c.summary;
      html += `<div class="sumCard">${s.glyph ? `<div class="sumGlyph">${glyphSVG(s.glyph.faction, s.glyph.curse, 64)}</div>` : ''}<div class="sumIcon">${s.icon || ''}</div>
        <div class="sumTitle" style="color:${s.color || '#fff'}">${esc(s.title)}</div>${(s.lines || []).map(l => `<div class="sumLine">${esc(l)}</div>`).join('')}
        <div class="sumTimer">Continuing in ${Math.ceil(c.t)}s…</div></div>`;
    } else if (c.sub === CER.ANNOUNCE) html += '<div class="cpTitle">Well Done — Execution in 3 sec</div>';
    if (cp.dataset.h === html) return;
    cp.dataset.h = html; cp.innerHTML = html;
    cp.querySelectorAll('.vbtn').forEach(b => b.onclick = () => game.vote(+b.dataset.v));
  }

  // ------------------------------------------------------------------ per-frame overlays
  setPrompt(text) { const p = $('#prompt'); if (p.dataset.t !== text) { p.dataset.t = text; p.innerHTML = text; } }
  /**
   * Hold-to-interact meter (radial dial + horizontal bar under the reticle).
   * h = { frac 0..1, label, left (s), continuous, coopFrac } or null.
   */
  setHold(h) {
    const box = $('#holdBox');
    if (this.holdFx && performance.now() < this.holdFx.until) return;      // keep done/cancel flash visible
    if (this.holdFx) { box.classList.remove('done', 'cancel'); this.holdFx = null; }
    if (!h) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.classList.toggle('continuous', !!h.continuous);
    const f = Math.max(0, Math.min(1, h.continuous ? (h.coopFrac ?? 0) : h.frac));
    if (!h.continuous) $('#holdRing').style.background = `conic-gradient(#ffd75e ${f * 360}deg, rgba(255,255,255,0.15) 0)`;
    $('#holdFill').style.width = (f * 100).toFixed(1) + '%';
    const txt = h.continuous ? `${h.label}${h.coopFrac != null ? ` — ${Math.round(f * 100)}%` : ''}` : `${h.label} — ${Math.max(0, h.left).toFixed(1)}s`;
    $('#holdLabel').textContent = txt;
  }
  /** Completion / cancel flash for the hold meter. */
  holdFeedback(kind, label) {
    const box = $('#holdBox');
    box.style.display = 'block';
    box.classList.remove('done', 'cancel', 'continuous'); void box.offsetWidth;
    box.classList.add(kind);
    $('#holdLabel').textContent = label || (kind === 'done' ? '✔ Done!' : '✖ Cancelled');
    if (kind === 'cancel') $('#holdFill').style.width = '0%';
    this.holdFx = { until: performance.now() + (kind === 'done' ? 700 : 600) };
  }
  setTooltip(html) { const t = $('#tooltip'); if (!html) { t.style.display = 'none'; return; } t.style.display = ''; if (t.dataset.h !== html) { t.dataset.h = html; t.innerHTML = html; } }

  npcTooltip(n, simple = false) {
    if (n.faction) {
      const f = FACTION_INFO[n.faction], c = CURSES[n.curse];
      return `<div class="glyph">${glyphSVG(n.faction, n.curse)}</div><div><div style="color:${f.glyph};font-weight:bold">${f.name}</div><div class="cur">${c.name}</div><div class="cdesc">${esc(curseDesc(n.curse, simple))}</div></div>`;
    }
    return `<div class="glyph unknown">?</div><div><div style="font-weight:bold">[Unknown Captive]</div><div class="cdesc">Its runic glyph is hidden under the sack.</div></div>`;
  }

  /** Nameplate fog-of-war rendering. */
  updatePlates(list) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let el = this.plates.get(it.id);
      if (!el) { el = h('div', 'plate'); this.platesEl.appendChild(el); this.plates.set(it.id, el); }
      if (!it.visible) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(-50%,-100%) translate(${it.x}px,${it.y}px) scale(${it.scale})`;
      if (el.dataset.h !== it.html) { el.dataset.h = it.html; el.innerHTML = it.html; }
    }
    for (const [id, el] of this.plates) if (!seen.has(id)) { el.remove(); this.plates.delete(id); }
  }

  /**
   * Nameplate with distance LOD.
   *  far  (> 3 m or not looked at): role icon floating above the name (+ office/status icons)
   *  near (< 3 m AND crosshair on the minion): detailed card — role name, description,
   *        card status, faction (only if revealed to YOU per the social-deduction rules)
   */
  plateHtml(p, st, extraLabel, bubble, detail = false) {
    const you = st.you;
    if (detail) return this.plateDetail(p, st, extraLabel, bubble);
    const top = [];
    if (p.role) { const r = ROLE_BY_ID[p.role]; if (r && (p.id !== you.id)) top.push(`<span class="pRole" title="${esc(r.name)}">${r.icon}</span>`); }
    if (p.master) top.push(STATUS_ICONS.master); if (p.exec) top.push(STATUS_ICONS.exec);
    if (p.exhausted) top.push(STATUS_ICONS.exhausted); if (p.muted) top.push(STATUS_ICONS.muted); if (p.gagged) top.push(STATUS_ICONS.gagged);
    if (p.fumes) top.push(STATUS_ICONS.fumes); if (p.ghost) top.push(STATUS_ICONS.ghost); if (p.key) top.push(STATUS_ICONS.key); if (p.ward) top.push(`<span title="Chaos Ward — immune to Chaos">${STATUS_ICONS.ward}</span>`);
    if (p.talking) top.unshift('<span class="pTalk" title="speaking">🔊</span>');
    let pre = '';
    if (p.faction && p.id !== you.id) pre = FACTION_INFO[p.faction].icon + (p.leader ? '👑' : '') + ' ';        // God Mode
    else if (p.pact === 'blood') pre = '🩸 ';                                                                    // Blood Pact
    else if (p.known) pre = FACTION_INFO[p.known].icon + ' ';                                                   // inspection / eye / chaos pair
    const not = p.publicNot ? `<div class="pNot">not ${FACTION_INFO[p.publicNot].icon}</div>` : '';
    return `${bubble ? `<div class="bubble">${esc(bubble)}</div>` : ''}${extraLabel ? `<div class="pLabel" style="color:${extraLabel.color}">${esc(extraLabel.text)}</div>` : ''}
      <div class="pTop">${top.join(' ')}</div><div class="pName">${pre}${esc(p.name)}${st.simple ? '' : ` <span class="pCry">💎${p.crystals}</span>`}</div>${not}`;
  }

  factionLine(p, st) {
    if (p.faction && p.id !== st.you.id) return `${FACTION_INFO[p.faction].icon} ${FACTION_INFO[p.faction].name}${p.leader ? ' (Chaos Leader)' : ''} <small>— God Mode</small>`;
    if (p.pact === 'blood') return '🩸 Cult of Blood <small>— your Blood Pact ally</small>';
    if (p.known) return `${FACTION_INFO[p.known].icon} ${FACTION_INFO[p.known].name} <small>— revealed to you</small>`;
    if (p.publicNot) return `Faction unknown — publicly <b>NOT</b> ${FACTION_INFO[p.publicNot].icon} ${FACTION_INFO[p.publicNot].name}`;
    return 'Faction: <i>unknown</i>';
  }

  plateDetail(p, st, extraLabel, bubble) {
    const r = p.role ? ROLE_BY_ID[p.role] : null;
    const stat = [];
    if (p.master) stat.push('👑 Master of Ceremonies'); if (p.exec) stat.push('🪓 Executioner');
    if (p.exhausted) stat.push('💤 Exhausted (cannot be nominated)'); if (p.muted) stat.push('🤐 Cursed with muteness');
    if (p.gagged) stat.push('🔇 Gagged'); if (p.fumes) stat.push('🤢 Intoxicated'); if (p.ghost) stat.push('👻 Ghost');
    if (p.ward) stat.push('🛡️ Chaos Ward — immune to Chaos (cannot be initiated)');
    if (p.key) stat.push('🗝️ Holds the Prison key'); if (p.ridingOn) stat.push('🧗 Riding a minion'); if (p.rider) stat.push('🏋️ Carrying a rider');
    const held = p.tool ? TOOLS[p.tool]?.name : p.item ? ITEM_TYPES[p.item]?.name : p.npc ? 'a bound captive' : null;
    const cardState = p.roleUsed === undefined ? '(hidden from others)' : p.roleUsed ? 'card used — face up' : 'card re-armed — face down';
    return `${bubble ? `<div class="bubble">${esc(bubble)}</div>` : ''}${extraLabel ? `<div class="pLabel" style="color:${extraLabel.color}">${esc(extraLabel.text)}</div>` : ''}
      ${p.talking ? '<div class="pTop"><span class="pTalk" title="speaking">🔊</span></div>' : ''}<div class="pCard"><div class="pcName"><span style="color:${p.color}">●</span> ${esc(p.name)}${st.simple ? '' : ` <span class="pCry">💎${p.crystals}</span>`}</div>
      <div class="pcRole">${r ? `${r.icon} <b>${esc(r.name)}</b> <small>(${cardState})</small><div class="pDesc">${esc(roleCard(r.id, { threshold: st.balance.threshold }).text)}</div>` : '🂠 Role: hidden — card not revealed yet'}</div>
      <div class="pcFac">${this.factionLine(p, st)}</div>
      ${stat.length || held ? `<div class="pcStat">${stat.join(' • ')}${held ? `${stat.length ? ' • ' : ''}✋ ${esc(held)}` : ''}</div>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ modals
  modal(html, { onClose, wide } = {}) {
    if (document.pointerLockElement) document.exitPointerLock();
    const m = $('#modal'); m.classList.remove('hidden'); m.innerHTML = `<div class="mbox ${wide ? 'wide' : ''}">${html}<button class="mclose">✕</button></div>`;
    this.modalOpen = true;
    const close = () => { m.classList.add('hidden'); m.innerHTML = ''; this.modalOpen = false; onClose && onClose(); };
    $('.mclose', m).onclick = close;
    this.closeModal = close;
    return m;
  }

  palette(current, onPick) {
    const m = this.modal(`<h3>🪞 The Mirror of Vanity</h3><p>Choose the colour of your robe (synced live for everyone).</p><div class="pal">${ROBE_COLORS.map(c => `<div class="sw ${c === current ? 'sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div><input type="color" id="pcCustom" value="${current}"> custom`);
    m.querySelectorAll('.sw').forEach(s => s.onclick = () => { onPick(s.dataset.c); m.querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x === s)); });
    $('#pcCustom').oninput = e => onPick(e.target.value);
  }

  abilityTargets(role, st, onConfirm) {
    const chosen = [];
    const render = () => {
      const step = role.targets[chosen.length];
      if (!step) { this.closeModal(); onConfirm(chosen); return; }
      const others = st.players.filter(p => !p.ghost && (step.filter !== 'voter' || (p.id !== st.masterId && p.id !== st.execId)) && (step.filter !== 'exhausted' || p.exhausted) && (step.filter !== 'not_exhausted' || !p.exhausted) && (step.filter !== 'used_card' || (p.roleUsed && p.id !== st.you.id)) && (step.filter !== 'eligible_exec_new' || (p.id !== st.masterId && p.id !== st.execId && !p.exhausted && !p.muted)));
      const cc = roleCard(role.id, { threshold: st.balance.threshold });
      const m = this.modal(`<h3>${role.icon} ${esc(role.name)}</h3><p>${role.simple ? '' : `<small><b>WHEN TO USE:</b> ${esc(cc.when)}</small><br>`}${esc(cc.text)}</p><h4>${chosen.length + 1}/${role.targets.length}: ${esc(step.label)}</h4>
        <div class="plist">${others.map(p => `<button class="pbtn" data-id="${p.id}" ${chosen.includes(p.id) && step.filter !== 'any' ? 'disabled' : ''}><span style="color:${p.color}">●</span> ${esc(p.name)} ${p.master ? '👑' : ''}${p.exec ? '🪓' : ''}${p.exhausted ? '💤' : ''}${st.simple ? '' : ' 💎' + p.crystals}</button>`).join('')}</div>`);
      m.querySelectorAll('.pbtn').forEach(b => b.onclick = () => { chosen.push(+b.dataset.id); render(); });
    };
    render();
  }

  calib(msg, onSubmit) {
    const amounts = msg.names.map(() => 0);
    const render = () => {
      const m = this.modal(`<h3>⚖️ Balance Scale</h3><p>You don't know the ratio — your partner in the Library must read the recipe scroll and dictate it through the brass intercom pipe.</p>
        ${msg.names.map((n, i) => `<div class="ing"><span>${n}</span><button data-i="${i}" data-d="-1">−</button><b>${amounts[i]}</b><button data-i="${i}" data-d="1">+</button> scoops</div>`).join('')}
        <button id="weigh" class="primary">WEIGH</button>`);
      m.querySelectorAll('.ing button').forEach(b => b.onclick = () => { const i = +b.dataset.i; amounts[i] = Math.max(0, Math.min(5, amounts[i] + +b.dataset.d)); render(); });
      $('#weigh').onclick = () => { onSubmit(amounts); this.closeModal(); };
    };
    render();
  }
  recipeCard(msg) {
    this.modal(`<h3>📜 Recipe Scroll</h3><p>Dictate this through the intercom pipe on the wall (stand next to it and just talk / chat [Enter]):</p>
      <div class="recipe">${msg.names.map((n, i) => `<div>${msg.recipe[i]} scoop${msg.recipe[i] === 1 ? '' : 's'} of <b>${n}</b></div>`).join('')}</div>`);
  }
  runes(msg, onChoose) {
    const m = this.modal(`<h3>📖 Runic Dictionary</h3><p>Find the rune glowing on the bookshelf wall and move the bookmark to it.</p><div class="runeGrid">${msg.options.map(i => `<button class="rune" data-i="${i}">${RUNES[i]}</button>`).join('')}</div>`);
    m.querySelectorAll('.rune').forEach(b => b.onclick = () => { onChoose(+b.dataset.i); this.closeModal(); });
  }
  spyhole(msg) {
    this.modal(`<h3>👁️ Spyhole — Prison of the Rejected</h3>${msg.list.length ? '' : '<p>The cell is empty… or too dark to tell.</p>'}<div class="spyList">${msg.list.map(n => `<div class="spyRow">${glyphSVG(n.faction, n.curse, 40)}<div><b style="color:${FACTION_INFO[n.faction].glyph}">${FACTION_INFO[n.faction].name}</b> • ${CURSES[n.curse].name}<br><small>Rejected at milestone ${n.round} (${n.discard === 'exec' ? 'by the Executioner' : n.discard})</small></div></div>`).join('')}</div>`, { wide: true });
  }
  fanatical(msg, onReply) {
    const m = this.modal(`<h3>🔥 Fanatical Instigator</h3><p>${esc(msg.from)} goads you: throw ALL your ${msg.crystals} Mana Crystals into the rebellion?</p><button id="fyes" class="primary">ALL IN!</button> <button id="fno">Refuse</button>`, { onClose: () => onReply(false) });
    $('#fyes', m).onclick = () => { onReply(true); this.modalOpen = false; m.classList.add('hidden'); };
    $('#fno', m).onclick = () => { onReply(false); this.modalOpen = false; m.classList.add('hidden'); };
  }

  // ------------------------------------------------------------------ finale & scoreboard
  finale(msg, isHost, onLobby) {
    const el = $('#finale'); el.classList.remove('hidden');
    const w = msg.winner === 'nobody' ? { name: 'THE CRYPT EXPLODED', color: '#ff5a1a', icon: '💥' } : FACTION_INFO[msg.winner];
    el.innerHTML = `<div class="fin">
      <div class="finIcon">${w.icon}</div><div class="finTitle" style="color:${w.color}">${msg.winner === 'nobody' ? 'EVERYONE LOSES' : w.name.toUpperCase() + ' WINS'}</div>
      <div class="finReason">${esc(msg.reason)}</div>
      <div class="finTally">🔥 ${msg.tally.fire} &nbsp; 🩸 ${msg.tally.blood} &nbsp; 🔮 ${msg.tally.chaos}</div>
      <table class="finTable"><tr><th>Minion</th><th>Cult</th><th>Role</th><th>💰</th></tr>
      ${msg.reveal.map(p => `<tr><td><span style="color:${p.color}">●</span> ${esc(p.name)}${p.ghost ? ' 👻' : ''}</td><td style="color:${FACTION_INFO[p.faction].color}">${FACTION_INFO[p.faction].icon} ${FACTION_INFO[p.faction].short}${p.leader ? ' (Leader)' : ''}</td><td>${ROLE_BY_ID[p.roleId].icon} ${esc(ROLE_BY_ID[p.roleId].name)}</td><td>${p.gold}</td></tr>`).join('')}</table>
      <div class="finLog">${msg.log.map(l => `M${l.milestone}: ${FACTION_INFO[l.faction].icon} ${CURSES[l.curse].name} (Exec ${esc(l.exec)})`).join(' • ')}</div>
      ${isHost ? '<button id="toLobby" class="primary">Return to lobby</button>' : '<div class="small">Waiting for the host…</div>'}</div>`;
    const b = $('#toLobby'); if (b) b.onclick = onLobby;
  }
  hideFinale() { $('#finale').classList.add('hidden'); }

  /** Small microphone status chip (bottom centre-left): open / speaking / muted / silenced by a curse. */
  updateMic(audio, st) {
    const el = $('#micChip'); if (!el) return;
    const inLobby = st.phase === PHASE.LOBBY;
    let txt, cls;
    if (!audio.mic) { txt = '🎤 mic off'; cls = 'off'; }
    else if (audio.silenced) { txt = st.you.gagged ? '🔇 gagged — silenced' : '🤐 cursed — silenced'; cls = 'bad'; }
    else if (audio.muted) { txt = '🔇 muted (V)'; cls = 'off'; }
    else if (audio.mode === 'ptt') { txt = audio.ptt ? '🎙 transmitting' : '🎙 push-to-talk (hold V)'; cls = audio.ptt ? 'live' : 'idle'; }
    else { txt = audio.speaking ? '🔊 speaking' : '🎤 open mic'; cls = audio.speaking ? 'live' : 'idle'; }
    const key = txt + cls + inLobby;
    if (el.dataset.k !== key) { el.dataset.k = key; el.textContent = txt; el.className = cls; }
  }

  // ------------------------------------------------------------------ game log (merged from incremental state updates)
  mergeLog(st, game) {
    this.logs ||= []; this.logLast ||= 0;
    if (this.logPhase === PHASE.LOBBY && st.phase !== PHASE.LOBBY) this.logs = [];     // a new match starts with an empty log
    this.logPhase = st.phase;
    if (st.logN < this.logLast) { this.logs = []; this.logLast = 0; }
    const inc = st.log || [];
    if (inc.length && inc[0].n > this.logLast + 1 && this.logLast < st.logN && !this.logPending) {   // we missed some lines → ask for the whole log
      this.logPending = true; game?.net?.send({ t: 'logreq' });
    }
    for (const e of inc) if (e.n > this.logLast) { this.logs.push(e); this.logLast = e.n; }
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
  }
  setFullLog(entries) {
    this.logs = entries.slice(-400); this.logLast = Math.max(this.logLast || 0, entries.length ? entries[entries.length - 1].n : 0); this.logPending = false;
    if (this.scoreOpen) this.scoreboard(true, this.dbgGame?.st);
  }

  /** TAB overlay: two windows side by side — players & roles (left), scrollable game log (right). */
  scoreboard(show, st) {
    const el = $('#score');
    if (!show || !st) { this.scoreOpen = false; el.classList.add('hidden'); return; }
    const wasHidden = el.classList.contains('hidden');
    this.scoreOpen = true; el.classList.remove('hidden');
    const meP = st.players.find(p => p.id === st.you.id);
    const facTxt = p => {
      if (p.faction) return `<span style="color:${FACTION_INFO[p.faction].color}">${FACTION_INFO[p.faction].icon} ${FACTION_INFO[p.faction].short}</span>`;
      if (p.known) return `<span style="color:${FACTION_INFO[p.known]?.color || '#ccc'}" title="you know this">${FACTION_INFO[p.known]?.icon || ''} ${FACTION_INFO[p.known]?.short || ''}</span>`;
      if (p.pact) return '<span title="Blood pact">🩸 Blood</span>';
      return p.publicNot ? `<span class="small">not ${FACTION_INFO[p.publicNot].icon}</span>` : '<span class="small">?</span>';
    };
    const players = `<h3>MINIONS</h3><table><tr class="small"><th></th><th>Status</th>${st.simple ? '' : '<th>💎</th>'}<th>Role</th><th>Cult</th></tr>${st.players.map(p => `<tr${p.id === st.you.id ? ' style="background:rgba(255,215,94,.08)"' : ''}><td><span style="color:${p.color}">●</span> ${esc(p.name)} ${p.bot ? '🤖' : ''}</td><td>${p.master ? '👑' : ''}${p.exec ? '🪓' : ''}${p.exhausted ? '💤' : ''}${p.muted ? '🤐' : ''}${p.ghost ? '👻' : ''}${p.key ? '🗝️' : ''}${p.ward ? '🛡️' : ''}</td>${st.simple ? '' : `<td>${p.crystals}</td>`}<td>${p.role ? ROLE_BY_ID[p.role].icon + ' ' + esc(ROLE_BY_ID[p.role].name) + (p.roleUsed ? ' <span class="small">(used)</span>' : '') : '🂠'}</td><td>${facTxt(p)}</td></tr>`).join('')}</table>
      <div class="scSub">${st.simple ? '<b>SIMPLIFIED MODE</b> • ' : ''}Altar: 🔥${st.tally.fire} 🩸${st.tally.blood} 🔮${st.tally.chaos}${st.simple ? ' • Mutiny: strict majority' : ` • Rebellion threshold ${st.balance.threshold} 💎`} • ${st.milestones} milestones${meP ? '' : ''}</div>`;
    if ($('#scPlayers').dataset.h !== players) { $('#scPlayers').dataset.h = players; $('#scPlayers').innerHTML = players; }
    // debug-override indicator lives here (above the log), not on the HUD
    const dbg = $('#scDbg'), ov = this.dbgOverrides || [];
    if (ov.length) {
      const html = `⚠ Debug override active: ${ov.map(o => esc(o.label)).join(' · ')} <button id="dbgReset">Reset to normal</button>`;
      if (dbg.dataset.h !== html) { dbg.dataset.h = html; dbg.innerHTML = html; $('#dbgReset').onclick = () => this.dbgGame?.debug?.resetOverrides(); }
      dbg.classList.remove('hidden');
    } else { dbg.classList.add('hidden'); dbg.dataset.h = ''; }
    // log: keep the scroll position; stick to the bottom only when the reader is already there
    const box = $('#scLog'), logs = this.logs || [];
    const key = logs.length ? logs[logs.length - 1].n + ':' + logs.length : '0';
    if (wasHidden || box.dataset.k !== key) {
      const atBottom = wasHidden || box.scrollHeight - box.scrollTop - box.clientHeight < 24, prev = box.scrollTop;
      const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      box.dataset.k = key;
      box.innerHTML = `<h3>GAME LOG</h3>` + (logs.length ? logs.map(l => `<div class="lg ${esc(l.kind || 'info')}"><b class="t">${fmt(l.t)}</b>${esc(l.text)}</div>`).join('') : '<div class="small">Nothing has happened yet.</div>');
      box.scrollTop = atBottom ? box.scrollHeight : prev;
    }
  }
}

function cerTitle(st) {
  const c = st.cer;
  return ({ ANNOUNCE: 'Assembling', ELIMINATE: 'Lever — drop one captive', NOMINATE: 'Nomination', VOTE: c.simple ? 'Approve or Mutiny' : 'Loyalty check', COUNT: 'Counting', REACTION: 'Reaction time', EXECUTION: 'Execution', CURSE: 'Curse', EVENT: MILESTONE_EVENTS[c.mode]?.name || 'Milestone event', DEBATE: 'Debate — New Hazard in', RESULT: 'Outcome' })[c.sub] || '';
}
export { ROLES };
