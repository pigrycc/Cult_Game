# Crypt of Minions — System Architecture

## 1. Topology (host-authoritative client/server)

```
┌──────────────── Host PC (CryptOfMinions.exe) ────────────────┐
│ Electron main process                                         │
│  └─ GameServer (ws, port 7777) ── Match (authoritative sim)   │
│        ▲ 60 Hz tick: physics, bars, tasks, NPCs, ceremony     │
│        │ 30 Hz "snap" (transforms)  10 Hz "state" (FILTERED)  │
│ Renderer process (three.js client) ── ws://127.0.0.1:7777     │
└────────────────────────────────────────────────────────────────┘
          ▲ ws://host-ip:7777           ▲
   Client PC (same exe → JOIN)    Client PC …   (5–11 players total)
```

* The host runs the **same exe**; the server lives in the Electron main process, the host's own
  renderer connects to it over loopback with a random **host token** (grants START / debug).
* `dist/server.cjs` is the same server as a headless dedicated host (`node server.cjs 7777`).
* **Mutiny winner:** the new Master is the rebel with the highest *effective* contribution (crystals × Instigator doubling, Pacifier = 0); only an exact tie of effective totals is drawn by lot.
* **Source of truth:** role/faction deal, NPC glyphs, crystals, bars, task validation, gates and
  ceremony resolution exist only on the host. `GameServer.stateFor(viewer)` builds a
  per-viewer packet: other players' factions, roles and NPC glyphs are only included when the
  viewer is entitled to them (Blood Pact, inspection, role reveal, glyph authorisation, God Mode).
  A client memory dump therefore can't reveal hidden information.

## 2. Movement sync
* Client samples input each frame (sub-stepped to ≤33 ms), predicts locally with the shared
  deterministic controller `shared/physics.js`, batches frames `{seq,dt,fwd,strafe,yaw,pitch,jump,sprint}`
  at 30 Hz.
* Host re-simulates every frame with the same code (dt clamped to 50 ms → no speed hacks) and
  returns `snap.me` + `ack`. Client rewinds to the authoritative state, replays unacked frames
  and smooths the correction (exponential visual offset).
* Remote minions are rendered 100 ms in the past, interpolated between 30 Hz snapshots.
* Ragdoll, carried, riding and frozen states are host-driven flags; the client stops predicting
  while locked and follows the snapshot.

## 3. Game State Machine (`server/Match.js`, `server/Ceremony.js`)

| Phase | Entry | Exit |
|---|---|---|
| `LOBBY` | server start / "return to lobby" | host START with ≥5 → `LOBBY_LOCKED`, deal |
| `STATE_REVEAL_SCREEN` | deal factions (table §7.1), unique roles 1–21, random Master | 5 s back + 5 s front |
| `STATE_GAMEPLAY_WORK` | teleport, 3 captives seated, task pool filled, Red Bar running | Yellow hits milestone → CEREMONY · Red hits it first → FINALE (everyone loses) |
| `STATE_CEREMONY` | Red frozen, barriers up | debate timer ends → WORK; FINAL milestone, Chaos-Leader living sacrifice, or mathematical sudden death (checked only after the Living Sacrifice outcome: Fire/Blood lead > every rival + remaining sacrifices) → FINALE |
| `STATE_FINALE` | winner by altar majority, tie → Chaos | host → LOBBY (`Match.resetPlayerState` purges every status effect, overlay flag, carry/ride/shove state, card, crystals and private knowledge; players who left mid-match are dropped) |

Ceremony sub-states: `ANNOUNCE (3 s) → NOMINATE → VOTE → COUNT → REACTION → RESULT → (success → NOMINATE again | fail → EXECUTION) → RESULT → CURSE → RESULT → EVENT → RESULT → DEBATE`.
`RESULT` is the phase-transition buffer (`timers.phaseTransitionBufferSeconds`, default 3 s, 0 = skip): an outcome card (rebellion result, sacrifice + curse + crystal changes, milestone-event resolution) shown to everyone before the next step.
Freezing / blinding per sub-state is centralised in `Ceremony.applyFreeze()`.

## 4. Subsystems

| Module | Responsibility |
|---|---|
| `ProgressBars` | Red `+X every T` (X auto = segment·T/workTime), Yellow `+segment/requiredTasks` per task, milestone markers k/M |
| `TaskManager` | 32 tasks / 7 rooms, 12 mechanics (hold, fetch, books, coop, bell, bellows, carry, relay, carcass, stack, calib, runes), tools, items, coins, steam geysers, lard slips, cold-room door & bolt |
| `NpcSystem` | captive pool (every captive rolls a faction AND a mandatory curse: Mana Boost, Mana Drain, Toxic Fumes, Insight Eye, Gagging Seal; debug toggle adds Call of the Abyss / Dark Initiation), Selection Chamber, altar, Prison, glyph authorisation (fog of war), spyhole |
| `Ceremony` | nomination, mutiny resolution, execution, curses, milestone events, debate, exhaustion |
| `Roles` | 21 card abilities with timing windows + target validation, `roleRevealed` broadcast |
| `BotChat` | Humanlike-only banter: nomination reactions by faction knowledge, Executioner announcements and bluffs (lies only about hidden information — the rejected captive / which side — never about publicly revealed facts), debate suspicion from observed behaviour (`player.obs`: idle time, abandoned tasks, finished tasks), self-defence when named. Rate-limited, de-duplicated, every line audited in `log` with a `lie` flag |
| `Bots` | FSM bots (idle / roamer / voter / humanlike) with A* over a nav-node graph and thematic names; always perform Master/Executioner duties. Humanlike bots reason with their legitimate knowledge (Blood Pact, inspections, flogging) to vote, pick captives/executioners/victims and play role cards |
| `Debug` | every Dev-Console command, host-authorised |
| `GameServer` | transport, per-viewer filtering, voice routing |

