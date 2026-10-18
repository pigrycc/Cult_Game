// ============================================================================
//  ONLINE PLAY — public room browser + internet play without LAN / VPN / port forwarding.
//
//  • Room list ("registry"): a public ntfy.sh pub/sub topic over HTTPS. A host announces its lobby (name, players,
//    mode, open slots) on every change and every 60 s while the lobby is open; the browser polls the announcements
//    of the last ~2.5 minutes. Nothing is stored long-term, no account needed.
//  • Transport: WebRTC data channels negotiated through the PeerJS cloud signalling server, with Google STUN and the
//    PeerJS TURN relays as fallback for strict NATs. Every packet goes peer-to-peer (or via TURN) to the host.
//  • The HOST's own window bridges each remote peer to its local authoritative server over ws://127.0.0.1 — the
//    game server does not know (or care) whether a player came from the LAN or the internet.
//  All endpoints can be overridden with localStorage 'crypt_online' = {"registry": "...", "topic": "...",
//  "peer": {"host": "...", "port": 443, "path": "/", "secure": true}, "iceServers": [...]} (e.g. a self-hosted ntfy).
// ============================================================================
import { Peer } from 'peerjs';

const PROTO = 'v1';
const DEFAULTS = { registry: 'https://ntfy.sh', topic: `crypt-of-minions-rooms-${PROTO}`, prefix: `crypt-of-minions-${PROTO}-` };
export function onlineConfig() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem('crypt_online') || '{}'); } catch { /* ignore */ }
  return { ...DEFAULTS, ...o };
}
function peerOptions(cfg) {
  const opts = { debug: 0 };
  if (cfg.peer) Object.assign(opts, cfg.peer);
  if (cfg.iceServers) opts.config = { iceServers: cfg.iceServers };
  return opts;
}
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

