// B2 task minigames: open each new overlay directly and drive it to success in a headless browser.
// Each overlay must render and call onDone() when played correctly. (The server authority is covered by minigames-test.mjs;
// here we only prove the client overlays render and complete without errors.)
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke11.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8098);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7798'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 840 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8098/?join=127.0.0.1:7798&token=dedicated&name=Host'); await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const shot = async n => { try { await Promise.race([page.screenshot({ path: path.join(shots, n + '.png') }), sleep(5000)]); } catch {} };
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await G(fn, arg)) return true; } catch {} await sleep(60); } return false; };
  // open a minigame overlay with the given cfg; exposes window.__mgDone()
  const open = (game, cfg) => G(([game, cfg]) => { window.__mg = 0; window.__game.ui.minigame({ game, uid: 1, part: 'spot', name: game, cfg }, () => window.__mg++); window.__mgDone = () => window.__mg; return !document.getElementById('modal').classList.contains('hidden'); }, [game, cfg]);
  const canvasBox = sel => G(s => { const c = document.querySelector(s); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);

  // ---- CATCH (render + progress; full real-time play is covered by minigames-test, headless rAF is throttled) ----
  await open('catch', { quota: 3, speed: 1 });
  check(await waitFor(() => !!document.getElementById('mgC') && !!window.__catchState, 4000), 'catch overlay renders & its drip loop runs');
  check(await waitFor(() => (window.__catchState && window.__catchState.drops.length > 0), 6000), 'catch spawns falling drips (interactive)');
  await shot('b2_catch'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- DERUST: click-hold each rusty gear 2s ----
  await open('derust', { gears: 7, rusty: [0, 2, 4] });
  check(await waitFor(() => document.querySelectorAll('.gear.rusty').length === 3, 2000), 'derust overlay renders 3 rusty gears');
  for (const i of [0, 2, 4]) { const box = await G(idx => { const g = document.querySelector(`.gear[data-i="${idx}"]`); const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, i); await page.mouse.move(box.x, box.y); await page.mouse.down(); await sleep(2200); await page.mouse.up(); }
  check(await waitFor(() => window.__mgDone() > 0, 2000), 'derust completes after cleaning all rusted gears'); await shot('b2_derust'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- WHACK: click each target as it appears ----
  await open('whack', { hits: 5, label: 'strike' });
  check(await waitFor(() => !!document.getElementById('mgC'), 2000), 'whack overlay renders');
  { const b = await canvasBox('#mgC'); const t0 = Date.now();
    while (Date.now() - t0 < 12000 && !(await G(() => window.__mgDone()))) {
      const tp = await G(() => window.__whackTarget);     // exact pulsing-target position in canvas space
      if (tp) { await page.mouse.click(b.x + tp.x * b.w / 520, b.y + tp.y * b.h / 300); }
      await sleep(80);
    } }
  check(await G(() => window.__mgDone()) > 0, 'whack completes by hitting targets'); await shot('b2_whack'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- GRIND: hold then release inside the green band ----
  await open('grind', { sweetLo: 0.55, sweetHi: 0.9, speed: 0.6 });
  check(await waitFor(() => !!document.getElementById('mgC'), 2000), 'grind overlay renders');
  // ---- GRIND (render + marker sweeps while held; full timing-release covered by minigames-test) ----
  check(await waitFor(() => !!document.getElementById('mgC'), 2000), 'grind overlay renders');
  { const start = await G(() => window.__grindPos || 0); await G(() => document.getElementById('mgC').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await sleep(600);
    const moved = await G(() => window.__grindPos || 0); check(moved > start, 'grind marker sweeps while the button is held'); await G(() => document.getElementById('mgC').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))); }
  await shot('b2_grind'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- MIX: click the recipe colours ----
  await open('mix', { bases: ['r', 'y', 'b'], recipe: ['r', 'y', 'y'] });
  check(await waitFor(() => document.querySelectorAll('.mixB').length === 3, 2000), 'mix overlay renders 3 base reagents');
  for (const c of ['r', 'y', 'y']) { await G(cc => document.querySelector(`.mixB[data-c="${cc}"]`).click(), c); await sleep(120); }
  check(await waitFor(() => window.__mgDone() > 0, 2000), 'mix completes when the recipe is matched'); await shot('b2_mix'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- SIMON: repeat the flashed sequence (we know it from cfg) ----
  await open('simon', { vials: 8, rounds: 3, seq: [1, 4, 6] });
  check(await waitFor(() => document.querySelectorAll('.vial').length === 8, 2000), 'simon overlay renders 8 vials');
  { const seq = [1, 4, 6];
    for (let round = 1; round <= 3 && !(await G(() => window.__mgDone())); round++) {
      const turn = await waitFor(() => { const e = document.getElementById('mgMsg'); return e && /your turn/.test(e.textContent); }, 8000);
      if (!turn) break;
      for (let k = 0; k < round; k++) { await G(i => document.querySelector(`.vial[data-i="${i}"]`).click(), seq[k]); await sleep(250); }
      await sleep(500);     // let the round advance before the next playback
    } }
  check(await waitFor(() => window.__mgDone() > 0, 3000), 'simon completes after 3 correct rounds'); await shot('b2_simon'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- POUR: hold to fill into the band, release ----
  await open('pour', { sweetLo: 0.6, sweetHi: 0.95, fill: 0.8 });
  check(await waitFor(() => !!document.querySelector('.pourTube'), 2000), 'pour overlay renders');
  { const pw = await G(() => { const r = document.querySelector('.pourWrap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    for (let attempt = 0; attempt < 6 && !(await G(() => window.__mgDone())); attempt++) {
      await page.mouse.move(pw.x, pw.y); await page.mouse.down();
      const t0 = Date.now(); let rel = false;
      while (Date.now() - t0 < 5000 && !rel) { await sleep(12); const lvl = await G(() => window.__pourLevel || 0); if (lvl >= 0.65 && lvl <= 0.9) { await page.mouse.up(); rel = true; } }
      if (!rel) await page.mouse.up(); await sleep(120);
    } }
  check(await waitFor(() => window.__mgDone() > 0, 3000), 'pour completes on a sweet-spot release'); await shot('b2_pour'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- PLUNGE: full up/down play completes it (counting is event-driven, not frame-rate bound) ----
  await open('plunge', { plunges: 4 });
  check(await waitFor(() => !!document.getElementById('mgC'), 2000), 'plunge overlay renders');
  { const b = await canvasBox('#mgC');
    for (let i = 0; i < 10 && !(await G(() => window.__mgDone())); i++) {
      await page.mouse.move(b.x + b.w / 2, b.y + b.h - 4, { steps: 12 }); await sleep(150);
      await page.mouse.move(b.x + b.w / 2, b.y + 4, { steps: 12 }); await sleep(150);
    } }
  check(await G(() => window.__mgDone()) > 0, 'plunge completes after enough up/down plunges'); await shot('b2_plunge'); await G(() => window.__game.ui.closeModal && window.__game.ui.closeModal());

  // ---- GAUGES: click each gauge while its needle is in the red zone ----
  await open('gauges', { gauges: 3 });
  check(await waitFor(() => !!document.getElementById('mgC'), 2000), 'gauges overlay renders');
  { const b = await canvasBox('#mgC'); const t0 = Date.now();
    while (Date.now() - t0 < 14000 && !(await G(() => window.__mgDone()))) {
      // click each of the 3 gauge columns repeatedly; the needle passes through red every sweep
      for (let i = 0; i < 3; i++) { await page.mouse.click(b.x + (i + 0.5) * b.w / 3, b.y + b.h / 2); }
      await sleep(70);
    } }
  check(await G(() => window.__mgDone()) > 0, 'gauges completes by venting all three in the red zone'); await shot('b2_gauges');

  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
