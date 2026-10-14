# Implementation Guide

## 0. Build & run
```bash
npm install
node build.mjs              # → dist/ (client bundle, electron main/preload, dedicated server)
npx electron dist/main.cjs  # run the desktop build on your machine (needs a display)
node build.mjs --package    # → release/CryptOfMinions-win32-x64.zip (portable .exe)
node tools/sim-test.mjs 8 8 # headless: host + 8 bots play a full match at ×8 speed
node dist/server.cjs 7777   # dedicated host
```
Everything is plain ES modules; `shared/` is imported by both the server and the client, so rules,
geometry and physics never drift apart.

## 1. Physics colliders (`src/shared/map.js`, `src/shared/physics.js`)
1. **Walls** are thick line segments `{x1,z1,x2,z2,t,h}`. Rooms are created with
   `rectRoom(x0,x1,z0,z1,{N|S|E|W:[[from,to]]})` — every gap is a doorway. The circular sanctuary is a
   28-segment polygon with four cardinal openings computed from the corridor half-width.
2. **Boxes** (`box(x,z,w,d,h,mat,{deco})`) are axis-aligned solids; boxes ≤1.3 m are standable
   (tables, anvil). `deco` selects the visual prop builder in `client/world.js`.
3. **Circles** — the portal (r 2.25) and dynamic extras.
4. **Gates** (`GATES`) are segments whose solidity is decided per player every step by
   `Match.gateClosedFor(player, id)` (Selection-Chamber grate: Master / Spy only; Prison bars: key
   holders; cold-room door: open while someone holds its handle and it isn't bolted; sanctuary
   barriers: closed during ceremonies). The client receives its own gate map for prediction.
5. The controller is a capsule (r 0.38) pushed out of segments/boxes in two passes; gravity 18,
   jump 5.6, walk 4.3 / run 6.6 m/s. Heavy items, carry handles and a rider scale `speedMul`.
6. **Ragdoll** = `body.ragdoll > 0`: no input, ballistic knock-back with ground friction, bounce off
   walls; the client rig tumbles by travelled distance and flails its limbs (`animateMinion`).
   Triggers: shove (F/LMB), steam geysers, bell shockwave, lard while running, biting books,
   being bucked off a back, Toxic Fumes stumbles, debug.

To add a room: add a `rectRoom` (+ door gaps in the neighbour), a `ROOMS` entry, torches in
`world.js`, nav nodes/edges for bots, then tasks referencing the room key.

## 2. Interaction triggers
* Every interactable is a point: tasks expose `TaskManager.points(inst)`; tools/items/coins/NPCs/
  players/static props are added in `Game.candidates()`.
* Client targeting = smallest angular distance from the crosshair inside the point's range with no
  wall in between. `E` sends `use`, releasing `E` sends `release`; `LMB` sends `lmb` with the target.
* The host re-validates everything (`TaskManager.inRange`, tool requirement, occupancy, phase).
  Timed actions are `player.hold = {target, need, onDone}` advanced in `TaskManager.tick`;
  co-op handles are holds with `need = Infinity` whose simultaneous occupancy drives progress.
* Adding a task: append to `shared/tasks.js` with a supported `mech` and positions; it automatically
  appears in the pool, task board, markers, minimap, bots and the debug spawner.

## 3. UI overlays (`src/client/ui.js`, `style.css`)
* DOM over the WebGL canvas; `#ui` is `pointer-events:none`, only panels accept clicks.
* `updateHud(state)` (10 Hz): dual progress bar (Yellow layer, thin Red layer, milestone markers
  with event icons), task board, lobby counter `PLAYERS: X / 11 (MIN. 5)` + START, role card with
  usable glow, statuses, ceremony panel (vote buttons, sequential crystal counter vs threshold).
* Per frame: crosshair prompt, hold meter (radial dial + bar under the reticle, predicted locally from the point's `need`, reconciled with the host; `holdEnd` plays the done / cancel flash and sound; releasing E early cancels), NPC glyph tooltip (<2 m, SVG colour = faction,
  shape = curse), nameplates projected from 3D (white by default; 🩸 pact, inspected icons,
  public role icons, status icons, speech bubbles) with distance LOD — beyond 3 m only the role icon floats above the name; under 3 m with the crosshair on the minion the plate expands into a card with role name, description, card status and the faction *only if revealed to you*, blind/drunk/ghost overlays.
* Reveal screen: CSS 3D card flip with faction glow, 5 s + 5 s timers.
* FPP viewmodel is a second scene rendered after clearing depth, so oversized tools never clip.

## 4. Balance hooks
`shared/constants.js → BALANCE` holds faction mix, milestone count, task pool, required tasks,
debate seconds, mutiny threshold, work-phase length and exhaustion count per player count;
`MILESTONE_TRACKS` holds the 5/6/7 event tracks; `DEFAULT_TIMERS` every ceremony timer.

## 4b. Automated checks
`npm run test:rules` (103 rule assertions incl. lobby purge, effective-crystal tie-break, countdown logic, ETA accuracy) · `node tools/bot-master-test.mjs` (Master bots fetch two captives) · `npm run test:sim` (full bot match) · `tools/ui-smoke*.cjs` (headless-Chromium UI checks; need `PLAYWRIGHT_MODULE` and `CHROME_PATH`).

## 5. Testing checklist (solo, with the F1 console)
1. Lobby → spawn 6 bots → START. Card back → flip → FPP.
2. `Freeze Red Bar`, walk the wings, do tasks; co-op tasks with bots in **Idle** mode as partners for
   stacking (`E` on a bot to climb).
3. `Instant Fill` → ceremony: nominate with LMB, vote 1–4, watch the counter; `Force Milestone Event`
   and `Configure Selection Chamber NPCs` (e.g. Toxic Fumes) to test each branch.
4. `Force Role` 1–21 + `Reset Role Cooldown` to test every card in its window.
5. Section **7. Timers** overrides every countdown (reveal back/front, work-phase pace, nomination, mutiny voting, reaction, execution, events, debate, hold-time multiplier, `phaseTransitionBufferSeconds`); `Skip transition buffers` sets the outcome-card pause to 0.
6. Debug settings are saved in localStorage and re-applied automatically when you host again (section 8 lists / clears them). Also: bot movement speed, disable sprint, shove coin drop %, Humanlike bot mode.
7. `Override Altar Tally` 2/2/1 before the last milestone → tie → Chaos win. `Trigger Crypt Explosion` → loss screen.
