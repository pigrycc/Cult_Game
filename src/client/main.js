// Client bootstrap: main menu → connect (host or join) → wire network handlers → render loop.
import { Net } from './net.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { DebugMenu } from './debug.js';
import { ROLE_BY_ID } from '../shared/constants.js';

const ui = new UI();
const audio = new Audio();
let game = null;

async function connect(url, name, token) {
  const net = new Net();
  ui.menuError('Connecting to ' + url + ' …');
  let welcome;
  try { welcome = await net.connect(url, { t: 'hello', name, token }); }
  catch (e) { ui.menuError(e.message); return; }
  audio.ensure();
  ui.hideMenu();
  game = new Game({ net, ui, audio, myId: welcome.id });
  game.debug = new DebugMenu(net);
  game.debug.aimTarget = () => game.target?.id;
  window.__game = game; // exposed for automated smoke tests
  const H = {
    state: m => game.onState(m),
    snap: m => game.onSnap(m),
    toast: m => ui.toast(m.text, m.kind),
    big: m => ui.big(m.text, m.sub, m.dur, m.color),
    fx: m => game.onFx(m),
    chat: m => ui.chat(m, welcome.id),
    label: m => ui.label(m.id, m.text, m.color, m.dur),
    roleRevealed: m => { const r = ROLE_BY_ID[m.roleId]; ui.toast(`🔔 ${m.name} revealed ${r.icon} ${r.name}!`, 'role'); audio.sfx('chime'); },
    recipe: m => ui.recipeCard(m),
    calibUI: m => ui.calib(m, amounts => net.send({ t: 'calib', uid: m.uid, amounts })),
    runesUI: m => ui.runes(m, choice => net.send({ t: 'runes', uid: m.uid, choice })),
    spyhole: m => ui.spyhole(m),
    fanaticalOffer: m => ui.fanatical(m, accept => net.send({ t: 'fanatical', accept })),
    converted: m => ui.big('🔮 You have been initiated', `You now secretly serve the Cult of Chaos. Your leader: ${m.leader}`, 5, '#b06bff'),
    finale: m => { document.exitPointerLock(); ui.finale(m, game.st?.you.host, () => net.send({ t: 'lobby' })); },
    teleport: m => game.onTeleport(m),
    coins: m => { audio.sfx('coins'); ui.toast(`+${m.amount} 💰`, 'gold'); },
    reveal: m => { document.exitPointerLock(); ui.showReveal(m, () => ui.big('Click to enter the crypt', 'WASD move • E use/hold • LMB lift/slap • G role card • V talk • Enter chat • Tab board • F1 debug', 5, '#ffe28a')); },
    roleChanged: m => ui.toast(`🛠 Your role is now ${ROLE_BY_ID[m.roleId].name}`),
  };
  for (const [k, fn] of Object.entries(H)) net.on(k, fn);
  net.onVoice = buf => audio.playVoice(buf);
  audio.onFrame = buf => net.sendBinary(buf);
  net.onClose = () => { ui.toast('Disconnected from host.', 'warn'); setTimeout(() => location.reload(), 2500); };
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.136, (now - last) / 1000); last = now;
    try { game.frame(dt); } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const params = new URLSearchParams(location.search);
ui.showMenu({
  electron: !!window.cryptHost,
  onHost: async ({ name, port, debugAll }) => {
    try {
      const r = await window.cryptHost.start({ port, debugAll });
      if (r.error) return ui.menuError(r.error);
      connect(`ws://127.0.0.1:${r.port}`, name, r.token);
    } catch (e) { ui.menuError(String(e)); }
  },
  onJoin: ({ name, addr }) => connect(`ws://${addr.replace(/^ws:\/\//, '')}`, name, params.get('token') || undefined),
});
if (params.get('join')) connect(`ws://${params.get('join')}`, params.get('name') || 'Tester', params.get('token') || undefined);
