// Visual check for role cards, appointment pillar/banners, vote tooltip, signage, captive glow, debate resolution.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke2.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8096);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7796'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8096/?join=127.0.0.1:7796&token=dedicated&name=Host');
  await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const look = async (yaw, pitch = 0) => { await G(([y, p]) => { window.__game.yaw = y; window.__game.pitch = p; }, [yaw, pitch]); await sleep(900); };
  await D('spawn_bots', { n: 6 }); await D('bot_mode', { mode: 'idle' }); await D('freeze_red', { on: true }); await D('force_role', { role: 15 });
  await D('force_duo', { master: 1 });
  await sleep(600); await G(() => window.__game.net.send({ t: 'start' }));
  await sleep(7200); await shot('r_01_reveal_front');
  await sleep(4500);
  await shot('r_02_master_pillar_banner');
  // signage
  await D('teleport', { x: -13, z: 0 }); await sleep(500); await look(-Math.PI / 2 + 0.2, 0.05); await shot('r_03_signs_west_corridor');
  await look(0, 0.05); await shot('r_04_sign_wall_north');
  await D('teleport', { x: -26, z: 0 }); await sleep(500); await look(0, 0.3); await shot('r_05_header_boiler');
  // captive glow (we are Master)
  await D('teleport', { x: 0, z: -18 }); await sleep(500); await look(0, -0.2); await shot('r_06_captive_glow');
  // role card hover
  await page.mouse.move(1290, 720); await sleep(600); await shot('r_07_hud_rolecard_hover');
  await page.mouse.move(700, 400);
  // ceremony: forced exhausted target → error flash, then nomination
  await D('teleport', { x: 0, z: 0 }); await D('fill_milestone'); await sleep(4000);
  const tgt = await G(() => { const g = window.__game; const id = [...g.players.keys()][0]; return id; });
  await D('status', { pid: tgt, effect: 'exhaust' }); await sleep(400);
  await G(id => window.__game.net.send({ t: 'lmb', target: 'player:' + id }), tgt); await sleep(500); await shot('r_08_exhausted_error');
  const ok = await G(() => { const g = window.__game; return [...g.players.values()].map(e => e.p).find(p => !p.exhausted && !p.ghost).id; });
  await D('set_timers', { timers: { vote: 30 } }); await D('bot_mode', { mode: 'voter' }); await D('bot_speed', { m: 1 });
  await G(id => window.__game.net.send({ t: 'lmb', target: 'player:' + id }), ok); await sleep(300); await shot('r_09_exec_pillar_vote');
  for (let i = 0; i < 40; i++) { const s = await G(() => window.__game.st.cer?.sub); if (s === 'DEBATE') break; await D('skip_step'); await sleep(500); }
  await sleep(600); await shot('r_10_debate_resolution');
  console.log('ERRORS', errors);
  await browser.close(); srv.kill(); web.close(); process.exit(0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
