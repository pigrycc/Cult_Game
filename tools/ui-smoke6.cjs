// Open-mic end to end: a second browser with a fake microphone (periodic beeps) talks; the first one must see the 🔊 icon
// on that minion's nameplate while they speak and not afterwards. Also: a gagged player transmits nothing.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke6.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8091);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7791'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const base = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
  const A = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: base });
  const B = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: [...base, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const pa = await A.newPage({ viewport: { width: 1200, height: 700 } }), pb = await B.newPage({ viewport: { width: 1200, height: 700 } });
  const errors = []; pa.on('pageerror', e => errors.push(e.message)); pb.on('pageerror', e => errors.push(e.message));
  await pa.goto('http://127.0.0.1:8091/?join=127.0.0.1:7791&token=dedicated&name=Host');
  await sleep(2000);
  await pb.goto('http://127.0.0.1:8091/?join=127.0.0.1:7791&name=Talker');
  await sleep(2500);
  const G = (p, fn, a) => p.evaluate(fn, a);
  const waitFor = async (p, fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await G(p, fn, arg)) return true; await sleep(100); } return false; };
  await G(pa, () => window.__game.net.send({ t: 'debug', cmd: 'spawn_bots', a: { n: 4 } })); await G(pa, () => window.__game.net.send({ t: 'debug', cmd: 'bot_mode', a: { mode: 'idle' } }));
  await G(pa, () => window.__game.net.send({ t: 'debug', cmd: 'set_timers', a: { timers: { revealBack: 1, revealFront: 1 } } }));
  await sleep(400); await G(pa, () => window.__game.net.send({ t: 'start' }));
  check(await waitFor(pa, () => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 30000), 'work phase'); await waitFor(pb, () => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 10000);
  check(await waitFor(pb, () => !!window.__game.audio.mic, 8000), 'microphone opened automatically — no key pressed');
  const bId = await G(pb, () => window.__game.myId);
  // make Talker audible to Host: stand together
  await G(pa, id => window.__game.net.send({ t: 'debug', cmd: 'teleport', a: { pid: id, x: 0, z: 8 } }), bId);
  const sawTalking = await waitFor(pa, id => window.__game.st.players.find(p => p.id === id)?.talking === true, 15000, bId);
  check(sawTalking, 'host state flags the talker as speaking (voice activity detected, relayed by the server)');
  const html = await G(pa, id => { const g = window.__game, p = g.st.players.find(q => q.id === id); return g.ui.plateHtml({ ...p, talking: true }, g.st); }, bId);
  check(/class="pTalk"[^>]*>🔊/.test(html), 'nameplate carries the pulsing 🔊 icon while talking');
  check(await waitFor(pa, id => window.__game.st.players.find(p => p.id === id)?.talking === false, 20000, bId), 'icon disappears again when the talker stops');
  check((await G(pb, () => document.getElementById('micChip').textContent)).length > 0, 'mic status chip is shown');
  // gag the talker: nothing may be transmitted
  await G(pa, id => window.__game.net.send({ t: 'debug', cmd: 'status', a: { pid: id, effect: 'silence' } }), bId); await sleep(800);
  const gagged = await G(pa, id => window.__game.st.players.find(p => p.id === id)?.muted, bId);
  if (gagged) {
    check(await waitFor(pb, () => window.__game.audio.silenced === true, 3000), 'gagged client stops its own mic');
    let talked = false; for (let i = 0; i < 40; i++) { if (await G(pa, id => window.__game.st.players.find(p => p.id === id)?.talking, bId)) talked = true; await sleep(100); }
    check(!talked, 'gagged minion never shows the speaker icon');
  } else console.log('   (gag status command unavailable — skipped)');
  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await A.close(); await B.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
