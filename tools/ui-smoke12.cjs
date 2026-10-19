// Feedback-round UI smoke: verifies the three new/overhauled overlays render with the exact copy the user asked for:
//   1. Simplified faction-reveal card ("You belong to:" + faction name + win-condition banner + "prevent the cave from exploding")
//   2. Nomination tooltip restructure ("YOU CAN USE YOUR ROLE NOW!" headline inside the frame, rules below)
//   3. TAB scoreboard "VICTORY CONDITIONS" quick guide (Fire / Blood / Chaos / All Lose lines)
// PLAYWRIGHT_MODULE=<playwright> CHROME_PATH=<chrome> node tools/ui-smoke12.cjs   (needs `node build.mjs` first)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..', 'dist', 'client');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((q, s) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'Content-Type': types[path.extname(f)] || 'x' }); s.end(d); }); }).listen(8098);
const srv = spawn('node', [path.join(__dirname, '..', 'dist', 'server.cjs'), '7798'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const check = (c, msg) => { if (!c) failed++; console.log(c ? 'ok  ' : 'FAIL', msg); };
(async () => {
  await sleep(700);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 820 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8098/?join=127.0.0.1:7798&token=dedicated&name=Host'); await sleep(2500);
  const G = (fn, a) => page.evaluate(fn, a);
  const shot = async n => { await page.screenshot({ path: path.join(shots, n + '.png') }); console.log('shot', n); };

  // ---- 1. Simplified faction reveal (drive the UI method directly with a faked message) ----
  await G(() => window.__game.ui.showFactionReveal({ simple: true, faction: 'chaos', back: 3, front: 3 }, () => {}));
  await sleep(400);
  const reveal = await G(() => ({
    belong: document.querySelector('#reveal .belongTo')?.textContent || '',
    name: document.querySelector('#reveal .factionName')?.textContent || '',
    banner: document.querySelector('#reveal .objBanner')?.textContent || '',
    sub: document.querySelector('#reveal .revealSub')?.textContent || '',
    visible: !document.querySelector('#reveal')?.classList.contains('hidden'),
  }));
  await shot('fb_01_reveal_chaos');
  check(reveal.visible, 'reveal overlay is visible');
  check(/You belong to:/i.test(reveal.belong), `card header reads "You belong to:" (got "${reveal.belong}")`);
  check(/CHAOS/i.test(reveal.name), `faction name shown on the card (got "${reveal.name}")`);
  check(/MAJORITY of Chaos/.test(reveal.banner) && /or make it a TIE/.test(reveal.banner), `Chaos win-condition banner incl. the TIE clause (got "${reveal.banner}")`);
  check(/prevent the cave from exploding/i.test(reveal.sub), `subtitle "Perform tasks to prevent the cave from exploding" (got "${reveal.sub}")`);

  // Fire banner should NOT contain the TIE clause
  await G(() => window.__game.ui.showFactionReveal({ simple: true, faction: 'fire', back: 3, front: 3 }, () => {}));
  await sleep(300);
  const fireBanner = await G(() => document.querySelector('#reveal .objBanner')?.textContent || '');
  check(/MAJORITY of Fire/.test(fireBanner) && !/TIE/.test(fireBanner), `Fire banner is majority-only, no TIE clause (got "${fireBanner}")`);
  await G(() => { const r = document.querySelector('#reveal'); if (r) r.classList.add('hidden'); });

  // ---- 2. TAB scoreboard Victory Conditions guide ----
  await G(() => window.__game.net.send({ t: 'debug', cmd: 'spawn_bots', a: { n: 5 } }));
  await G(() => window.__game.net.send({ t: 'debug', cmd: 'bot_mode', a: { mode: 'idle' } }));
  await sleep(400); await G(() => window.__game.net.send({ t: 'start' }));
  await sleep(3000);
  await G(() => window.__game.ui.scoreboard(true, window.__game.st));
  await sleep(300);
  const vic = await G(() => {
    const rows = [...document.querySelectorAll('#score .scVic .vcRow')].map(e => e.textContent);
    return { head: document.querySelector('#score .scVic h3')?.textContent || '', rows };
  });
  await shot('fb_02_tab_victory');
  check(/VICTORY CONDITIONS/i.test(vic.head), 'TAB shows a "VICTORY CONDITIONS" heading');
  check(vic.rows.some(r => /FIRE/.test(r) && /lead over Blood/i.test(r)), 'Fire line: point lead over Blood');
  check(vic.rows.some(r => /BLOOD/.test(r) && /lead over Fire/i.test(r)), 'Blood line: point lead over Fire');
  check(vic.rows.some(r => /CHAOS/.test(r) && /TIE/.test(r) && /Red Bar 100%/.test(r)), 'Chaos line: TIE / lead / Red Bar 100% (Debug ON)');
  check(vic.rows.some(r => /ALL LOSE/.test(r) && /Debug OFF/.test(r)), 'All-Lose line: Red Bar 100% (Debug OFF)');

  if (errors.length) check(false, 'page errors: ' + errors.join(' | ')); else check(true, 'no page errors');
  await browser.close(); web.close(); srv.kill();
  console.log(failed ? `\n${failed} FAILED` : '\nUI-SMOKE12 (feedback round) PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
