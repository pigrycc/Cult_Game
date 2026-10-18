CRYPT OF MINIONS — prototype build (Windows x64)
=================================================

RUN: unzip anywhere, double-click CryptOfMinions.exe. No installer, no extra runtime needed.

HOST A GAME
  1. Main menu → enter your name → HOST GAME (default port 7777).
     Windows Firewall will ask once — allow "CryptOfMinions" on private networks.
  2. Keep "Online: list my lobby in Browse Rooms" ticked to play over the internet: your lobby gets a 6-letter
     ROOM CODE and appears in everybody's Browse Rooms list. LAN friends can still use the address shown
     (e.g. 192.168.0.10:7777).
  3. When 5–11 minions are in the cave, the host presses [START GAME] (the lobby locks).

JOIN A GAME
  Internet: main menu → "Browse rooms" → JOIN next to an open lobby, or type the host's ROOM CODE → JOIN CODE.
    No VPN or port forwarding: players connect to the host peer-to-peer (WebRTC), with a relay fallback for
    strict networks. The list and the connection set-up use free public services (ntfy.sh, PeerJS cloud),
    so an internet connection is required. Rooms leave the list when the match starts.
  LAN: "Host address" = host-ip:port → JOIN.

SIMPLIFIED MODE (host: F1 → 0. Game Mode, lobby only)
  No Mana Crystals and no starting role cards — every finished chore has a chance (debug slider) to give you a
  random role card. Hold Q for 3 s to discard an unused card. All cards are played during the Mutiny Vote.
  At each milestone the Master pulls ONE lever to drop 1 of 3 captives into the abyss, nominates an Executioner,
  and everyone votes APPROVE / MUTINY (strict majority, one vote per milestone). Only 3 curses: Dark Initiation,
  Toxic Fumes, Insight Eye (the Master inspects). Milestone events are off unless enabled in the debug menu.

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
  G  reveal your role card          1–4 vote crystals (Simplified: 1 APPROVE, 2 MUTINY)
  V  mute/unmute (open mic)  N push-to-talk mode   Enter text chat   Tab scoreboard   M big map
  H  call for help on your co-op task (shows it to the whole crew)
  F1 developer debug console

YOUR TASK LIST (Work Phase)
  You get a short PERSONAL list on the HUD: 2 solo chores + 1 co-op chore (with a named partner). Only your own
  tasks show floating world markers, so the crypt isn't cluttered. Finish a solo chore and a new one appears after a
  couple of seconds. A co-op chore names a suggested partner, but ANY two minions who work the station together finish
  it — press H to call the whole crew for help if your partner wanders off.

DEDICATED / HEADLESS HOST (optional)
  dedicated-server.cjs runs with Node.js 20+:  node dedicated-server.cjs 7777 --debug-all
  Players join it normally; the first human to join becomes the host (START button, F1 debug).
