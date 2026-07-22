import { describe, expect, it } from 'vitest'
import {
  CFM56_7B26, makeTurbofanState, stepTurbofan, thrustAvailableN, fuelFlowKgS, windmillDragN,
} from '../src/sim/turbofan'
import { RHO0 } from '../src/sim/atmosphere'

const RHO_FL350 = 0.3796 // kg/m³ ISA 35,000 ft

describe('CFM56-7B26 turbofan (Phase 11d — N1-based, published anchors)', () => {
  it('produces ~117 kN per engine static at sea level, full thrust', () => {
    const st = makeTurbofanState(CFM56_7B26)
    for (let i = 0; i < 20 * 50; i++) stepTurbofan(st, 0.02, 1, RHO0, 0, true, CFM56_7B26)
    const perEngine = st.thrustN / CFM56_7B26.engines
    expect(perEngine).toBeGreaterThan(117_000 * 0.97)
    expect(perEngine).toBeLessThan(117_000 * 1.03)
  })

  it('spools idle → 95% N1 in 4–8 s', () => {
    const st = makeTurbofanState(CFM56_7B26)
    // settle at idle first
    for (let i = 0; i < 10 * 50; i++) stepTurbofan(st, 0.02, 0, RHO0, 0, true, CFM56_7B26)
    const n1Span = CFM56_7B26.n1MaxPct - CFM56_7B26.n1IdlePct
    let t = 0
    for (; t < 15; t += 0.02) {
      stepTurbofan(st, 0.02, 1, RHO0, 0, true, CFM56_7B26)
      if (st.n1Pct >= CFM56_7B26.n1IdlePct + 0.95 * n1Span) break
    }
    expect(t).toBeGreaterThan(4)
    expect(t).toBeLessThan(8)
  })

  it('lapses honestly to FL350/M0.785: max available ~26 kN/engine class', () => {
    const perEngine = thrustAvailableN(RHO_FL350, 0.785, CFM56_7B26) / CFM56_7B26.engines
    expect(perEngine).toBeGreaterThan(20_000)
    expect(perEngine).toBeLessThan(32_000)
  })

  it('cruise fuel flow: 37.5 kN total at M0.785 burns 2.4 t/h ±10%', () => {
    const ffKgH = fuelFlowKgS(37_500, 0.785, CFM56_7B26) * 3600
    expect(ffKgH).toBeGreaterThan(2_160)
    expect(ffKgH).toBeLessThan(2_640)
  })

  it('idle thrust is small but real; a dead engine windmills as drag', () => {
    const st = makeTurbofanState(CFM56_7B26)
    for (let i = 0; i < 15 * 50; i++) stepTurbofan(st, 0.02, 0, RHO0, 0.2, true, CFM56_7B26)
    expect(st.thrustN).toBeGreaterThan(1_000)
    expect(st.thrustN).toBeLessThan(12_000)

    const dragSlow = windmillDragN(RHO0, 50, CFM56_7B26)
    const dragFast = windmillDragN(RHO0, 100, CFM56_7B26)
    expect(dragSlow).toBeGreaterThan(0)
    expect(dragFast / dragSlow).toBeCloseTo(4, 0) // ∝ V²
    // engine off → no thrust, spool decays
    const off = makeTurbofanState(CFM56_7B26)
    off.n1Pct = 80
    for (let i = 0; i < 20 * 50; i++) stepTurbofan(off, 0.02, 1, RHO0, 0.2, false, CFM56_7B26)
    expect(off.thrustN).toBe(0)
    expect(off.n1Pct).toBeLessThan(10)
  })

  it('fuel stops when the engine is off', () => {
    const st = makeTurbofanState(CFM56_7B26)
    for (let i = 0; i < 5 * 50; i++) stepTurbofan(st, 0.02, 0.5, RHO0, 0, false, CFM56_7B26)
    expect(st.fuelFlowKgS).toBe(0)
  })
})
