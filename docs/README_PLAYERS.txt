CRYPT OF MINIONS — prototype build (Windows x64)
=================================================

RUN: unzip anywhere, double-click CryptOfMinions.exe. No installer, no extra runtime needed.

HOST A GAME
  1. Main menu → enter your name → HOST GAME (default port 7777).
     Windows Firewall will ask once — allow "CryptOfMinions" on private networks.
  2. The lobby shows your address, e.g. 192.168.0.10:7777. Give it to your friends.
  3. When 5–11 minions are in the cave, the host presses [START GAME] (the lobby locks).

JOIN A GAME
  Main menu → "Host address" = host-ip:port → JOIN.
  Over the internet: the host forwards TCP port 7777 on the router, or everybody uses a
  virtual LAN (Tailscale / ZeroTier / Radmin VPN / Hamachi) and joins the host's VPN IP.

HUMANLIKE BOTS
  Debug console → Bot Behaviour → "Humanlike". They fetch tools from the racks before using them, wait a moment
  before voting / nominating / picking captives / playing role cards (slider: "Humanlike reaction delay"), and they
  TALK: nomination reactions, accusations in the debate, defending themselves and bluffing when it suits them.
  Don't believe everything they say.

PLAY SOLO (bots)
  Host → in the lobby press F1 → "Spawn Bot Count" 4..10 → Apply → [START GAME].
  Bot behaviour (F1): Idle / Random Task Roamer / Ceremony Auto-Voter.

CONTROLS
  Click the window to capture the mouse (Esc frees it).   F11 fullscreen.
  WASD move · Shift run · Space jump / hop off a back
  E  use / HOLD for timed tasks (on a minion: climb on its back)
  Q  drop held tool/item          LMB  lift / place / throw captives, slap, nominate
  F  shove                         X    buck the minion riding you (they spill half their gold)
  G  reveal your role card          1–4 vote crystals in a rebellion
  V  push-to-talk voice             Enter text chat     Tab scoreboard    M big map
  F1 developer debug console

DEDICATED / HEADLESS HOST (optional)
  dedicated-server.cjs runs with Node.js 20+:  node dedicated-server.cjs 7777 --debug-all
  Players join it normally; the first human to join becomes the host (START button, F1 debug).
