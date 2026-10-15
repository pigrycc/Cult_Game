// Open-mic voice activity detection / noise gate + server-side silencing.
import { VoiceGate } from '../src/client/vad.js';
import { Match } from '../src/server/Match.js';
import { GameServer } from '../src/server/GameServer.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const MS = 42.7;
const run = (g, levels) => levels.map((l, i) => g.push(l, MS, i).length);

{ const g = new VoiceGate(); const out = run(g, Array(100).fill(0.003)); ok(out.every(n => n === 0) && !g.open, 'silence never transmits'); }
{ const g = new VoiceGate(); const out = run(g, Array(300).fill(0.012)); ok(out.every(n => n === 0), 'steady background hiss/static below the gate never transmits'); }
{ const g = new VoiceGate(); run(g, Array(50).fill(0.012));
  const o = run(g, [0.4, 0.003, 0.003, 0.003, 0.003]); ok(!g.open && o.every(n => n === 0), 'a single loud click / bump does not open the mic'); }
{ const g = new VoiceGate(); run(g, Array(20).fill(0.004));
  const sent = []; for (let i = 0; i < 12; i++) sent.push(...g.push(0.2, MS, 'v' + i));
  ok(g.open && sent.includes('v0') && sent.indexOf('v0') <= 2, 'speech opens the mic with no keypress, and the pre-roll keeps the first syllable'); ok(sent.filter(x => typeof x === 'string').length === 12 && new Set(sent).size === sent.length, 'every speech frame is transmitted exactly once'); }
{ const g = new VoiceGate(); run(g, Array(20).fill(0.004)); run(g, Array(10).fill(0.2));
  const gap = run(g, Array(4).fill(0.002)); ok(g.open && gap.every(n => n === 1), 'short pauses between words keep the mic open (hang time)');
  const tail = run(g, Array(20).fill(0.002)); ok(!g.open && tail.slice(-3).every(n => n === 0), 'mic closes again after the speaker stops → icon disappears'); }
{ const g = new VoiceGate(); run(g, Array(1500).fill(0.03));            // loud room: floor learns, threshold rises
  ok(g.openThreshold > 0.03, `noise floor adapts to a noisy room (threshold ${g.openThreshold.toFixed(3)})`);
  const o = run(g, Array(60).fill(0.03)); ok(o.every(n => n === 0), 'constant room noise stays gated'); 
  const sp = run(g, Array(6).fill(0.35)); ok(sp.some(n => n > 0), 'but real speech above the noise still opens it'); }

// ---- server: muted / gagged speakers are dropped and never flagged as talking
{ const sent = []; const m = new Match({ send: () => {} }); const ids = [];
  for (let i = 0; i < 5; i++) ids.push(m.addPlayer({ name: 'P' + i, isHost: i === 0 }).id);
  for (const id of ids) m.P(id).isBot = false; m.startGame(ids[0]); m.phaseT = 0; m.tick(0.016);
  const gs = Object.create(GameServer.prototype); gs.match = m;
  gs.conns = new Map(ids.map(id => [id, { readyState: 1, pid: id, send: b => sent.push([id, b]) }]));
  const buf = Buffer.alloc(100, 1);
  const a = m.P(ids[1]); a.body.x = 0; a.body.z = 0; for (const id of ids) { m.P(id).body.x = 0.5; m.P(id).body.z = 0.5; } a.body.x = 0; a.body.z = 0;
  m.time = 50; gs.onVoice({ pid: a.id }, buf);
  ok(sent.length > 0 && a.lastVoice === 50, 'a normal speaker is relayed and flagged talking (🔊)');
  sent.length = 0; a.lastVoice = 0; a.gagged = true; gs.onVoice({ pid: a.id }, buf); ok(sent.length === 0 && a.lastVoice === 0, 'Gagging Seal: nothing relayed, no speaker icon');
  a.gagged = false; a.muted = true; gs.onVoice({ pid: a.id }, buf); ok(sent.length === 0 && a.lastVoice === 0, 'Curse of Silence: nothing relayed, no speaker icon'); }
console.log(fails ? `\n${fails} FAILED` : '\nVOICE TESTS PASSED'); process.exit(fails ? 1 : 0);
