// UI smoke test for the hold meter, nameplate LOD, outcome cards and top bar.
// Requires Playwright + Chromium:  PLAYWRIGHT_MODULE=<path to playwright> CHROME_PATH=<chrome> node tools/ui-smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8097);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7797'], { stdio: process.env.CRYPT_TRACE ? 'inherit' : 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8097/?join=127.0.0.1:7797&token=dedicated&name=Host');
  await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  await D('spawn_bots', { n: 5 }); await D('bot_mode', { mode: 'idle' }); await D('freeze_red', { on: true });
  await D('set_timers', { timers: { revealBack: 1, revealFront: 1 }, holdMul: 4 });
  await sleep(500); await G(() => window.__game.net.send({ t: 'start' }));
  await sleep(4500);
  await D('god_mode', { on: true });
  await D('spawn_task', { key: 'soot' });
  const walkTo = async (x, z, tol = 0.6) => {
    for (let i = 0; i < 300; i++) {
      const d = await G(([x, z]) => { const g = window.__game, b = g.body, dx = x - b.x, dz = z - b.z; g.yaw = Math.atan2(-dx, -dz); g.keys.add('KeyW'); return Math.hypot(dx, dz); }, [x, z]);
      if (d < tol) break; await sleep(40);
    }
    await G(() => window.__game.keys.clear());
  };
  const aim = async (x, y, z) => { await sleep(300); await G(([x, y, z]) => { const g = window.__game, c = { x: g.body.x, y: g.body.y + 0.85, z: g.body.z }; const dx = x - c.x, dy = y - c.y, dz = z - c.z; g.yaw = Math.atan2(-dx, -dz); g.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, [x, y, z]); await sleep(900); };
  // --- nameplate LOD: near a bot
  const bot = await G(() => { const g = window.__game; const id = [...g.players.keys()][0]; const s = g.interp(id); return { id, x: s.x, z: s.z }; });
  await D('teleport', { x: bot.x + 2.0, z: bot.z }); await sleep(600); await aim(bot.x, 0.9, bot.z); await sleep(700); await shot('ui_01_plate_detail');
  await D('teleport', { x: bot.x + 6, z: bot.z }); await sleep(600); await aim(bot.x, 0.9, bot.z); await sleep(700); await shot('ui_02_plate_far');
  // --- hold meter: broom + soot
  await D('teleport', { x: 5.0, z: -7.2 }); await sleep(600); await aim(5.6, 0.4, -8.4); await sleep(500);
  console.log('broom-dbg', await G(() => { const g = window.__game; const c = g.camera.position; const t = g.st.world.tools.find(t => t.id === 'broom1'); return { cam: [c.x.toFixed(2), c.y.toFixed(2), c.z.toFixed(2)], body: [g.body.x.toFixed(2), g.body.z.toFixed(2)], tool: t, target: g.target?.id, phase: g.st.phase, frozen: g.st.you.frozen }; }));
  console.log('pressE ->', await G(() => { const g = window.__game; const t = g.target; const orig = g.net.send.bind(g.net); const sent = []; g.net.send = o => { sent.push(o.t + ':' + (o.target || '')); orig(o); }; try { g.pressE(); g.releaseE(); } catch (e) { sent.push('ERR ' + e.message); } g.net.send = orig; return { t: t?.id, sent }; })); await sleep(400);
  console.log('after pickup', await G(() => ({ tool: window.__game.me?.tool, item: window.__game.me?.item, tools: window.__game.st.world.tools.filter(t => t.heldBy).map(t => t.id + '@' + t.heldBy), me: window.__game.myId })));
  const soot = await G(() => { const t = window.__game.st.tasks.find(t => t.key === 'soot'); return t && t.points[0]; });
  await D('teleport', { x: soot.x + 1.2, z: soot.z + 0.6 }); await sleep(600); await aim(soot.x, soot.y, soot.z); await sleep(500);
  console.log('target', await G(() => window.__game.target?.id), 'soot', soot.id, 'tool', await G(() => window.__game.me?.tool));
  await G(() => { window.__game.keys.add('KeyE'); window.__game.pressE(); }); await sleep(2500); await shot('ui_03_hold_progress');
  await G(() => { window.__game.keys.delete('KeyE'); window.__game.releaseE(); }); await sleep(150); await shot('ui_04_hold_cancel');
  await sleep(800);
  await G(() => window.__game.pressE()); await sleep(9500); await shot('ui_05_hold_done');
  await G(() => window.__game.releaseE());
  // --- ceremony outcome cards + top bar
  await D('fill_milestone'); await sleep(4200); await shot('ui_06_topbar_nominate');
  for (let i = 0; i < 30; i++) { const s = await G(() => window.__game.st.cer?.sub); if (s === 'RESULT') break; await D('skip_step'); await sleep(600); }
  await sleep(500); await shot('ui_07_outcome_card');
  for (let i = 0; i < 30; i++) { const s = await G(() => window.__game.st.cer && window.__game.st.cer.summary?.kind); if (s === 'sacrifice') break; await D('skip_step'); await sleep(500); }
  await sleep(400); await shot('ui_08_sacrifice_card');
  await G(() => { window.__game.debug.toggle(); }); await sleep(600); await page.evaluate(() => document.querySelector('#debug').scrollTop = 99999); await sleep(300); await shot('ui_09_debug_timers');
  console.log('ERRORS', errors);
  await browser.close(); srv.kill(); web.close(); process.exit(0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
