// Simplified Mode UI: faction-only reveal, no crystals, role drop overlay (15 s / click), HUD card without "WHEN TO USE",
// hold-Q discard, lever elimination (Master), APPROVE/MUTINY buttons, debug toggle locked in the match.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke7.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8092);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7792'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8092/?join=127.0.0.1:7792&token=dedicated&name=Host');
  await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await G(fn, arg)) return true; await sleep(150); } return false; };
  const key = (type, code) => G(([type, code]) => window.dispatchEvent(new KeyboardEvent(type, { code })), [type, code]);
  const myId = await G(() => window.__game.myId);

  await D('spawn_bots', { n: 6 }); await D('bot_mode', { mode: 'idle' }); await D('set_timers', { timers: { revealBack: 2, revealFront: 2, phaseTransitionBufferSeconds: 1 } });
  await D('simplified', { on: true }); await D('role_drop', { pct: 100 }); await D('eliminate_timer', { s: 30 });
  await sleep(600);
  check(await G(() => /SIMPLIFIED/.test(document.getElementById('lobbyInfo').innerText)), 'lobby shows MODE: SIMPLIFIED');
  await G(() => window.__game.debug.toggle()); await sleep(300);
  check(await G(() => !document.getElementById('dSimple').disabled && document.getElementById('dSimple').checked), 'debug: Simplified Mode toggle is enabled in the lobby');
  await shot('s_00_debug_lobby');
  await G(() => window.__game.debug.toggle());
  await D('force_duo', { master: myId });
  await G(() => window.__game.net.send({ t: 'start' }));
  check(await waitFor(() => !document.getElementById('reveal').classList.contains('hidden'), 8000), 'reveal shown');
  await sleep(500); await shot('s_01_reveal_faction_only');
  check(await G(() => /SIMPLIFIED MODE/.test(document.getElementById('reveal').innerText) && !document.getElementById('rcard')), 'reveal = faction only (no role card)');
  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 20000), 'work phase');
  await D('freeze_red', { on: true }); await sleep(800);
  const hud = await G(() => ({ txt: document.getElementById('bottomBar').innerText, crys: !!document.querySelector('#bottomBar .crys') }));
  check(/No role card/.test(hud.txt) && /100% chance/.test(hud.txt) && !hud.crys, 'HUD: empty card slot with the drop chance, no crystal counter');
  check(await G(() => !/💎/.test(document.getElementById('nameplates').innerText)), 'nameplates show no crystals');
  await G(() => window.__game.debug.toggle()); await sleep(300);
  check(await G(() => document.getElementById('dSimple').disabled), 'debug: Simplified toggle is locked during the match');
  await G(() => window.__game.debug.toggle());

  // role drop
  await G(() => { const g = window.__game, t = g.st.tasks[0]; g.net.send({ t: 'debug', cmd: 'complete_task', a: { uid: t.uid } }); });
  check(await waitFor(() => window.__game.ui.roleDropOpen && !document.getElementById('roleDrop').classList.contains('hidden'), 5000), 'finishing a chore drops a role card (full-screen overlay)');
  await sleep(400);
  const rd = await G(() => ({ secs: +document.getElementById('rdT').textContent, txt: document.getElementById('roleDrop').innerText }));
  await shot('s_02_role_drop');
  check(rd.secs >= 13 && rd.secs <= 15 && !/WHEN TO USE/.test(rd.txt), `overlay counts down from 15 s (${rd.secs}s) and has no WHEN TO USE`);
  await page.mouse.click(700, 400); await sleep(900);
  check(await G(() => !window.__game.ui.roleDropOpen && document.getElementById('roleDrop').classList.contains('hidden')), 'click dismisses it early (flies into the HUD slot)');
  const card = await G(() => document.getElementById('roleCard').innerText);
  check(!/WHEN TO USE/.test(card) && /discard/.test(card), 'HUD card: no WHEN TO USE line, discard hint shown');
  await shot('s_03_hud_card');
  // hold Q to discard
  const t0 = Date.now(); await key('keydown', 'KeyQ'); await sleep(1200);
  const mid = await G(() => ({ held: !!window.__game.st.you.roleId, bar: document.getElementById('holdLabel').textContent }));
  check(mid.held && /Discarding/.test(mid.bar), `still holding the card after ${((Date.now() - t0) / 1000).toFixed(1)} s, progress shown ("${mid.bar}")`);
  await shot('s_04_discarding');
  await sleep(Math.max(0, 3600 - (Date.now() - t0))); await key('keyup', 'KeyQ'); await sleep(600);
  check(await G(() => !window.__game.st.you.roleId), 'holding Q for 3 s discarded the card');

  // ceremony: lever elimination as Master
  await D('force_role', { pid: myId, role: 105 }); await sleep(400);
  await D('fill_milestone'); 
  check(await waitFor(() => window.__game.st.cer?.sub === 'ELIMINATE', 15000), 'milestone → lever elimination');
  await sleep(1200);
  const el = await G(() => ({ master: window.__game.st.masterId === window.__game.myId, line: window.__game.st.npcs.filter(n => n.state === 'line').length, known: window.__game.st.npcs.filter(n => n.state === 'line' && n.faction).length, rig: window.__game.leverRig?.g.visible }));
  check(el.master && el.line === 3 && el.known === 3 && el.rig, `3 captives on trapdoors with levers; the Master sees their glyphs (${el.known}/3)`);
  await G(() => { window.__game.yaw = 0; window.__game.pitch = -0.45; }); await sleep(800); await shot('s_05_levers');
  check(await G(() => !/too few captives/.test(document.getElementById('toasts').innerText)), 'no classic "too few captives" toast');
  // pull a lever: walk to it
  const lever = await G(() => { const n = window.__game.st.npcs.find(n => n.state === 'line'); return { id: n.id, spot: n.spot }; });
  const L = [{ x: -1.45, z: 4.05 }, { x: 0.95, z: 4.3 }, { x: 3.35, z: 4.05 }][lever.spot];
  await D('teleport', { pid: myId, x: L.x, z: L.z + 1.2 }); await sleep(500);
  await G(id => window.__game.net.send({ t: 'use', target: 'lever:' + id }), lever.id);
  check(await waitFor(id => { const n = window.__game.st.npcs.find(q => q.id === id); return !n || n.state === 'abyss'; }, 4000, lever.id), 'pulling the lever drops that captive into the abyss');
  await sleep(500); await shot('s_06_trapdoor_open');
  check(await waitFor(() => window.__game.st.cer?.sub === 'NOMINATE', 6000), 'then the Master nominates');
  const ex = await G(() => window.__game.st.players.find(p => p.id !== window.__game.myId && !p.exhausted).id);
  await D('force_duo', { master: myId, exec: ex });
  check(await waitFor(() => window.__game.st.cer?.sub === 'VOTE', 6000), 'vote window');
  await sleep(400);
  const vt = await G(() => ({ txt: document.getElementById('cerPanel').innerText, btn: document.querySelectorAll('#cerPanel .vbtn').length }));
  check(/APPROVE or MUTINY/.test(vt.txt) && !/💎/.test(vt.txt), 'vote panel: APPROVE / MUTINY, no crystals');
  check(await G(() => window.__game.st.you.ability.ok), 'the role card is usable in the vote window');
  await shot('s_07_vote');
  check(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
