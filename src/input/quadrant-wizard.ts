import { AXIS_FUNCTIONS, validCalibration, type AxisBinding, type BindableAxis, type BindableButton, type ButtonBinding, type GamepadMap, type PadReading } from '../sim/gamepad-map'

/**
 * One guided pass over the TCA quadrant: every lever and switch the simulator has a function for, asked for in turn, found by
 * what moves, and bound without any Save / Next clicking. The quadrant's Gamepad indices cannot be known in advance (the
 * browser numbers axes and buttons by its own rule, and the add-on's differ from the manual's), so the only reliable source is
 * the hardware itself: the pilot is asked to move each control once, and the one that moved is the control.
 *
 * Only the quadrant takes part (a bump on the sidestick binds nothing), controls already bound to something else cannot be
 * picked up by mistake, and a button that was already down when its step began has to be released and pressed again, so a
 * latched switch is bound by flipping it to the position asked for.
 */
export interface QuadrantStep {
  kind: 'axis' | 'button'
  fn: BindableAxis | BindableButton
  /** What to do with the hardware, one line. */
  prompt: string
  /** Not asked when one of these ('axis:flaps', 'button:gearDown' …) has already been bound in this pass (a detent button is another face of the lever's axis). */
  skipWhenBound?: readonly string[]
}

export const QUADRANT_STEPS: readonly QuadrantStep[] = [
  { kind: 'axis', fn: 'speedbrake', prompt: 'SPEED BRAKE lever: with it stowed, pull it to FULL, then back to stowed.' },
  { kind: 'axis', fn: 'flaps', prompt: 'FLAPS lever: from 0, move it through every detent to FULL, then back to 0.' },
  { kind: 'button', fn: 'speedbrakeArm', prompt: 'SPEED BRAKE lever: push it to ARM (skip if yours has no ARM).' },
  { kind: 'button', fn: 'speedbrakeDown', prompt: 'SPEED BRAKE lever: stowed position (detent button).', skipWhenBound: ['axis:speedbrake'] },
  { kind: 'button', fn: 'speedbrakeFull', prompt: 'SPEED BRAKE lever: FULL position (detent button).', skipWhenBound: ['axis:speedbrake'] },
  { kind: 'button', fn: 'flaps0', prompt: 'FLAPS lever: position 0 (detent button).', skipWhenBound: ['axis:flaps'] },
  { kind: 'button', fn: 'flaps1', prompt: 'FLAPS lever: position 1 (detent button).', skipWhenBound: ['axis:flaps'] },
  { kind: 'button', fn: 'flaps2', prompt: 'FLAPS lever: position 2 (detent button).', skipWhenBound: ['axis:flaps'] },
  { kind: 'button', fn: 'flaps3', prompt: 'FLAPS lever: position 3 (detent button).', skipWhenBound: ['axis:flaps'] },
  { kind: 'button', fn: 'flapsFull', prompt: 'FLAPS lever: FULL (detent button).', skipWhenBound: ['axis:flaps'] },
  { kind: 'button', fn: 'gearDown', prompt: 'GEAR lever: put it DOWN (if it is down now, raise it and lower it again).' },
  { kind: 'button', fn: 'gearUp', prompt: 'GEAR lever: put it UP.' },
  { kind: 'button', fn: 'autobrakeLow', prompt: 'AUTO BRAKE: press LO.' },
  { kind: 'button', fn: 'autobrakeMedium', prompt: 'AUTO BRAKE: press MED.' },
  { kind: 'button', fn: 'autobrakeMax', prompt: 'AUTO BRAKE: press MAX.' },
  { kind: 'button', fn: 'parkingBrake', prompt: 'PARKING BRAKE: switch it ON (if it is on now, release it and set it again).' },
  { kind: 'button', fn: 'engineMaster1', prompt: 'ENG 1 MASTER: switch it ON (if it is on now, switch it off and on again).' },
  { kind: 'button', fn: 'engineMaster2', prompt: 'ENG 2 MASTER: switch it ON (if it is on now, switch it off and on again).' },
  { kind: 'button', fn: 'ignitionCrank', prompt: 'ENGINE MODE selector: turn it to CRANK.' },
  { kind: 'button', fn: 'ignitionNorm', prompt: 'ENGINE MODE selector: turn it to NORM.' },
  { kind: 'button', fn: 'ignitionStart', prompt: 'ENGINE MODE selector: turn it to START.' },
  { kind: 'button', fn: 'rudderTrimLeft', prompt: 'RUDDER TRIM: press LEFT.' },
  { kind: 'button', fn: 'rudderTrimRight', prompt: 'RUDDER TRIM: press RIGHT.' },
  { kind: 'button', fn: 'rudderTrimReset', prompt: 'RUDDER TRIM: press RESET.' },
  { kind: 'button', fn: 'trimUp', prompt: 'PITCH TRIM wheel: roll it NOSE UP (skip if it is not a button on yours).' },
  { kind: 'button', fn: 'trimDown', prompt: 'PITCH TRIM wheel: roll it NOSE DOWN.' },
]

