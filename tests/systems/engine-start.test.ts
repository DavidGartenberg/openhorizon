import { describe, expect, it } from 'vitest'
import {
  makeEngineStartState,
  stepEngineStart,
  type EngineStartInputs,
} from '../../src/sim/systems/engine-start'
import { egtC } from '../../src/sim/systems/mixture'

function baseInputs(overrides: Partial<EngineStartInputs> = {}): EngineStartInputs {
  return {
    masterBattery: true,
    starterEngaged: false,
    magneto: 'both',
    mixtureRich: true,
    throttleFrac: 0.2,
    fuelAvailable: true,
    hotEngine: false,
    floodedEngine: false,
    primed: false,
    ...overrides,
  }
}

function run(
  st: ReturnType<typeof makeEngineStartState>,
  inp: EngineStartInputs,
  seconds: number,
  dt = 0.1,
): void {
  for (let t = 0; t < seconds / dt; t++) stepEngineStart(st, dt, inp)
}

describe('engine start sequence', () => {
  it('cold-and-dark start reaches a running state', () => {
    const st = makeEngineStartState()
    expect(st.status).toBe('stopped')
    expect(st.rpm).toBe(0)

    const inp = baseInputs({ starterEngaged: true })
    run(st, inp, 5)

    expect(st.status).toBe('running')
    expect(st.rpm).toBeGreaterThan(0)
  })

  it('magneto check: RPM drop is 100-150 RPM per magneto, max 50 RPM difference', () => {
    const st = makeEngineStartState()
    run(st, baseInputs({ starterEngaged: true }), 5)
    expect(st.status).toBe('running')

    const runInp = baseInputs({ throttleFrac: 0.35 })
    stepEngineStart(st, 0.1, { ...runInp, magneto: 'both' })
    const bothRpm = st.rpm

    stepEngineStart(st, 0.1, { ...runInp, magneto: 'left' })
    const leftRpm = st.rpm
    const leftDrop = bothRpm - leftRpm

    stepEngineStart(st, 0.1, { ...runInp, magneto: 'both' }) // back to both between checks
    stepEngineStart(st, 0.1, { ...runInp, magneto: 'right' })
    const rightRpm = st.rpm
    const rightDrop = bothRpm - rightRpm

    expect(leftDrop).toBeGreaterThanOrEqual(100)
    expect(leftDrop).toBeLessThanOrEqual(150)
    expect(rightDrop).toBeGreaterThanOrEqual(100)
    expect(rightDrop).toBeLessThanOrEqual(150)
    expect(Math.abs(leftDrop - rightDrop)).toBeLessThanOrEqual(50)
  })

  it('engine dies (magneto off / fuel loss) and can be restarted', () => {
    const st = makeEngineStartState()
    run(st, baseInputs({ starterEngaged: true }), 5)
    expect(st.status).toBe('running')

    stepEngineStart(st, 0.1, baseInputs({ magneto: 'off' }))
    expect(st.status).toBe('stopped')

    const restart = baseInputs({ starterEngaged: true })
    run(st, restart, 5)
    expect(st.status).toBe('running')
  })

  it('flooded start: normal technique fails, flooded technique succeeds', () => {
    const failed = makeEngineStartState()
    run(failed, baseInputs({ starterEngaged: true, floodedEngine: true }), 10)
    expect(failed.status).not.toBe('running') // normal rich-mixture crank never catches

    const succeeded = makeEngineStartState()
    run(
      succeeded,
      baseInputs({ starterEngaged: true, floodedEngine: true, mixtureRich: false, throttleFrac: 0.7 }),
      5,
    )
    expect(succeeded.status).toBe('running')
  })

  it('hot start: normal technique works, priming a hot engine floods it', () => {
    const normal = makeEngineStartState()
    run(normal, baseInputs({ starterEngaged: true, hotEngine: true }), 5)
    expect(normal.status).toBe('running')

    const overprimed = makeEngineStartState()
    run(overprimed, baseInputs({ starterEngaged: true, hotEngine: true, primed: true }), 10)
    expect(overprimed.status).not.toBe('running') // priming a hot engine floods it — never catches
  })
})

describe('mixture/EGT model', () => {
  it('has a genuine local peak somewhere in the middle of a rich-to-lean sweep', () => {
    const mixtures: number[] = []
    for (let m = 1; m >= 0.05; m -= 0.01) mixtures.push(m)
    const egts = mixtures.map(egtC)

    let peakIdx = 0
    for (let i = 1; i < egts.length; i++) if (egts[i]! > egts[peakIdx]!) peakIdx = i

    expect(peakIdx).toBeGreaterThan(0)
    expect(peakIdx).toBeLessThan(egts.length - 1)
    expect(egts[peakIdx]!).toBeGreaterThan(egts[0]!) // above full-rich EGT
    expect(egts[peakIdx]!).toBeGreaterThan(egts[peakIdx - 1]!)
    expect(egts[peakIdx]!).toBeGreaterThan(egts[peakIdx + 1]!)
  })

  it('falls gradually toward ambient near lean cutoff — no instrument-breaking cliff', () => {
    // Fine-grained sweep across and below the lean-cutoff boundary (0.12).
    const step = 0.005
    const mixtures: number[] = []
    for (let m = 0.4; m >= 0.05; m -= step) mixtures.push(Number(m.toFixed(3)))
    const egts = mixtures.map(egtC)

    const MAX_STEP_JUMP_C = 150
    for (let i = 1; i < egts.length; i++) {
      const jump = Math.abs(egts[i]! - egts[i - 1]!)
      expect(jump).toBeLessThan(MAX_STEP_JUMP_C)
    }
  })
})
