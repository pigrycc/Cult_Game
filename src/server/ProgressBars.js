// ============================================================================
//  DUAL PROGRESS BAR
//   Red  (Crypt Destabilization): +X every T seconds while in the Work Phase.
//   Yellow (Work Stabilization):  + (segment / requiredTasks) per finished task.
//   Milestones at k/M. Red reaching the next milestone first = crypt explodes.
//   Yellow reaching it first = Red freezes, Ceremony begins.
// ============================================================================
export class ProgressBars {
  constructor(match) { this.m = match; this.reset(5); }

  reset(milestones) {
    this.M = milestones;
    this.red = 0; this.yellow = 0;
    this.reached = 0;          // milestones already reached by yellow
    this.acc = 0;
    this.running = false;
  }

  get segment() { return 1 / this.M; }
  get next() { return Math.min(1, (this.reached + 1) / this.M); }
  markers() { return Array.from({ length: this.M }, (_, i) => (i + 1) / this.M); }

  /** Red increment X per tick of T seconds. Default sized so Red needs ≈ one Work Phase per segment. */
  get tickT() { return this.m.dbg.redT; }
  get tickX() {
    if (this.m.dbg.redX != null) return this.m.dbg.redX;
    return this.segment * this.tickT / this.m.balance.work;
  }

  tick(dt) {
    if (!this.running || this.m.dbg.freezeRed) return;
    this.acc += dt;
    while (this.acc >= this.tickT) {
      this.acc -= this.tickT;
      this.red = Math.min(1, this.red + this.tickX);
    }
    if (this.red >= this.next - 1e-9 && this.yellow < this.next - 1e-9) this.explode();
  }

  addTaskProgress(units = 1) {
    if (!this.running) return;
    const req = this.m.balance.required;
    this.yellow = Math.min(this.next, this.yellow + units * this.m.dbg.yellowMul * this.segment / req);
    if (this.yellow >= this.next - 1e-9) this.reachMilestone();
  }

  fillToNext() { if (this.running) { this.yellow = this.next; this.reachMilestone(); } }

  reachMilestone() {
    this.yellow = this.next;
    this.reached += 1;
    this.running = false;        // RED BAR FROZEN
    this.m.cer.begin(this.reached);
  }

  explode() {
    this.running = false;
    this.m.fx('explosion');
    this.m.endMatch('nobody', 'The Red Bar reached the milestone first — THE CRYPT EXPLODED. Everyone loses.');
  }

  serialize() {
    return { red: this.red, yellow: this.yellow, markers: this.markers(), reached: this.reached, running: this.running && !this.m.dbg.freezeRed, tickX: this.tickX, tickT: this.tickT };
  }
}