/** The quadrant is the device whose name says so (`TCA Q-Eng 1&2`, `TCA Quadrant …`). */
export const isQuadrantPad = (p: PadReading | null | undefined): p is PadReading => !!p && p.connected !== false && /Q-?Eng|Quadrant/i.test(p.id)

/** An axis has to move this far from where it was at the start of its step to be taken for the control. */
export const AXIS_MOVE_THRESHOLD = 0.45
/** …and has to stop for this long, at one end of its travel or back where it began, to be finished with (a lever resting at a detent halfway is not). */
export const AXIS_SETTLE_MS = 800
/** A lever that has stopped for this long anywhere is finished with (travel that does not reach the end of the axis). */
export const AXIS_SETTLE_ANYWHERE_MS = 3000
/** How long a finished step is shown before the next begins. */
export const CONFIRM_MS = 900

type Pending = { phase: 'waiting' } | { phase: 'moving'; pad: PadReading['index']; deviceId: string; axis: number; sign: 1 | -1; s0: number; lo: number; hi: number; last: number; changedAt: number } | { phase: 'confirm'; until: number }

const bindingKey = (s: QuadrantStep): string => `${s.kind}:${s.fn}`

export class QuadrantWizard {
  active = false
  message = ''
  index = 0
  private steps: QuadrantStep[] = []
  private bound = new Set<string>()
  private baseline = new Map<number, { axes: number[]; free: Set<number> }>()
  private state: Pending = { phase: 'waiting' }
  /** Physical controls handed out in this pass, so no two functions share one. */
  private taken = new Set<string>()

  constructor(private readonly getMap: () => GamepadMap, private readonly save: (map: GamepadMap) => void) {}

  get step(): QuadrantStep | null { return this.active ? this.steps[this.index] ?? null : null }
  get total(): number { return this.steps.length }
  get boundCount(): number { return this.bound.size }

  /** Begin. `onlyUnbound` leaves out the functions that already have a binding. */
  start(pads: readonly (PadReading | null)[], onlyUnbound: boolean): void {
    const m = this.getMap()
    const has = (s: QuadrantStep): boolean => (s.kind === 'axis' ? !!m[s.fn as BindableAxis] : !!m.btn?.[s.fn as BindableButton])
    this.steps = QUADRANT_STEPS.filter((s) => !(onlyUnbound && has(s)))
    this.bound = new Set(QUADRANT_STEPS.filter(has).filter(() => onlyUnbound).map(bindingKey))
    this.taken.clear()
    this.index = -1
    this.active = this.steps.length > 0
    this.message = this.active ? '' : 'Everything on the quadrant is already bound. Use "Rebind all" to start over.'
    if (this.active) this.advance(pads)
  }

  stop(): void { this.active = false; this.message = 'Quadrant binding stopped.' }
  skip(pads: readonly (PadReading | null)[]): void { if (this.active) this.advance(pads) }
  back(pads: readonly (PadReading | null)[]): void {
    if (!this.active) return
    this.index = Math.max(this.index - 2, -1)
    this.advance(pads)
  }

  private advance(pads: readonly (PadReading | null)[]): void {
    for (let i = this.index + 1; i <= this.steps.length; i++) {
      const s = this.steps[i]
      if (!s) { this.index = this.steps.length; this.active = false; this.message = `Quadrant binding finished: ${this.bound.size} controls bound.`; return }
      if (s.skipWhenBound?.some((k) => this.bound.has(k))) continue
      this.index = i
      this.state = { phase: 'waiting' }
      this.snapshot(pads)
      this.message = ''
      return
    }
  }

  private snapshot(pads: readonly (PadReading | null)[]): void {
    this.baseline.clear()
    for (const p of pads) {
      if (!isQuadrantPad(p)) continue
      this.baseline.set(p.index, { axes: [...p.axes], free: new Set(p.buttons.flatMap((b, i) => (b.pressed ? [] : [i]))) })
    }
  }

  /** Whether a physical control belongs to some other function (so a stray touch cannot take it). */
  private claimed(deviceId: string, kind: 'axis' | 'button', n: number, own: BindableAxis | BindableButton): boolean {
    const m = this.getMap()
    if (kind === 'axis') return AXIS_FUNCTIONS.some((fn) => fn !== own && m[fn]?.deviceId === deviceId && m[fn]?.axis === n)
    return Object.entries(m.btn ?? {}).some(([fn, b]) => fn !== own && b.deviceId === deviceId && b.btn === n)
  }

  poll(pads: readonly (PadReading | null)[], now: number): void {
    const step = this.step
    if (!step) return
    if (this.state.phase === 'confirm') { if (now >= this.state.until) this.advance(pads); return }
    const quad = pads.filter(isQuadrantPad)
    if (!quad.length) { this.message = 'No TCA quadrant is exposed yet: move a lever or press a button on it, so the browser lists it.'; return }
    for (const p of quad) if (!this.baseline.has(p.index)) this.baseline.set(p.index, { axes: [...p.axes], free: new Set(p.buttons.flatMap((b, i) => (b.pressed ? [] : [i]))) })
    this.message = ''
    if (step.kind === 'button') this.pollButton(step, quad, now)
    else this.pollAxis(step, quad, now)
  }

