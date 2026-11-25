import { readAxis, validCalibration, type AxisCalibration, type GamepadMap, type PadReading } from '../sim/gamepad-map'

/**
 * Guided calibration of the thrust levers at their detents. The pilot is told where to put both levers, one detent at a time, and
 * each position is taken when the levers have come to rest there: first IDLE (wherever the lever's idle detent physically is),
 * then FULL REVERSE, CL, FLX/MCT and TOGA. The result is saved with the binding and kept: IDLE is the measured detent
 * (`measuredIdle`), so the reverse range is everything below where the lever really idles, rather than an assumed quarter.
 */
export type DetentPoint = 'idle' | 'min' | 'cl' | 'flex' | 'max'

export const DETENT_STEPS: readonly { point: DetentPoint; label: string; prompt: string }[] = [
  { point: 'idle', label: 'IDLE', prompt: 'Move BOTH thrust levers into the IDLE detent and let go (if they are in it already, push them out a little and let them drop back in).' },
  { point: 'min', label: 'FULL REVERSE', prompt: 'Lift the reverse latches and pull BOTH levers to FULL REVERSE. Hold them there.' },
  { point: 'cl', label: 'CL', prompt: 'Push BOTH levers forward to the CL detent and let go.' },
  { point: 'flex', label: 'FLX/MCT', prompt: 'Push BOTH levers to the FLX/MCT detent and let go.' },
  { point: 'max', label: 'TOGA', prompt: 'Push BOTH levers fully forward to TOGA and hold them there.' },
]

/** A lever is at rest when it has moved less than this … */
export const DETENT_STILL_EPS = 0.01
/** … for this long. */
export const DETENT_STILL_MS = 1200
/** How long a taken position is shown before the next instruction. */
export const DETENT_CONFIRM_MS = 900

type Lever = 'throttle' | 'throttle2'
const LEVER_NAMES: Record<Lever, string> = { throttle: 'ENG 1', throttle2: 'ENG 2' }

/** Whether a lever reading `v` is where the step asks, relative to what has been taken so far (signed axis: TOGA is up). */
function inPlace(point: DetentPoint, v: number, got: Partial<AxisCalibration>): boolean {
  switch (point) {
    case 'idle': return true
    case 'min': return got.idle !== undefined && v < got.idle - 0.08
    case 'cl': return got.idle !== undefined && v > got.idle + 0.05
    case 'flex': return got.cl !== undefined && v > got.cl + 0.02
    case 'max': return got.flex !== undefined && v > got.flex + 0.02
  }
}

export class ThrottleDetentCalibration {
  active = false
  message = ''
  index = 0
  private levers: Lever[] = []
  private got: Record<Lever, Partial<AxisCalibration>> = { throttle: {}, throttle2: {} }
  private last: Record<Lever, number> = { throttle: NaN, throttle2: NaN }
  private stillSince: Record<Lever, number> = { throttle: 0, throttle2: 0 }
  /** Where each lever was when the step began, and whether it has moved since (IDLE is only taken from a lever that was moved). */
  private startAt: Record<Lever, number> = { throttle: NaN, throttle2: NaN }
  private moved: Record<Lever, boolean> = { throttle: false, throttle2: false }
  private stepStart = 0
  private confirmUntil = 0

  constructor(private readonly getMap: () => GamepadMap, private readonly save: (map: GamepadMap) => void) {}

  get step(): (typeof DETENT_STEPS)[number] | null { return this.active ? DETENT_STEPS[this.index] ?? null : null }

  start(now: number): void {
    const m = this.getMap()
    this.levers = (['throttle', 'throttle2'] as const).filter((fn) => !!m[fn])
    if (!this.levers.length) { this.active = false; this.message = 'No thrust lever is bound yet: use "Bind thrust levers (guided)" first.'; return }
    this.got = { throttle: {}, throttle2: {} }
    this.index = 0
    this.active = true
    this.message = ''
    this.begin(now)
  }

  stop(): void { if (this.active) { this.active = false; this.message = 'Thrust lever calibration stopped; nothing was changed.' } }

  /** Take the previous position again. */
  back(now: number): void {
    if (!this.active || this.index === 0) return
    this.index--
    for (const fn of this.levers) delete this.got[fn][DETENT_STEPS[this.index]!.point]
    this.begin(now)
  }

  private begin(now: number): void {
    this.stepStart = now
    for (const fn of this.levers) { this.last[fn] = NaN; this.stillSince[fn] = now; this.startAt[fn] = NaN; this.moved[fn] = false }
  }

  poll(pads: readonly (PadReading | null)[], now: number): void {
    const step = this.step
    if (!step || now < this.confirmUntil) return
    const m = this.getMap()
    const values: Partial<Record<Lever, number>> = {}
    let ready = true
    for (const fn of this.levers) {
      const v = readAxis(m, fn, pads)
      if (v === null) { this.message = `${LEVER_NAMES[fn]} lever cannot be read: move it once so the browser lists the quadrant.`; return }
      if (!Number.isFinite(this.last[fn]) || Math.abs(v - this.last[fn]) > DETENT_STILL_EPS) { this.last[fn] = v; this.stillSince[fn] = now }
      values[fn] = v
      if (!Number.isFinite(this.startAt[fn])) this.startAt[fn] = v
      if (Math.abs(v - this.startAt[fn]) > 0.03) this.moved[fn] = true
      if (step.point === 'idle' && !this.moved[fn]) ready = false
      const still = now - this.stillSince[fn] >= DETENT_STILL_MS && now - this.stepStart >= DETENT_STILL_MS
      if (!still || !inPlace(step.point, v, this.got[fn])) ready = false
    }
    this.message = this.levers.map((fn) => `${LEVER_NAMES[fn]} ${values[fn]!.toFixed(3)}`).join(' · ') + (ready ? '' : ' — waiting for both levers to rest there')
    if (!ready) return
    for (const fn of this.levers) this.got[fn][step.point] = values[fn]!
    this.message = `${step.label} taken: ` + this.levers.map((fn) => `${LEVER_NAMES[fn]} ${values[fn]!.toFixed(3)}`).join(' · ')
    this.index++
    this.confirmUntil = now + DETENT_CONFIRM_MS
    if (this.index >= DETENT_STEPS.length) { this.finish(); return }
    this.begin(now + DETENT_CONFIRM_MS)
  }

  private finish(): void {
    this.active = false
    const m = this.getMap()
    const saved: string[] = []
    for (const fn of this.levers) {
      const g = this.got[fn]
      const cal: AxisCalibration = { min: g.min!, max: g.max!, idle: g.idle!, cl: g.cl!, flex: g.flex!, measuredIdle: true }
      if (!validCalibration(cal)) { this.message = `${LEVER_NAMES[fn]}: the positions do not make a usable lever (${JSON.stringify(cal)}). Nothing was saved; run it again.`; return }
      m[fn] = { ...m[fn]!, calibration: cal, source: 'user' }
      saved.push(`${LEVER_NAMES[fn]} IDLE at ${Math.round(((cal.idle! - cal.min) / (cal.max - cal.min)) * 100)}% of its travel`)
    }
    this.save(m)
    this.message = `Thrust levers calibrated and saved: ${saved.join(', ')}. Below IDLE is reverse; CL and FLX are marked.`
  }
}