// ---------------------------------------------------------------- registry (room list)
export async function announce(info, cfg = onlineConfig()) {
  try {
    await fetch(`${cfg.registry}/${cfg.topic}`, { method: 'POST', body: JSON.stringify({ ...info, ts: Date.now() }), keepalive: true });
    return true;
  } catch { return false; }
}
/** Open rooms announced recently (latest announcement per room wins). */
export async function listRooms(cfg = onlineConfig()) {
  const r = await fetch(`${cfg.registry}/${cfg.topic}/json?poll=1&since=150s`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Room list unavailable (HTTP ${r.status})`);
  const latest = new Map();
  for (const line of (await r.text()).split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event !== 'message') continue;
    let info; try { info = JSON.parse(ev.message); } catch { continue; }
    if (!info || !info.code) continue;
    const t = (ev.time || 0) * 1000;
    const prev = latest.get(info.code);
    if (!prev || t >= prev.t) latest.set(info.code, { ...info, t });
  }
  const now = Date.now();
  return [...latest.values()]
    .filter(x => x.open && now - x.t < 150000 && (x.players ?? 0) < (x.max ?? 11))
    .sort((a, b) => b.t - a.t);
}

// ---------------------------------------------------------------- host side
export class OnlineHost {
  constructor({ port, name }) {
    this.port = port; this.name = name; this.cfg = onlineConfig();
    this.code = null; this.peer = null; this.links = new Set(); this.status = 'connecting…'; this.listed = true;
    this.lastInfo = ''; this.lastAnnounce = 0; this.closed = false; this.onChange = null;
  }
  start(tries = 0) {
    this.code = newRoomCode();
    const peer = this.peer = new Peer(this.cfg.prefix + this.code, peerOptions(this.cfg));
    peer.on('open', () => { this.status = 'online'; this.onChange?.(); });
    peer.on('connection', conn => this.bridge(conn));
    peer.on('disconnected', () => { if (!this.closed) { this.status = 'reconnecting…'; this.onChange?.(); try { peer.reconnect(); } catch { /* ignore */ } } });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && tries < 3) { peer.destroy(); return this.start(tries + 1); }   // code clash → new code
      this.status = `online error: ${e.type || e.message}`; this.onChange?.();
    });
    return this;
  }
  /** Pipe one remote player (WebRTC data channel) into the local server (WebSocket). */
  bridge(conn) {
    let ws = null; const q = [];
    const link = { conn, close: () => { try { conn.close(); } catch { /* ignore */ } try { ws?.close(); } catch { /* ignore */ } } };
    this.links.add(link);
    const fromPeer = d => {
      if (ArrayBuffer.isView(d)) d = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
      if (ws && ws.readyState === 1) ws.send(d); else q.push(d);
    };
    conn.on('open', () => {
      ws = new WebSocket(`ws://127.0.0.1:${this.port}`); ws.binaryType = 'arraybuffer';
      ws.onopen = () => { for (const d of q.splice(0)) ws.send(d); };
      ws.onmessage = ev => {
        if (!conn.open) return;
        const dc = conn.dataChannel;
        if (typeof ev.data !== 'string' && dc && dc.bufferedAmount > 256 * 1024) return;   // congested: drop voice, never game state
        try { conn.send(ev.data); } catch { /* channel closing */ }
      };
      ws.onclose = () => { try { conn.close(); } catch { /* ignore */ } this.links.delete(link); };
    });
    conn.on('data', fromPeer);
    conn.on('close', () => { try { ws?.close(); } catch { /* ignore */ } this.links.delete(link); });
    conn.on('error', () => link.close());
  }
  /** Called with live lobby info; announces on change or every 60 s while the lobby is open. */
  update(info) {
    if (this.closed || !this.code || !this.listed) return;
    const full = { code: this.code, name: this.name, ...info };
    const key = JSON.stringify(full), now = Date.now(), changed = key !== this.lastInfo;
    if (!full.open) { if (this.lastOpen === false) return; }                    // announce "closed / in progress" once
    else if (!changed && now - this.lastAnnounce < 60000) return;               // heartbeat every 60 s
    if (changed && full.open && now - this.lastAnnounce < 3000) return;         // coalesce bursts (several players joining)
    this.lastInfo = key; this.lastAnnounce = now; this.lastOpen = full.open;
    announce(full, this.cfg);
  }
  stop() {
    this.closed = true;
    if (this.code && this.listed) announce({ code: this.code, name: this.name, open: false }, this.cfg);
    for (const l of this.links) l.close();
    try { this.peer?.destroy(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- client side: a WebSocket look-alike over WebRTC
export class RoomSocket {
  constructor(code, cfg = onlineConfig()) {
    this.readyState = 0; this.binaryType = 'arraybuffer';
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    const id = `${cfg.prefix}c-${Math.random().toString(36).slice(2, 10)}`;
    const peer = this.peer = new Peer(id, peerOptions(cfg));
    const fail = why => { if (this.readyState === 3) return; const was = this.readyState; this.readyState = 3; this.lastError = why; if (was === 0) this.onerror?.({ message: why }); this.onclose?.({}); try { peer.destroy(); } catch { /* ignore */ } };
    this.timer = setTimeout(() => fail('Could not reach the room (timeout) — the host may have closed it, or a firewall blocks WebRTC.'), 20000);
    peer.on('error', e => fail(e.type === 'peer-unavailable' ? `Room ${code} not found (closed or wrong code).` : `Online error: ${e.type || e.message}`));
    peer.on('open', () => {
      const conn = this.conn = peer.connect(cfg.prefix + normCode(code), { reliable: true, serialization: 'raw' });
      conn.on('open', () => { clearTimeout(this.timer); this.readyState = 1; this.onopen?.({}); });
      conn.on('data', d => {
        if (ArrayBuffer.isView(d)) d = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
        this.onmessage?.({ data: d });
      });
      conn.on('close', () => fail('Connection to the host closed.'));
      conn.on('error', e => fail(`Connection error: ${e?.message || e}`));
    });
  }
  get bufferedAmount() { return this.conn?.dataChannel?.bufferedAmount ?? 0; }
  send(d) { if (this.readyState === 1) this.conn.send(d); }
  close() { this.readyState = 3; try { this.conn?.close(); } catch { /* ignore */ } try { this.peer.destroy(); } catch { /* ignore */ } }
}
