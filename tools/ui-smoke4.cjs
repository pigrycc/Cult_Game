// Visual/behaviour check: objective banner above the card, "WHEN TO USE:" header, bot banter on screen, debug sliders.
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke4.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8089);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7789'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8089/?join=127.0.0.1:7789&token=dedicated&name=Host');
  await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const D = (cmd, a = {}) => G(([cmd, a]) => window.__game.net.send({ t: 'debug', cmd, a }), [cmd, a]);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };
  const waitFor = async (fn, ms, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await G(fn, arg)) return true; await sleep(150); } return false; };

  await D('spawn_bots', { n: 6 }); await D('bot_mode', { mode: 'human' }); await D('force_role', { role: 15 });
  await D('set_timers', { timers: { revealBack: 3, revealFront: 6 } }); await D('bot_delay', { s: 1 });
  await sleep(500); await G(() => window.__game.net.send({ t: 'start' }));
  check(await waitFor(() => !document.getElementById('reveal').classList.contains('hidden'), 8000), 'identity reveal screen shown');
  await sleep(600); await shot('p_01_reveal_faction_side');
  const geo1 = await G(() => { const b = document.querySelector('.objBanner').getBoundingClientRect(), c = document.querySelector('.cardWrap').getBoundingClientRect(); return { bannerBottom: b.bottom, cardTop: c.top, bannerTop: b.top, text: document.querySelector('.objBanner').innerText }; });
  check(geo1.bannerBottom <= geo1.cardTop + 1 && geo1.bannerTop >= 0, `objective banner sits ABOVE the card on the faction side (banner bottom ${Math.round(geo1.bannerBottom)} ≤ card top ${Math.round(geo1.cardTop)})`);
  check(/FACTION OBJECTIVE/.test(geo1.text) && geo1.text.length > 60, 'banner carries the faction win condition');
  await G(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))); await sleep(1600); await shot('p_02_reveal_role_side');
  const geo2 = await G(() => { const b = document.querySelector('.objBanner').getBoundingClientRect(), c = document.querySelector('.cardWrap').getBoundingClientRect(), w = document.querySelector('.rWhen'); return { above: b.bottom <= c.top + 1, when: w.innerText, inside: document.querySelector('.face.front').innerText }; });
  check(geo2.above && !/FACTION OBJECTIVE/.test(geo2.inside), 'after the flip the banner is still above the card, not inside it');
  check(/^WHEN TO USE:/.test(geo2.when.trim()), `role card header reads "${geo2.when.trim()}"`);

  check(await waitFor(() => window.__game.st.phase === 'STATE_GAMEPLAY_WORK', 20000), 'match in work phase');
  await sleep(1500);
  await page.mouse.move(1290, 700); await sleep(500); await shot('p_03_hud_card_hover');
  const hud = await G(() => { const c = document.getElementById('roleCard'), o = c.querySelector('.rcObj'), r = c.getBoundingClientRect(), b = o.getBoundingClientRect(); return { above: b.bottom <= r.top, shown: getComputedStyle(o).display !== 'none', when: c.querySelector('.rcWhen').innerText }; });
  check(hud.shown && hud.above, 'HUD inspection: objective banner floats above the role card');
  check(/^WHEN TO USE:/.test(hud.when.trim()), `HUD card header: "${hud.when.trim()}"`);
  await page.mouse.move(700, 400);

  // bots do real chores → see tools in their hands
  await D('freeze_red', { on: true });
  check(await waitFor(() => window.__game.st.players.some(p => p.bot && p.tool), 90000), 'a Humanlike bot is visibly holding a tool');
  const tool = await G(() => window.__game.st.players.filter(p => p.bot && p.tool).map(p => p.name + ' → ' + p.tool).join(', '));
  console.log('   tools in hand:', tool);

  // banter on screen
  await D('fill_milestone');
  check(await waitFor(() => document.querySelectorAll('#chatLog .chatLine').length >= 3, 90000), 'bot banter appears in the chat log');
  check(await waitFor(() => document.querySelectorAll('.plate .bubble').length >= 1, 30000), 'and as speech bubbles above their heads');
  await sleep(500); await shot('p_04_bot_banter');
  console.log('   chat:', (await G(() => [...document.querySelectorAll('#chatLog .chatLine')].slice(-4).map(e => e.innerText).join(' | '))).slice(0, 420));

  // debug menu
  await G(() => window.__game.debug.toggle()); await sleep(300);
  await page.evaluate(() => { const d = document.getElementById('dBotDelay'); d.scrollIntoView(); });
  await sleep(300); await shot('p_05_debug_bot_section');
  const dbg = await G(() => { const s = document.getElementById('dBotDelay'); return { min: s.min, max: s.max, val: s.value, label: document.getElementById('dBotDelayV').textContent }; });
  check(dbg.max === '8' && dbg.val === '1', `debug slider "Humanlike reaction delay" present (0–8 s, now ${dbg.label})`);
  await G(() => { const s = document.getElementById('dBotDelay'); s.value = '4'; s.dispatchEvent(new Event('change')); }); await sleep(500);
  check((await G(() => window.__game.st.dbg.botDecisionDelaySeconds)) === 4, 'moving the slider changes the server value (botDecisionDelaySeconds = 4)');
  check((await G(() => JSON.parse(localStorage.getItem('crypt_debug_settings_v1')).bot_delay.s)) === 4, 'and it is persisted for the next start');
  console.log('ERRORS', errors); check(errors.length === 0, 'no page errors');
  await browser.close(); srv.kill(); web.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
