// Simplified Mode end screen: a Simplified match must show the Victory/Summary screen (previously it crashed on players
// with no role card, so #finale never appeared). Drives an all-bot Simplified match to completion in the browser.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke10.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8097);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7797'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8097/?join=127.0.0.1:7797&token=dedicated&name=Host'); await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await G(fn, arg)) return true; } catch {} await sleep(200); } return false; };

  // Simplified, all bots, fast milestones so the match ends quickly.
  await D('spawn_bots', { n: 6 }); await D('bot_mode', { mode: 'human' }); await D('simplified', { on: true });
  await D('set_timers', { timers: { revealBack: 0.5, revealFront: 0.5, phaseTransitionBufferSeconds: 0.3 } });
  await sleep(500); await G(() => window.__game.net.send({ t: 'start' }));
  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 20000), 'Simplified match started');
  await D('timescale', { s: 8 });                               // speed the whole match up
  // nudge each work phase toward its milestone so the game progresses to the finale
  const ended = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const phase = await G(() => window.__game.st.phase).catch(() => null);
      if (phase === 'STATE_FINALE') return true;
      if (phase === 'STATE_GAMEPLAY_WORK') await D('fill_milestone');
      await sleep(600);
    }
    return false;
  })();
  check(ended, 'the Simplified match reached the finale');
  // The whole point: the Victory/Summary overlay is actually visible and populated.
  const visible = await waitFor(() => { const el = document.getElementById('finale'); return el && !el.classList.contains('hidden') && /WINS|EVERYONE LOSES/.test(el.innerText); }, 6000);
  check(visible, 'the Victory/Summary screen is shown (not blank — no null-role crash)');
  const fin = await G(() => { const el = document.getElementById('finale'); return { title: (el.querySelector('.finTitle') || {}).innerText || '', rows: el.querySelectorAll('.finTable tr').length, reason: (el.querySelector('.finReason') || {}).innerText || '' }; });
  console.log('   title:', JSON.stringify(fin.title), '| rows:', fin.rows, '| reason:', JSON.stringify(fin.reason.slice(0, 60)));
  check(/WINS|LOSES/.test(fin.title) && fin.rows >= 7, 'summary shows the winner title and a player recap row per minion');
  check(await G(() => !!document.getElementById('toLobby')), 'the host sees a Return-to-lobby button');
  await page.screenshot({ path: path.join(shots, 'f_01_simplified_finale.png') });
  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
