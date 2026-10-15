// Round-3 visual checks: coloured task chains + tool beacons, FPP held tool (coal on the shovel), TAB split overlay.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke5.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8090);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7790'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8090/?join=127.0.0.1:7790&token=dedicated&name=Host');
  await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await G(fn, arg)) return true; await sleep(150); } return false; };

  await D('spawn_bots', { n: 6 }); await D('bot_mode', { mode: 'idle' }); await D('set_timers', { timers: { revealBack: 1, revealFront: 1 } });
  await sleep(400); await G(() => window.__game.net.send({ t: 'start' }));
  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 30000), 'work phase');
  await D('freeze_red', { on: true }); await D('clear_tasks'); await D('max_concurrent', { n: 12 });
  for (const k of ['coal', 'books', 'mop']) await D('spawn_task', { key: k });
  await sleep(800);
  const me = () => G(() => window.__game.myId);

  // ---- colours: all markers of one chain share the colour; tool beacon matches
  const info = await G(() => {
    const g = window.__game, out = [];
    for (const t of g.st.tasks) {
      const cols = new Set(t.points.map(p => '#' + g.markers.get(p.id).children[0].material.color.getHexString()));
      out.push({ key: t.key, color: t.color, cols: [...cols], tool: t.tool });
    }
    const tm = [...g.tmarkers.entries()].map(([k, v]) => ({ k, col: '#' + v.children[0].material.color.getHexString(), vis: v.visible }));
    return { out, tm };
  });
  console.log('   chains:', JSON.stringify(info.out)); console.log('   beacons:', JSON.stringify(info.tm));
  check(info.out.every(c => c.cols.length === 1), 'every marker of a task chain has the same colour');
  check(new Set(info.out.map(c => c.cols[0])).size === info.out.length, 'different tasks have different colours');
  const coal = info.out.find(c => c.key === 'coal'), mop = info.out.find(c => c.key === 'mop'), books = info.out.find(c => c.key === 'books');
  check(info.tm.some(b => b.k.startsWith('t:shovel1') && b.col === coal.cols[0]), 'shovel beacon matches the coal task colour');
  check(info.tm.some(b => b.k.startsWith('t:mop1') && b.col === mop.cols[0]), 'mop beacon matches the mop task colour');
  check(info.tm.some(b => b.k.startsWith('i:') && b.col === books.cols[0]), 'biting-book beacon matches the book task colour');
  check(info.tm.filter(b => b.k.startsWith('t:broom')).length === 0, 'no beacon on tools that no task needs');
  const hudSw = await G(() => document.querySelectorAll('#taskBoard .tbSw').length); check(hudSw === 3, 'task board shows a colour swatch per task');

  // ---- walk to the shovel, look at it from near and take a screenshot of the beacon
  await D('teleport', { pid: await me(), x: -30, z: -4 }); await sleep(600);
  await G(() => { window.__game.yaw = Math.PI / 2; window.__game.pitch = -0.1; }); await sleep(500); await shot('r3_01_shovel_beacon');
  // pick up shovel, give it a coal load by going through the real pickup
  await D('teleport', { pid: await me(), x: -31.4, z: -4 }); await sleep(300);
  await G(() => window.__game.net.send({ t: 'use', target: 'tool:shovel1' })); await sleep(600);
  check(await G(() => window.__game.me.tool === 'shovel'), 'picked up the shovel');
  await sleep(300); await shot('r3_02_fpp_shovel_empty');
  const coalT = await G(() => window.__game.st.tasks.find(t => t.key === 'coal'));
  await D('teleport', { pid: await me(), x: coalT.points[0].x + 0.8, z: coalT.points[0].z }); await sleep(400);
  await G(id => window.__game.net.send({ t: 'use', target: id }), coalT.points[0].id); await sleep(800);
  const loaded = await G(() => window.__game.me.load); check(loaded === 'coal', 'scooped coal (loaded state: ' + loaded + ')');
  await sleep(300); await shot('r3_03_fpp_shovel_coal');
  const vm = await G(() => { const g = window.__game; const v = new (g.vmHeld.position.constructor)(); g.vmHeld.children[0].getWorldPosition(v); return { n: g.vmHeld.children[0].children.length, kids: g.vmHeld.children[0].children.filter(c => c.userData !== undefined).length }; });
  check(vm.n >= 3 + 2, 'coal chunks are children of the held shovel (rendered ON the blade)');
  // finish the chain => tool dropped
  await G(() => { const g = window.__game; const t = g.st.tasks.find(t => t.key === 'coal'); g.net.send({ t: 'debug', cmd: 'complete_task', a: { uid: t.uid } }); }); await sleep(700);
  check(await G(() => !window.__game.me.tool), 'task complete → the shovel is auto-dropped (nothing in hand)');

  // ---- TAB overlay
  await G(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }))); await sleep(500); await shot('r3_04_tab');
  const tab = await G(() => {
    const L = document.getElementById('scPlayers').getBoundingClientRect(), R = document.getElementById('scRight').getBoundingClientRect(), lg = document.getElementById('scLog');
    return { left: L.right <= R.left + 1, sideBySide: Math.abs(L.top - R.top) < 4, scrollable: getComputedStyle(lg).overflowY, lines: lg.querySelectorAll('.lg').length, players: document.querySelectorAll('#scPlayers tr').length };
  });
  check(tab.left && tab.sideBySide, 'TAB: two windows side by side'); check(tab.scrollable === 'auto' || tab.scrollable === 'scroll', 'game log is scrollable'); check(tab.lines >= 2 && tab.players >= 7, `TAB content (${tab.lines} log lines, ${tab.players} rows)`);
  await G(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab' })));
  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
