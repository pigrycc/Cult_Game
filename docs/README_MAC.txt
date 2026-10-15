CRYPT OF MINIONS — macOS build (Apple Silicon + Intel, macOS 11 or newer)
=========================================================================

FIRST LAUNCH  (needed once — the app is not notarized by Apple)
  1. Drag "Crypt of Minions.app" to your Applications folder (or anywhere you like).
  2. Double-click it. macOS says it "cannot be opened" / "cannot verify the developer". Then:
       macOS 15 Sequoia and newer:  System Settings → Privacy & Security → scroll down →
                                    "Crypt of Minions was blocked" → [Open Anyway] → confirm.
       macOS 11–14:                 Right-click (or Ctrl-click) the app → Open → Open.
     If macOS says the app is "damaged", it is only the download quarantine flag. Open Terminal and run:
          xattr -dr com.apple.quarantine "/Applications/Crypt of Minions.app"
     (adjust the path if you put the app elsewhere), then open it again.
  3. Allow the prompts that follow:
       • "accept incoming network connections"  – only needed when YOU host a game
       • Local Network access                   – to find/join friends on your LAN
       • Microphone                             – for proximity voice chat (push-to-talk)

HOST A GAME
  Main menu → enter your name → HOST GAME (default port 7777). Friends join with your IP:port.
  Windows and Mac players can play together — it is the same game and network protocol.
  Over the internet: forward TCP port 7777 on your router, or use a VPN such as Tailscale / ZeroTier.

JOIN A GAME
  Main menu → type the host's  ip:port  → JOIN.

HUMANLIKE BOTS
  Debug console → Bot Behaviour → "Humanlike": they fetch tools before using them, think before big decisions
  (slider: "Humanlike reaction delay") and talk — accusations, defences, bluffs.

SOLO TEST WITH BOTS
  Host → in the lobby open the debug console → Spawn Bot Count 4–10 → Apply → [START GAME].

MAC KEYBOARD NOTES
  Debug console:  press the ` (backtick) key — or Fn+F1 (the F-keys are brightness/volume keys by default).
  Fullscreen:     Ctrl+Cmd+F  (menu: View → Enter Full Screen).     Quit: Cmd+Q.
  Mouse look:     click inside the window to capture the mouse, Esc releases it.
  Voice:          hold V (push-to-talk). If the microphone prompt was denied:
                  System Settings → Privacy & Security → Microphone → enable Crypt of Minions.

CONTROLS
  WASD move · Shift run · Space jump / hop off · E use (hold for timed tasks; on a minion: climb on back)
  Q drop · LMB lift / throw / slap · F shove · X buck off a rider · G role card · 1–4 vote crystals
  V push-to-talk · Enter chat · Tab scoreboard · M big map
