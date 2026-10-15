// Debug overrides that change HOW LONG a match lasts (or whether it can end at all).
// Because debug settings are saved between sessions, a forgotten one makes a game look "hung" — so the host sees a warning.
// Pure function (no DOM) so it is unit-tested.
export function matchAffectingOverrides(d = {}) {
  const out = [];
  if (d.freezeRed) out.push({ key: 'freezeRed', label: '❄ Red Bar frozen' });
  if (d.debateInfinite) out.push({ key: 'debateInfinite', label: '∞ endless debate (press “End Debate”)' });
  if (d.timeScale != null && Math.abs(d.timeScale - 1) > 0.01) out.push({ key: 'timeScale', label: `⏱ game speed ×${+(+d.timeScale).toFixed(2)}${d.timeScale < 1 ? ' (slow-motion!)' : ''}` });
  if (d.yellowMul != null && Math.abs(d.yellowMul - 1) > 0.01) out.push({ key: 'yellowMul', label: `📈 task reward ×${d.yellowMul}${d.yellowMul === 0 ? ' (progress impossible!)' : ''}` });
  if (d.maxConcurrent != null) out.push({ key: 'maxConcurrent', label: `📋 max ${d.maxConcurrent} task(s) on the board` });
  if (d.workSec != null) out.push({ key: 'workSec', label: `🛠 work phase pace ${d.workSec}s` });
  if (d.holdMul != null && Math.abs(d.holdMul - 1) > 0.01) out.push({ key: 'holdMul', label: `✋ hold time ×${d.holdMul}` });
  if (d.redX != null) out.push({ key: 'redX', label: '🔴 custom Red Bar tick' });
  return out;
}

/** Saved-settings keys (see debug.js) that must be cleared together with the live overrides. */
export function clearSavedMatchOverrides(saved) {
  for (const k of ['freeze_red', 'debate_timer', 'yellow_mul', 'timescale', 'max_concurrent', 'red_tick']) delete saved[k];
  if (saved.set_timers) { for (const k of ['workSec', 'holdMul', 'debateSec']) delete saved.set_timers[k]; }
  return saved;
}
