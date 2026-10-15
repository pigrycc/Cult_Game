// Voice-activity detection + noise gate for the open microphone. Pure logic (no DOM / WebAudio) so it is unit-tested.
//   • adaptive noise floor: learned while the gate is closed, so a noisy room / fan does not keep the mic open
//   • opens after `openFrames` consecutive loud frames (clicks and bumps are shorter), then replays the pre-roll so
//     the first syllable is not clipped; stays open for `hangMs` after the last loud frame
export class VoiceGate {
  constructor({ minOpen = 0.018, ratio = 3.2, closeRatio = 0.7, openFrames = 2, hangMs = 380, preroll = 2 } = {}) {
    Object.assign(this, { minOpen, ratio, closeRatio, openFrames, hangMs, preroll });
    this.floor = 0.004; this.open = false; this.loud = 0; this.hang = 0; this.pre = [];
  }
  get openThreshold() { return Math.max(this.minOpen, this.floor * this.ratio); }
  /** @param rms frame level 0..1  @param ms frame duration  @param frame opaque payload (e.g. an Int16Array)
   *  @returns the frames to transmit now ([] while closed) */
  push(rms, ms, frame) {
    const thr = this.openThreshold;
    // minimum-follower floor: drops at once when it gets quieter, creeps up (~30 s) under CONSTANT noise such as a fan,
    // so a permanently loud room stops counting as speech while talking with pauses does not raise it much
    if (rms > this.floor) this.floor = Math.min(0.05, this.floor + (rms - this.floor) * 0.0015);
    if (!this.open) {
      this.pre.push(frame); if (this.pre.length > this.preroll + this.openFrames) this.pre.shift();
      if (rms >= thr) this.loud++; else { this.loud = 0; this.floor = this.floor * 0.93 + rms * 0.07; }
      if (this.loud >= this.openFrames) { this.open = true; this.hang = this.hangMs; const out = this.pre; this.pre = []; return out; }
      return [];
    }
    if (rms >= thr * this.closeRatio) this.hang = this.hangMs; else this.hang -= ms;
    if (this.hang <= 0) { this.open = false; this.loud = 0; this.pre = []; return []; }
    return [frame];
  }
  reset() { this.open = false; this.loud = 0; this.hang = 0; this.pre = []; }
}
