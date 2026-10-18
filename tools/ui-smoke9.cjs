// Task minigames B1: the scrub overlay (open on E at a scrub task, wipe to clear, reports done) + the curse-odds debug panel.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke9.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8095);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7795'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8095/?join=127.0.0.1:7795&token=dedicated&name=Host'); await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const shot = async n => { try { await Promise.race([page.screenshot({ path: path.join(shots, n + '.png') }), sleep(5000)]); console.log('shot', n); } catch { console.log('shot', n, '(skipped)'); } };
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await G(fn, arg)) return true; } catch {} await sleep(150); } return false; };

  await D('spawn_bots', { n: 4 }); await D('bot_mode', { mode: 'idle' }); await D('set_timers', { timers: { revealBack: 1, revealFront: 1 } });
  await sleep(500); await G(() => window.__game.net.send({ t: 'start' }));
  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 20000), 'work phase');
  await D('freeze_red', { on: true }); await sleep(1200);

  // ---- scrub overlay (driven directly so we don't depend on which task got assigned) ----
  const opened = await G(() => { let done = 0; window.__game.ui.minigame({ game: 'scrub', uid: 1, part: 'spot', name: 'Clean Soot from Runes', cfg: { threshold: 0.9, dirty: 'soot' } }, () => done++); window.__scrubDone = () => done; return !document.getElementById('modal').classList.contains('hidden') && !!document.getElementById('scrubC'); });
  check(opened, 'scrub overlay opens with a canvas');
  await sleep(300); await shot('m_01_scrub_dirty');
  // simulate wiping: drag the mouse all over the canvas
  const box = await G(() => { const r = document.getElementById('scrubC').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  for (let row = 0; row < 10; row++) { const y = box.y + 10 + row * (box.h - 20) / 9; await page.mouse.move(box.x + 8, y, { steps: 2 }); await page.mouse.move(box.x + box.w - 8, y, { steps: 10 }); await sleep(40); }
  await page.mouse.up();
  await shot('m_02_scrub_wiping');
  const cleared = await waitFor(() => (window.__scrubDone ? window.__scrubDone() : 0) > 0, 5000);
  check(cleared, 'wiping ~90% of the grime reports the scrub as done');
  check(await waitFor(() => document.getElementById('modal').classList.contains('hidden'), 2000), 'overlay closes on success');

  // ---- curse odds debug panel ----
  await G(() => window.__game.debug.toggle()); await sleep(400);
  const panel = await G(() => {
    const det = [...document.querySelectorAll('#debug details summary')].find(s => /Curse spawn odds/.test(s.textContent));
    if (det) det.click();
    return { has: !!det, sliders: document.querySelectorAll('#debug input[id^="dCW_"]').length };
  });
  check(panel.has && panel.sliders >= 5, `debug has a "Curse spawn odds" panel with a slider per glyph (${panel.sliders})`);
  await shot('m_03_curse_odds');
  // set GAGGING_SEAL to 0, TOXIC_FUMES to max, apply
  const applied = await G(() => {
    const set = (k, v) => { const sl = document.getElementById('dCW_' + k); if (sl) { sl.value = v; sl.dispatchEvent(new Event('input')); } };
    set('GAGGING_SEAL', 0); set('TOXIC_FUMES', 20);
    const btn = [...document.querySelectorAll('#debug button[data-c="curseodds"]')][0]; btn && btn.click();
    return true;
  });
  await sleep(400);
  const dbg = await G(() => window.__game.st.dbg && window.__game.st.dbg.curseWeights);
  check(dbg && dbg.GAGGING_SEAL === 0 && dbg.TOXIC_FUMES === 20, 'applying the odds sends weights to the host (gag 0, fumes 20)');
  // uniform resets
  await G(() => { const b = [...document.querySelectorAll('#debug button')].find(x => x.dataset.c === 'curseuniform'); b && b.click(); });
  check(await waitFor(() => !window.__game.st.dbg.curseWeights, 2000), '"Uniform" clears the override');

  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
