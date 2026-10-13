# Crypt of Minions (prototype)

3D first-person social deduction × physics slapstick co-op for 5–11 hooded minions
(Feed-the-Kraken politics + Overcooked / Lethal Company chores), host-authoritative multiplayer.

* **Play:** download `CryptOfMinions-win32-x64.zip` from the [latest GitHub Release](https://github.com/pigrycc/Cult_Game/releases/latest), unzip, run `CryptOfMinions.exe`.
  Player instructions: [`docs/README_PLAYERS.txt`](docs/README_PLAYERS.txt).
* **Architecture & packets:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
* **Implementation guide (colliders, triggers, UI, testing):** [`docs/IMPLEMENTATION_GUIDE.md`](docs/IMPLEMENTATION_GUIDE.md)

```
src/shared/   constants (factions, 21 roles, curses, balance tables), map blueprint, physics, task catalog
src/server/   GameServer (ws + per-viewer filtering + voice), Match (state machine), ProgressBars,
              TaskManager, NpcSystem, Ceremony, Roles, Bots, Debug
src/client/   three.js renderer, prediction, HUD, debug console, audio/VOIP
src/main/     Electron shell embedding the host server
tools/        sim-test.mjs (headless full match), browser smoke tests
```

Tech: Electron 33 · three.js · ws · esbuild. Build with `npm install && node build.mjs --package`.
