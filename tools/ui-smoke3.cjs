// Browser check: countdown audio (vote / debate / work-phase collapse) + lobby debuff purge.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke3.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8093);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7793'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8093/?join=127.0.0.1:7793&token=dedicated&name=Host');
  await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await G(fn, arg)) return true; await sleep(150); } return false; };

  // the sandbox's software GL blocks the main thread for seconds per frame; skip the 3D draw so timers/audio can be observed
  await G(() => { const g = window.__game; window.__realRender = g.render.bind(g); g.render = () => {}; });
  // record every countdown cue together with the window it belongs to
  await G(() => { setInterval(() => { const t = document.getElementById('phaseTimer').innerText; if (/collapses/i.test(t)) window.__warn = t; }, 80); });
  await G(() => { const g = window.__game; window.__cd = []; g.audio.countdown = n => { const c = g.st.cer; window.__cd.push({ n, at: Math.round(performance.now()), where: c ? c.sub : g.st.phase, win: g.cdWindow.key }); }; });

  await D('spawn_bots', { n: 5 }); await D('bot_mode', { mode: 'idle' }); await D('freeze_red', { on: true });
  await D('set_timers', { timers: { revealBack: 1, revealFront: 1, vote: 8, debate: 8, phaseTransitionBufferSeconds: 0.5 }, debateSec: 8 });
  await D('force_duo', { master: 2, exec: 3 });                  // bots hold both offices → the host is a plain voter who never votes
  await sleep(500); await G(() => window.__game.net.send({ t: 'start' }));
  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 15000), 'match started');
  await sleep(500);

  // ---- mutiny vote window: the host does not vote, so the window runs the full 8 s
  await D('fill_milestone');
  check(await waitFor(() => window.__game.st.cer?.sub === 'VOTE', 15000), 'vote window opened');
  const voteKey = await G(() => 'cer:' + window.__game.st.cer.seq);
  await sleep(500);
  check(await waitFor(k => window.__cd.some(x => x.win === k && x.n === 0), 12000, voteKey), 'vote window finished');
  const vote = (await G(k => window.__cd.filter(x => x.win === k), voteKey)).map(x => x.n);
  check(vote.join() === '5,4,3,2,1,0', `vote window plays 5,4,3,2,1,0 (got ${vote.join()})`);

  // ---- debate window
  check(await waitFor(() => window.__game.st.cer?.sub === 'DEBATE', 40000), 'debate opened');
  const debKey = await G(() => 'cer:' + window.__game.st.cer.seq);
  check(await waitFor(k => window.__cd.some(x => x.win === k && x.n === 0), 15000, debKey), 'debate finished');
  const deb = (await G(k => window.__cd.filter(x => x.win === k), debKey)).map(x => x.n);
  check(deb.join() === '5,4,3,2,1,0', `debate plays 5,4,3,2,1,0 (got ${deb.join()})`);

  // ---- work phase: Red Bar heads for the milestone → collapse countdown + warning label
  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 20000), 'back to work');
  await D('status', { effect: 'fumes' }); await D('status', { effect: 'silence' });
  await sleep(600);
  check(await G(() => document.body.classList.contains('drunk')), 'Toxic Fumes blur is active during the match');
  const base = await G(() => window.__cd.length);
  await D('freeze_red', { on: false }); await D('set_timers', { workSec: 14 });
  check(await waitFor(() => { const e = window.__game.st.bars.eta; return e != null && e <= 4.6; }, 60000), 'Red Bar approaching the milestone');
  await shot('c_01_collapse_warning');
  await waitFor(() => !!window.__warn, 6000);
  const label = await G(() => window.__warn || '');
  check(/crypt collapses/i.test(label), `HUD shows the collapse warning ("${label.replace(/\s+/g, ' ').trim()}")`);
  check(await waitFor(() => window.__game.st.phase === 'STATE_FINALE', 20000), 'crypt exploded (finale)');
  const work = (await G(b => window.__cd.slice(b).filter(x => x.where.startsWith('STATE_GAMEPLAY')), base)).map(x => x.n);
  check(work.join() === '5,4,3,2,1,0', `work phase collapse plays 5,4,3,2,1,0 (got ${work.join()})`);

  // ---- back to the lobby: every debuff must be gone, on the server AND on screen
  const before = await G(() => ({ drunk: document.body.classList.contains('drunk'), fumes: window.__game.st.you.fumes }));
  await G(() => { window.__game.render = window.__realRender; });
  await shot('c_02_finale');
  await G(() => window.__game.net.send({ t: 'lobby' }));
  check(await waitFor(() => window.__game.st.phase === 'LOBBY', 8000), 'returned to the lobby');
  await sleep(1200);
  const after = await G(() => {
    const g = window.__game, y = g.st.you, c = id => document.getElementById(id);
    return { fumes: y.fumes, muted: y.muted, gagged: y.gagged, blind: y.blind, frozen: y.frozen, exhausted: y.exhausted, ghost: y.ghost, speed: y.speedMul,
      drunkClass: document.body.classList.contains('drunk'), blindOp: c('blind').style.opacity, ghostOp: c('ghostTint').style.opacity,
      roll: +g.camera.rotation.z.toFixed(3), fov: g.camera.fov, hold: c('holdBox').style.display, cer: c('cerPanel').style.display, bar: c('bar').style.display,
      players: g.st.players.map(p => [p.fumes, p.muted, p.gagged, p.exhausted, p.ghost, p.ward]).flat().some(Boolean), tint: c('reveal').classList.contains('hidden') };
  });
  console.log('before', JSON.stringify(before), '\nafter ', JSON.stringify(after));
  check(before.drunk && before.fumes > 0, 'debuffs were really active at match end');
  check(after.fumes === 0 && !after.muted && !after.gagged && !after.blind && !after.frozen && !after.exhausted && !after.ghost && after.speed === 1, 'server state: all statuses back to default');
  check(!after.drunkClass && (after.blindOp === '0' || after.blindOp === '') && (after.ghostOp === '0' || after.ghostOp === ''), 'screen overlays (blur / blackout / ghost tint) cleared');
  check(after.roll === 0 && after.fov === 76, 'camera roll / FOV wobble back to normal');
  check(after.hold === 'none' && after.cer === 'none' && after.bar === 'none' && !after.players, 'hold meter, ceremony panel, progress bar and per-player status icons gone');
  await sleep(300); await shot('c_03_lobby_clean');
  console.log('ERRORS', errors);
  check(errors.length === 0, 'no page errors');
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
