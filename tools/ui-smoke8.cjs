// Personal Task Lists UI: HUD shows only YOUR 2 solo + 1 co-op (not a 9-task wall); co-op entry shows a partner chip;
// world markers exist only for your own task points; [H] calls for help and the task then shows for a second player.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke8.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8094);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7794'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const args = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  // two human windows + bots so there are real co-op partners
  const A = await chromium.launch({ executablePath: process.env.CHROME_PATH, args });
  const B = await chromium.launch({ executablePath: process.env.CHROME_PATH, args });
  const pa = await A.newPage({ viewport: { width: 1300, height: 760 } }), pb = await B.newPage({ viewport: { width: 1300, height: 760 } });
  const errors = []; for (const p of [pa, pb]) p.on('pageerror', e => errors.push(e.message));
  const G = (p, fn, a) => p.evaluate(fn, a);
  const D = (p, cmd, a = {}) => G(p, ([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const waitFor = async (p, fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await G(p, fn, arg)) return true; } catch {} await sleep(150); } return false; };

  await pa.goto('http://127.0.0.1:8094/?join=127.0.0.1:7794&token=dedicated&name=Alice'); await sleep(2000);
  await pb.goto('http://127.0.0.1:8094/?join=127.0.0.1:7794&name=Bob'); await sleep(2200);
  check(await waitFor(pa, () => !!window.__game?.st, 8000) && await waitFor(pb, () => !!window.__game?.st, 8000), 'both players connected');
  await D(pa, 'spawn_bots', { n: 4 }); await D(pa, 'bot_mode', { mode: 'idle' }); await D(pa, 'set_timers', { timers: { revealBack: 1, revealFront: 1 } });
  await sleep(500); await G(pa, () => window.__game.net.send({ t: 'start' }));
  check(await waitFor(pa, () => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 20000), 'work phase');
  await D(pa, 'freeze_red', { on: true }); await sleep(1500);

  // 1. personal list = at most 3 (2 solo + 1 co-op)
  const list = await G(pa, () => window.__game.st.tasks.map(t => ({ kind: t.kind, mine: t.mine, partners: (t.partners || []).length })));
  const solo = list.filter(t => t.kind !== 'coop'), coop = list.filter(t => t.kind === 'coop');
  check(list.length <= 3 && solo.length <= 2 && coop.length <= 1, `HUD shows a short personal list (${solo.length} solo, ${coop.length} co-op) — not a 9-task wall`);
  check(solo.length >= 1, 'the player has at least one solo task');
  const boardTxt = await G(pa, () => document.getElementById('taskBoard').innerText);
  check(/YOUR TASKS/.test(boardTxt), 'HUD titled "YOUR TASKS"');
  await pa.screenshot({ path: path.join(shots, 't_01_personal_list.png') });

  // 2. co-op entry carries a partner chip (name) when a partner is assigned
  const coopT = await G(pa, () => window.__game.st.tasks.find(t => t.kind === 'coop'));
  if (coopT && coopT.partners.length) {
    check(/with/i.test(boardTxt) && new RegExp(coopT.partners[0].name).test(boardTxt), `co-op entry shows partner "${coopT.partners[0].name}"`);
  } else ok_skip('co-op partner chip (no co-op partner this run)');

  // 3. markers exist only for the player's own task points
  const markerOk = await G(pa, () => {
    const g = window.__game, mine = new Set();
    for (const t of g.st.tasks) for (const pt of t.points) mine.add(pt.id);
    let bad = 0; for (const id of g.markers.keys()) if (!mine.has(id)) bad++;
    return { markers: g.markers.size, bad, mine: mine.size };
  });
  check(markerOk.bad === 0 && markerOk.markers > 0, `world markers only for own task points (${markerOk.markers} markers, ${markerOk.bad} stray)`);

  // 4. Alice's solo task is NOT on Bob's HUD
  const aSolo = await G(pa, () => { const t = window.__game.st.tasks.find(x => x.kind !== 'coop'); return t ? t.uid : null; });
  const onBob = await G(pb, u => window.__game.st.tasks.some(t => t.uid === u), aSolo);
  check(aSolo != null && !onBob, "another player's solo task is not on your HUD");

  // 5. [H] call for help: Alice's co-op task becomes visible to Bob
  if (coopT) {
    await G(pa, () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' })));
    const seen = await waitFor(pb, u => window.__game.st.tasks.some(t => t.uid === u && t.helpCall), 5000, coopT.uid);
    check(seen, '[H] call for help broadcasts the co-op task to the whole crew');
    const bobTxt = await G(pb, () => document.getElementById('taskBoard').innerText);
    check(/help/i.test(bobTxt), "the helped task shows a 🆘 help marker on the teammate's HUD");
    await pb.screenshot({ path: path.join(shots, 't_02_help_on_teammate.png') });
  } else ok_skip('[H] help (no co-op task this run)');

  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await A.close(); await B.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
  function ok_skip(m) { console.log('ok   (skipped) ' + m); }
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