  private pollButton(step: QuadrantStep, quad: readonly PadReading[], now: number): void {
    for (const p of quad) {
      const base = this.baseline.get(p.index)!
      for (let i = 0; i < p.buttons.length; i++) {
        if (!p.buttons[i]!.pressed) { base.free.add(i); continue }
        if (!base.free.has(i) || this.taken.has(`${p.id}:b${i}`) || this.claimed(p.id, 'button', i, step.fn)) continue
        this.bindButton(step, p, i, now)
        return
      }
    }
  }

  private bindButton(step: QuadrantStep, p: PadReading, btn: number, now: number): void {
    const m = this.getMap()
    const binding: ButtonBinding = { pad: p.index, btn, deviceId: p.id, source: 'user' }
    // One physical button has one purpose: remove any alias or other function that used it.
    for (const [k, id] of Object.entries(m.devices ?? {})) if (id === p.id) { delete m.btnKeys?.[`${k}:${btn}`]; delete m.unverifiedBtnKeys?.[`${k}:${btn}`] }
    for (const [fn, b] of Object.entries(m.btn ?? {})) if (b.deviceId === p.id && b.btn === btn) delete m.btn![fn as BindableButton]
    m.btn = { ...m.btn, [step.fn]: binding }
    this.save(m)
    this.taken.add(`${p.id}:b${btn}`)
    this.bound.add(bindingKey(step))
    this.message = `${step.fn} → button ${btn}`
    this.state = { phase: 'confirm', until: now + CONFIRM_MS }
  }

  private pollAxis(step: QuadrantStep, quad: readonly PadReading[], now: number): void {
    const own = step.fn as BindableAxis
    if (this.state.phase === 'waiting') {
      let best: { p: PadReading; axis: number; delta: number } | null = null
      for (const p of quad) {
        const base = this.baseline.get(p.index)!
        for (let a = 0; a < p.axes.length; a++) {
          const v = p.axes[a]!, b = base.axes[a]
          if (!Number.isFinite(v) || b === undefined || !Number.isFinite(b)) continue
          if (this.taken.has(`${p.id}:a${a}`) || this.claimed(p.id, 'axis', a, own)) continue
          const d = v - b
          if (Math.abs(d) > AXIS_MOVE_THRESHOLD && (!best || Math.abs(d) > Math.abs(best.delta))) best = { p, axis: a, delta: d }
        }
      }
      if (!best) return
      const sign: 1 | -1 = best.delta > 0 ? 1 : -1
      const s0 = this.baseline.get(best.p.index)!.axes[best.axis]! * sign
      const s = best.p.axes[best.axis]! * sign
      this.state = { phase: 'moving', pad: best.p.index, deviceId: best.p.id, axis: best.axis, sign, s0, lo: Math.min(s0, s), hi: Math.max(s0, s), last: s, changedAt: now }
      return
    }
    if (this.state.phase !== 'moving') return
    const st = this.state
    const p = quad.find((q) => q.index === st.pad && q.id === st.deviceId)
    const raw = p?.axes[st.axis]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return
    const s = raw * st.sign
    st.lo = Math.min(st.lo, s); st.hi = Math.max(st.hi, s)
    if (Math.abs(s - st.last) > 0.012) { st.last = s; st.changedAt = now }
    const still = now - st.changedAt
    const atEnd = s >= 0.97 || s <= -0.97
    const backAtStart = Math.abs(s - st.s0) < 0.08 && st.hi - st.lo > AXIS_MOVE_THRESHOLD
    if (!((still >= AXIS_SETTLE_MS && (atEnd || backAtStart)) || still >= AXIS_SETTLE_ANYWHERE_MS)) {
      this.message = `${step.fn}: travel ${st.lo.toFixed(2)} … ${st.hi.toFixed(2)} — take it to both ends, then let go`
      return
    }
    const calibration = { min: Math.max(-1, st.lo), max: Math.min(1, st.hi) }
    if (!validCalibration(calibration)) { this.message = `${step.fn}: that axis barely moved; move the lever through its whole travel.`; this.state = { phase: 'waiting' }; this.snapshot(quad); return }
    const m = this.getMap()
    const binding: AxisBinding = { pad: st.pad, axis: st.axis, sign: st.sign, deviceId: st.deviceId, source: 'user', calibration }
    m[own] = binding
    this.save(m)
    this.taken.add(`${st.deviceId}:a${st.axis}`)
    this.bound.add(bindingKey(step))
    this.message = `${step.fn} → axis ${st.axis} (${calibration.min.toFixed(2)} … ${calibration.max.toFixed(2)})`
    this.state = { phase: 'confirm', until: now + CONFIRM_MS }
  }
}
