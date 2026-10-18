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

TASK MINIGAMES (new)
  Many chores open a quick 2D minigame when you press E (with the right tool, if one is needed):
    • Scrub (Clean Soot, Sweep Glass, Mop Lard, Polish Runic Tablet [Rag]) — hold LMB and wipe the grime until ~90% clear.
    • Catch (Drain Condensate [Bucket]) — slide the bucket to catch falling drips.
    • De-rust (Oil Mechanisms [Oil Can]) — click-hold each rusted gear for 2 s.
    • Whack (Forge Wedges [Hammer], Chop Meat [Cleaver]) — click each glowing target as it pops up.
    • Grind (Sharpen Blades [Dull Blade]) — hold to grind, RELEASE inside the green sweet spot.
    • Mix (Distill Acid) — pour 3 base colours to match the target shade.
    • Simon (Flush Research Machine) — repeat the flashed colour sequence over 3 rounds.
    • Pour (Add Oil to Lamps) — hold to fill into the green band and release (overflow resets).
    • Plunge (Unclog Chute [Gaff]) — shove the hook up and down with the mouse.
    • Gauges (Equalize Pressure) — click each gauge while its needle is in the red zone.
  Sorting chores (Replace Altar Candles, Sort Glowing Specimens, Sort Scrap Metal) — carry each item from its crate to a
  glowing slot (E). New tools: Rag, Drain Bucket, Dull Ceremonial Blade, Butcher Cleaver.
  Co-op: the Bookshelf Ladder is now a stacking task (one minion rides another's back to reach the high shelf).

DEBUG: CURSE ODDS (host, F1 → Ceremony & Altar → "Curse spawn odds")
  A slider per curse glyph sets its relative spawn weight (0 = never). Tilt the odds to test a specific curse, or
  "Uniform" to reset. Only curses in the active pool can appear (Simplified Mode uses its 3; extended curses need their toggle).

DEDICATED / HEADLESS HOST (optional)
  dedicated-server.cjs runs with Node.js 20+:  node dedicated-server.cjs 7777 --debug-all
  Players join it normally; the first human to join becomes the host (START button, F1 debug).
