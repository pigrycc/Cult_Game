// ============================================================================
//  Countdown — turns authoritative "seconds left" samples (10 Hz) into one callback per
//  whole second for the LAST 5 SECONDS of a timed window: onTick(5) … onTick(1), then onTick(0).
//
//  • sample(key, t, now, rate)  – feed what the host reports. `key` identifies the window
//                                  (null/undefined = no countdown active). `rate` = sim speed.
//  • update(now)                – call every frame; interpolates between samples so ticks land
//                                  on the second boundary instead of on packet arrival.
//  A window that is cut short (e.g. the vote closes early because everybody has voted) is
//  detected as a discontinuity and does NOT replay skipped ticks or the final tone.
//  Pure logic (no DOM / audio) so it can be unit tested in Node.
// ============================================================================
export class Countdown {
  constructor(onTick) { this.onTick = onTick; this.reset(); }

  reset() { this.key = null; this.rem = 0; this.at = 0; this.rate = 1; this.lastWhole = null; this.done = false; this.lastT = 0; this.lastSrv = null; }

  static whole(rem) { return Math.ceil(rem - 1e-9); }

  remaining(now) { return this.rem - ((now - this.at) / 1000) * this.rate; }

  /** The window we were counting reached its end by itself (not cut short) → play the time's-up tone. */
  finishIfExpired(now) {
    if (this.key != null && !this.done && this.remaining(now) < 0.6) { this.done = true; this.onTick(0); }
  }

  /**
   * @param key     identifies the timed window (null = none active)
   * @param t       seconds left, as reported by the host (sim seconds)
   * @param now     client clock (ms) – only used to interpolate between packets
   * @param rate    sim seconds per real second (host time scale)
   * @param srv     host sim clock at the time of the sample. Used to tell a genuine jump of the
   *                timer (early close, extension) from client-side lag: stalled frames or batched
   *                packets can't fake a discontinuity because both clocks come from the host.
   */
  sample(key, t, now, rate = 1, srv = null) {
    if (key == null || t == null || !isFinite(t)) { this.finishIfExpired(now); this.reset(); return; }
    if (key !== this.key) {                          // a new timed window begins
      this.finishIfExpired(now);                     // …and the previous one ran out: play its final tone now
      this.key = key; this.rem = t; this.at = now; this.rate = rate; this.lastWhole = null; this.done = false; this.lastT = t; this.lastSrv = srv;
      return;
    }
    const expected = (srv != null && this.lastSrv != null) ? this.lastT - (srv - this.lastSrv) : this.remaining(now);
    if (Math.abs(expected - t) > 0.35) {             // the host moved the clock (early close / extension / debug)
      this.lastWhole = Countdown.whole(t);
      if (t < expected) this.done = true;            // shortened → no "time's up" tone, no replay of skipped ticks
    }
    this.rem = t; this.at = now; this.rate = rate; this.lastT = t; this.lastSrv = srv;
  }

  update(now) {
    if (this.key == null) return;
    const rem = this.remaining(now);
    if (rem <= 0) {
      if (!this.done) { this.done = true; this.lastWhole = 0; this.onTick(0); }
      return;
    }
    if (this.done) return;
    const w = Countdown.whole(rem);
    if (w > 5) { this.lastWhole = w; return; }
    if (this.lastWhole === null || w < this.lastWhole) { this.lastWhole = w; this.onTick(w); }
  }
}

/** Which timed window (if any) the current host state exposes, and how many sim-seconds are left. */
export function countdownSources(st, subsWithTimer) {
  const out = { window: null, collapse: null };
  const c = st.cer;
  if (c && subsWithTimer.has(c.sub) && !c.infinite) out.window = { key: `cer:${c.seq}`, t: c.t };
  else if (!c && st.spy?.active && st.spy.id === st.you.id) out.window = { key: `spy:${st.spy.n}`, t: st.spy.t };
  if (st.phase === 'STATE_GAMEPLAY_WORK' && st.bars.eta != null) out.collapse = { key: `work:${st.bars.reached}`, t: st.bars.eta };
  return out;
}
