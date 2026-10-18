// Online play end to end over the REAL public services (ntfy.sh room list + PeerJS cloud signalling + WebRTC).
// Host window bridges internet peers into its local server; a second browser finds the room in Browse Rooms and joins.
// Uses a private, random registry topic so test rooms never show up in the real room list.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/online-smoke.cjs   (needs `node build.mjs` + internet)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8093);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7793'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
const TOPIC = 'crypt-of-minions-smoke-' + Math.random().toString(36).slice(2, 10);
(async () => {
  await sleep(700);
  const args = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'];
  const A = await chromium.launch({ executablePath: process.env.CHROME_PATH, args }), B = await chromium.launch({ executablePath: process.env.CHROME_PATH, args });
  const init = `localStorage.setItem('crypt_online', JSON.stringify({ topic: '${TOPIC}' }));`;
  const ca = await A.newContext({ viewport: { width: 1200, height: 720 } }), cb = await B.newContext({ viewport: { width: 1200, height: 720 } });
  await ca.addInitScript(init); await cb.addInitScript(init);
  const pa = await ca.newPage(), pb = await cb.newPage();
  const errors = []; for (const p of [pa, pb]) p.on('pageerror', e => errors.push(e.message));
  const G = (p, fn, a) => p.evaluate(fn, a);
  const waitFor = async (p, fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await G(p, fn, arg)) return true; } catch { /* navigating */ } await sleep(250); } return false; };

  // host: local server + online bridge (what HOST GAME does in the desktop app)
  await pa.goto('http://127.0.0.1:8093/?join=127.0.0.1:7793&token=dedicated&name=HostOnline');
  check(await waitFor(pa, () => !!window.__game?.st, 10000), 'host connected to its local server');
  await G(pa, () => window.__startOnline(7793, 'HostOnline', true));
  check(await waitFor(pa, () => window.__online?.status === 'online', 20000), 'host registered with the signalling server');
  const code = await G(pa, () => window.__online.code);
  console.log('   room code:', code);
  check(await waitFor(pa, c => document.getElementById('lobbyInfo').innerText.includes(c), 5000, code), 'lobby shows the online room code');

  // second player: main menu → Browse Rooms
  await pb.goto('http://127.0.0.1:8093/?name=Remote');
  await sleep(1500);
  await G(pb, () => { document.getElementById('nameIn').value = 'Remote'; });
  let listed = false;
  for (let i = 0; i < 12 && !listed; i++) { await G(pb, () => document.getElementById('roomsBtn').click()); await sleep(2500); listed = await G(pb, c => !!document.querySelector(`#roomList button[data-code="${c}"]`), code); }
  check(listed, 'the room appears in Browse Rooms (internet room list)');
  await pb.screenshot({ path: path.join(shots, 'o_01_browse.png') });
  await G(pb, c => document.querySelector(`#roomList button[data-code="${c}"]`).click(), code);
  const joined = await waitFor(pb, () => !!window.__game?.st, 30000);
  if (!joined) console.log('   menu says:', await G(pb, () => document.getElementById('menuErr').textContent));
  check(joined, 'JOIN connects over WebRTC and receives game state');
  if (!joined) { await A.close(); await B.close(); srv.kill(); web.close(); process.exit(1); }
  check(await waitFor(pa, () => window.__game.st.players.some(p => p.name === 'Remote'), 10000), 'the host sees the remote player in its lobby');
  check(await waitFor(pb, () => window.__game.st.players.some(p => p.name === 'HostOnline'), 5000), 'the remote player sees the host');
  // remote player input reaches the host (moves) and chat
  await G(pb, () => window.__game.net.send({ t: 'chat', text: 'hello over webrtc' }));
  check(await waitFor(pa, () => /hello over webrtc/.test(document.getElementById('chatLog').innerText), 8000), 'chat from the remote player arrives at the host');
  // start a match: bots + the two humans
  await G(pa, () => { const n = window.__game.net; n.send({ t: 'debug', cmd: 'spawn_bots', a: { n: 4 } }); n.send({ t: 'debug', cmd: 'set_timers', a: { timers: { revealBack: 1, revealFront: 1 } } }); });
  await sleep(1500);
  check(await waitFor(pa, () => window.__online.lastOpen === true && JSON.parse(window.__online.lastInfo).players >= 6, 12000), 'announcement tracks the player count');
  await G(pa, () => window.__game.net.send({ t: 'start' }));
  check(await waitFor(pb, () => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 30000), 'the remote player enters the match');
  await sleep(1500); await pb.screenshot({ path: path.join(shots, 'o_02_remote_in_match.png') });
  check(await waitFor(pa, () => window.__online.lastOpen === false, 8000), 'room is announced as closed once the match starts');
  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await G(pa, () => window.__online.stop());
  await A.close(); await B.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
