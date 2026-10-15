// Self-test used by CI on the packaged app:  CRYPT_SMOKE=1 <app executable>
// Proves, inside the real packaged build, that: the window loads the UI, the preload bridge works,
// the embedded host server starts, a client can join it and a match can be started.
import { app, systemPreferences } from 'electron';

export function runSmoke(win) {
  const out = { platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome };
  const finish = (ok, extra = {}) => {
    console.log('SMOKE_RESULT ' + JSON.stringify({ ok, ...out, ...extra }));
    setTimeout(() => app.exit(ok ? 0 : 1), 100);
  };
  const timer = setTimeout(() => finish(false, { error: 'timeout (60 s)' }), 60000);
  win.webContents.on('did-fail-load', (_e, code, desc) => finish(false, { error: `did-fail-load ${code} ${desc}` }));
  win.webContents.on('render-process-gone', (_e, d) => finish(false, { error: 'renderer gone: ' + d.reason }));
  win.webContents.once('did-finish-load', async () => {
    try {
      try { out.micStatus = systemPreferences.getMediaAccessStatus?.('microphone'); } catch { /* not available on this OS */ }
      const r = await win.webContents.executeJavaScript(`(async () => {
        const res = {};
        res.menu = !!document.getElementById('menu');
        res.bridge = typeof (window.cryptHost && window.cryptHost.start) === 'function';
        try { const c = document.createElement('canvas'); res.webgl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { res.webgl = false; }
        if (!res.bridge) return res;
        const host = await window.cryptHost.start({ port: 7791 });
        res.host = !!host && !host.error ? 'listening:' + host.port : 'error:' + (host && host.error);
        if (!host || host.error) return res;
        const ws = new WebSocket('ws://127.0.0.1:' + host.port);
        const seen = [];
        const msgs = new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('no reveal; saw ' + seen.join(','))), 25000);
          ws.onmessage = ev => { if (typeof ev.data !== 'string') return; const m = JSON.parse(ev.data); if (!seen.includes(m.t)) seen.push(m.t);
            if (m.t === 'welcome') { ws.send(JSON.stringify({ t: 'debug', cmd: 'spawn_bots', a: { n: 5 } })); setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 400); }
            if (m.t === 'reveal') { clearTimeout(to); resolve(m); } };
          ws.onerror = () => reject(new Error('ws error'));
          ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'SmokeTest', token: host.token }));
        });
        const reveal = await msgs;
        res.joined = true; res.matchStarted = true; res.faction = reveal.faction; res.role = reveal.roleId;
        ws.close();
        return res;
      })()`);
      Object.assign(out, r);
      clearTimeout(timer);
      finish(!!(r.menu && r.bridge && r.host && String(r.host).startsWith('listening') && r.joined && r.matchStarted));
    } catch (e) { clearTimeout(timer); finish(false, { error: String(e && e.message || e) }); }
  });
}
