// Headless browser smoke test: dedicated server + static client + Chromium (SwiftShader WebGL).
// node tools/browser-smoke.cjs  → screenshots in tools/shots/
const { chromium } = require('/root/.nvm/versions/node/v22.23.3/lib/node_modules/@playwright/mcp/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8099);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7799', '--debug-all'], { stdio: 'inherit' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = (process.argv[2] || 'all');

(async () => {
  await sleep(800);
  const browser = await chromium.launch({ executablePath: '/opt/playwright/chromium-1232/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('crash', () => console.log('PAGE CRASHED'));
  process.on('unhandledRejection', e => { console.log('ERR', e.message); console.log(errors.join('\n')); });
  await page.goto('http://127.0.0.1:8099/?join=127.0.0.1:7799&token=dedicated&name=Host');
  await sleep(3000);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const G = (fn, arg) => page.evaluate(fn, arg);
  await shot('01_lobby_mirror');
  await G(() => { const g = window.__game; g.yaw = 0; });
  await sleep(600); await shot('02_lobby_cave');
  await G(() => { const g = window.__game; g.net.send({ t: 'debug', cmd: 'spawn_bots', a: { n: 6 } }); g.net.send({ t: 'debug', cmd: 'force_role', a: { role: 7 } }); g.net.send({ t: 'debug', cmd: 'bot_mode', a: { mode: 'idle' } }); g.net.send({ t: 'debug', cmd: 'freeze_red', a: { on: true } }); });
  await sleep(800);
  await G(() => { const g = window.__game; g.yaw = Math.PI; });
  await sleep(500); await shot('03_lobby_bots');
  await G(() => window.__game.net.send({ t: 'start' }));
  await sleep(1500); await shot('04_reveal_back');
  await sleep(4500); await shot('05_reveal_front');
  await sleep(6000);
  await G(() => { const g = window.__game; g.yaw = 0.3; g.pitch = -0.15; });
  await sleep(1000); await shot('06_work_sanctuary');
  await G(() => { const g = window.__game; g.yaw = Math.PI; g.pitch = -0.1; });
  await sleep(1000); await shot('07_work_sanctuary_south');
  // teleport-ish via debug: walk us to the boiler room by forcing body position client+server? use repeated inputs
  const walkTo = async (x, z) => {
    for (let i = 0; i < 250; i++) {
      const d = await G(([x, z]) => { const g = window.__game; const b = g.body; const dx = x - b.x, dz = z - b.z; const d = Math.hypot(dx, dz); g.yaw = Math.atan2(-dx, -dz); g.keys.add('KeyW'); g.keys.add('ShiftLeft'); return d; }, [x, z]);
      if (d < 1) break; await sleep(50);
    }
    await G(() => { window.__game.keys.clear(); });
  };
  const route = async pts => { for (const [x, z] of pts) await walkTo(x, z); };
  await route([[-8, 0], [-14, 0], [-24, 0], [-26, -6]]);
  await G(() => { const g = window.__game; g.yaw = 0.2; g.pitch = 0.1; }); await sleep(800); await shot('08_boiler');
  await G(() => { const g = window.__game; g.yaw = Math.PI; }); await sleep(800); await shot('09_armory_view');
  await route([[-24, 0], [-26, 6]]); await G(() => { const g = window.__game; g.yaw = Math.PI; g.pitch = -0.1; }); await sleep(800); await shot('10_armory');
  // pick up a tool to see the viewmodel
  await route([[-24, 0], [-14, 0], [0, -8], [5, -7.6]]);
  await G(() => { const g = window.__game; g.yaw = Math.atan2(-(5.6 - g.body.x), -(-8.4 - g.body.z)); g.pitch = -0.6; }); await sleep(500);
  await G(() => { const g = window.__game; g.pressE(); }); await sleep(600);
  await G(() => { const g = window.__game; g.pitch = 0; g.yaw = 0; }); await sleep(600); await shot('11_broom_vm');
  await route([[0, 8], [0, 12.5], [0, 17.5]]); await G(() => { const g = window.__game; g.yaw = Math.PI * 0.75; }); await sleep(800); await shot('12_kitchen');
  await route([[0, 24.5], [0, 27], [0, 31.5]]); await G(() => { const g = window.__game; g.yaw = Math.PI; }); await sleep(800); await shot('13_bonemill');
  await route([[0, 27], [0, 17.5], [0, 12.5], [0, 8], [8, 0], [14, 0], [24, 0], [26, -6.5]]); await G(() => { const g = window.__game; g.yaw = -Math.PI / 2; }); await sleep(800); await shot('14_alchemy');
  await route([[24, 0], [26, 6.5]]); await G(() => { const g = window.__game; g.yaw = Math.PI; }); await sleep(800); await shot('15_library');
  // ceremony
  await G(() => window.__game.net.send({ t: 'debug', cmd: 'bot_mode', a: { mode: 'roamer' } }));
  await G(() => window.__game.net.send({ t: 'debug', cmd: 'fill_milestone' }));
  await sleep(4500); await G(() => { const g = window.__game; g.pitch = -0.1; }); await shot('16_ceremony_nominate');
  await sleep(4000); await shot('17_ceremony_vote');
  await sleep(4000); await shot('18_ceremony_count');
  await sleep(6000); await shot('19_ceremony_exec');
  await G(() => window.__game.net.send({ t: 'debug', cmd: 'god_mode', a: { on: true } }));
  await sleep(12000); await shot('20_later');
  const st = await G(() => { const s = window.__game.st; return { phase: s.phase, cer: s.cer && s.cer.sub, red: s.bars.red, yellow: s.bars.yellow, players: s.players.length, tasks: s.tasks.length }; });
  console.log('STATE', JSON.stringify(st));
  console.log('ERRORS', errors.length); errors.slice(0, 30).forEach(e => console.log('  ', e));
  await browser.close(); srv.kill(); web.close(); process.exit(0);
})().catch(e => { console.error(e); console.log(errors.join('\n')); srv.kill(); process.exit(1); });
