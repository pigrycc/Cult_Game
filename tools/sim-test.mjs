// Headless end-to-end simulation: host client + 8 bots play a full match at ×8 speed.
// Usage: node tools/sim-test.mjs [bots] [timescale]
import WebSocket from 'ws';
import { GameServer } from '../src/server/GameServer.js';

const BOTS = +(process.argv[2] || 8), TS = +(process.argv[3] || 8);
const srv = new GameServer({ port: 7791, hostToken: 'T', log: () => {} });
await srv.start();
const ws = new WebSocket('ws://127.0.0.1:7791');
let me = null, lastPhase = null, lastSub = null, st = null;
const sendJ = o => ws.send(JSON.stringify(o));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
ws.on('open', () => sendJ({ t: 'hello', name: 'Tester', token: 'T' }));
ws.on('message', (d, bin) => {
  if (bin) return;
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') {
    me = m.id;
    sendJ({ t: 'debug', cmd: 'spawn_bots', a: { n: BOTS } });
    sendJ({ t: 'debug', cmd: 'timescale', a: { s: TS } });
    sendJ({ t: 'debug', cmd: 'god_mode', a: { on: true } });
    setTimeout(() => sendJ({ t: 'start' }), 300);
  }
  if (m.t === 'big') log('BIG:', m.text, '|', m.sub?.slice(0, 90));
  if (m.t === 'finale') { log('FINALE winner=', m.winner, m.reason); log('tally', JSON.stringify(m.tally)); finish(0); }
  if (m.t === 'reject') { log('rejected', m.reason); finish(1); }
  if (m.t === 'state') {
    st = m;
    if (m.phase !== lastPhase) { log('PHASE', m.phase, 'players', m.players.length); lastPhase = m.phase; }
    const sub = m.cer?.sub + ':' + m.cer?.mode;
    if (m.cer && sub !== lastSub) { lastSub = sub; log('  CER', sub, 'master', m.masterId, 'exec', m.execId); }
    // the human tester is idle: vote 0, answer nothing; play as a "bot-like" host by letting timeouts run
  }
});
setInterval(() => {
  if (!st) return;
  if (st.phase === 'STATE_GAMEPLAY_WORK') log(`  bars red=${st.bars.red.toFixed(3)} yellow=${st.bars.yellow.toFixed(3)} tasks=${st.tasks.length} npcsAltar=${st.npcs.filter(n => n.state === 'altar').length}`);
}, 2500);
function finish(code) { srv.stop().then(() => process.exit(code)); }
setTimeout(() => { log('TIMEOUT'); finish(2); }, 240000);
