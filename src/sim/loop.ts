/**
 * Fixed-timestep simulation loop (§4.2).
 * Physics runs at a fixed rate via an accumulator; rendering interpolates.
 * Pure module: no three.js, no DOM — must run headless in Node.
 */

export type SimRate = 0 | 1 | 2 | 4

/** Longest single frame we will honor, in seconds. Anything above this
 *  (tab was backgrounded, debugger pause) is treated as this long. */
const MAX_FRAME_SECONDS = 0.25

export class FixedTimestepLoop {
  /** Fixed physics timestep in seconds. */
  readonly dt: number

  /** Accumulated, rate-scaled time not yet consumed by physics ticks. */
  private accumulator = 0

  private rate: SimRate = 1

  /** Total simulated seconds elapsed (excludes paused time). */
  simTime = 0

  /** Total physics ticks executed. */
  ticks = 0

  constructor(
    hz = 120,
    /** Max physics steps per advance() — spiral-of-death guard. */
    private readonly maxSubSteps = 30,
  ) {
    if (hz <= 0) throw new Error(`loop hz must be positive, got ${hz}`)
    this.dt = 1 / hz
  }

  setRate(rate: SimRate): void {
    this.rate = rate
  }

  getRate(): SimRate {
    return this.rate
  }

  get paused(): boolean {
    return this.rate === 0
  }

  /**
   * Advance the simulation by `elapsed` real seconds, invoking `step(dt)` for
   * each fixed physics tick. Returns the interpolation alpha in [0, 1): the
   * fraction of a tick left in the accumulator, for render interpolation.
   */
  advance(elapsed: number, step: (dt: number) => void): number {
    if (!(elapsed >= 0)) return this.accumulator / this.dt
    this.accumulator += Math.min(elapsed, MAX_FRAME_SECONDS) * this.rate

    let steps = 0
    while (this.accumulator >= this.dt && steps < this.maxSubSteps) {
      step(this.dt)
      this.simTime += this.dt
      this.ticks += 1
      this.accumulator -= this.dt
      steps += 1
    }

    // If we hit the sub-step ceiling the sim cannot keep up with real time
    // at this rate; drop the backlog rather than death-spiral.
    if (steps >= this.maxSubSteps && this.accumulator >= this.dt) {
      this.accumulator = 0
    }

    return this.accumulator / this.dt
  }
}