## 5. Packets

Client → host (JSON):
```
hello {name, token?}          input {f:[{seq,dt,fwd,strafe,yaw,pitch,jump,sprint}]}
use {target}  release  lmb {target?}  drop  shove {target}  buck  color {color}  start
vote {amount 0..3}  ability {targets:[playerId]}  fanatical {accept}
calib {uid, amounts[3]}  runes {uid, choice}  chat {text}  debug {cmd, a}  lobby  ping {c}
```
Target ids: `task:<uid>:<part>`, `tool:<id>`, `item:<id>`, `coin:<id>`, `npc:<id>`, `player:<id>`, `mirror`, `spyhole`, `bolt`, `door_out`, `door_in`.

Host → client (JSON):
```
welcome {id, hostId}   reject {reason}   phase {phase}   teleport {x,z,yaw}
snap  {ack, me:[x,y,z,vx,vy,vz,onGround,ragdoll], p:[[id,x,y,z,yaw,pitch,rag,spin,flags,speed]], c:[[taskUid,x,z]], bk:[[itemId,x,y,z]]}
state {phase, you{private}, players[ filtered ], gates{per viewer}, bars, track, tasks, world, npcs[ filtered ], spy, cer, tally, balance, lobby, log, dbg?}
reveal {faction, roleId, back, front}      roleRevealed {id, roleId, name}   ← RPC_BroadcastRoleRevealed
toast | big | fx | chat {from,name,text,ch} | label {id,text,color,dur} | coins | finale {winner, reason, tally, reveal[], log[]}
recipe | calibUI | runesUI | spyhole {list} | fanaticalOffer | converted
holdEnd {reason: 'done'|'cancel', target}
errorFlash {text}  ← buzzer + red banner (e.g. nominating an exhausted minion)
big.avatars [{name,color}]  ← coloured minion portraits on banners (2 = nominator ➜ nominee); fx 'appoint' {id, office} = pillar of light + herald   ← drives the hold-meter success / cancel feedback
```
`flags` bits: 1 frozen · 2 carried · 4 riding · 8 ghost · 16 working · 32 grounded.

Voice (binary): client → host = Int16 PCM, 16 kHz mono. Host → listener = `[speakerId u8][gain u8][flags u8][PCM]`;
gain = proximity falloff (20 m) × 0.3^(walls between) or intercom pipe path, global (1.0) outside the Work Phase;
muted / gagged speakers are dropped; flag 1 = Toxic Fumes (client garbles pitch + distortion), flag 2 = intercom (band-pass "tinny pipe").

## 5a. Bot task realism
Humanlike bots perform chores with the same validated server actions as players (`TaskManager.use`): walk to the rack, pick up the tool (`tool:` target), walk to the task, hold. The server's own tool check is the barrier. Supported mechanics: hold, fetch, runes, coop (waits up to 24 s for a partner and asks for help in chat). Carry, bell, bellows, stack, relay, carcass, calib and books need choreography and are left to players. Roamer bots (fast test mode) keep a timer but it only runs while the required tool is in hand (`botMayWork` / `botComplete`). Reaction time before votes, nominations, captive choice and role cards = `dbg.botDecisionDelaySeconds` ±33 % (default 2.25 s; 0 = instant).

## 5b. Countdown audio (last 5 s)
`client/countdown.js` turns the host's "seconds left" samples into one cue per second: 5 → 1 escalating ticks, 0 = time's-up thud (`Audio.countdown`). It is driven by its own 40 ms timer, interpolates between 10 Hz packets, and uses the host's sim clock (`state.time`, `state.ts`) to tell a real jump (vote closed early → silent, extended window → restarts) from client lag.
Sources: every timed ceremony window (`cer.seq` identifies it: nomination, mutiny vote, reaction, execution, interactive curse/event, debate), the Oubliette Spy window, and the Work-Phase collapse clock `bars.eta` = seconds until the Red Bar reaches the next milestone (`ProgressBars.collapseEta`, accurate to the discrete tick phase). Infinite debate and frozen Red Bar have no countdown.

## 6. Fog-of-War rules (where enforced)
* Faction icons: `stateFor` – `pact` only between dealt Blood cultists; `known` only from the viewer's private
  knowledge map (Robe Inspection, Eye of Truth, Chaos pair); `faction` for self or God Mode.
* Role icon: sent only after `roleRevealed` (or self / God Mode). Used card state public afterwards.
* NPC glyph: `NpcSystem.authorized()` – Master inside the Selection Chamber, Executioner during execution,
  Spy's single peek, Prison key holders, spyhole (executioner rejects), sacrificed (public), God Mode.
  Everybody else receives the captive without `faction/curse` → "[Unknown Captive]".
