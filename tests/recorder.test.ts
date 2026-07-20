import { describe, expect, it } from 'vitest'
import { FlightRecorder, analyzeLanding, type FlightSample } from '../src/sim/recorder'
import { gradeSteepTurn } from '../src/sim/training/graders'

const RWY = { thrLat: 37.5109, thrLon: -122.4989, headingDeg: 313, elevFt: 66 }

function sample(over: Partial<FlightSample>): FlightSample {
  return {
    t: 0, lat: 37.5, lon: -122.5, altFt: 1000, iasKt: 100, vsFpm: 0,
    headingDeg: 0, pitchDeg: 0, rollDeg: 0, aglFt: 1000, onGround: false,
    ...over,
  }
}

describe('FlightRecorder', () => {
  it('samples at 10 Hz and bounds the ring', () => {
    const r = new FlightRecorder(50) // tiny ring for the test
    for (let i = 0; i < 100; i++) r.record(i * 0.1, sample({ t: i * 0.1 }))
    expect(r.samples.length).toBeLessThanOrEqual(50)
    expect(r.samples[r.samples.length - 1]!.t).toBeCloseTo(9.9, 5)
  })

  it('holds 10 Hz even when called at 100 Hz', () => {
    const r = new FlightRecorder()
    for (let i = 0; i < 100; i++) r.record(i * 0.01, sample({ t: i * 0.01 }))
    // 1 s span at 10 Hz → ~10 samples, not ~100.
    expect(r.samples.length).toBeGreaterThanOrEqual(9)
    expect(r.samples.length).toBeLessThanOrEqual(11)
  })
})

describe('analyzeLanding', () => {
  it('measures touchdown VS, threshold distance, and centerline offset', () => {
    // Final approach down runway 31's course, touch down ~300 m past the
    // threshold, ~4 m right of centerline, at -240 fpm.
    const mLat = 111_320
    const mLon = mLat * Math.cos((RWY.thrLat * Math.PI) / 180)
    const h = (RWY.headingDeg * Math.PI) / 180
    const right = h + Math.PI / 2
    const samples: FlightSample[] = []
    for (let i = 0; i < 40; i++) {
      const along = -400 + i * 20 // approach → rollout
      const down = along >= 300
      const lat = RWY.thrLat + (Math.cos(h) * along + Math.cos(right) * 4) / mLat
      const lon = RWY.thrLon + (Math.sin(h) * along + Math.sin(right) * 4) / mLon
      samples.push(sample({
        t: i, lat, lon, onGround: down,
        aglFt: down ? 0 : Math.max((300 - along) * 0.25, 0),
        altFt: RWY.elevFt + (down ? 0 : Math.max((300 - along) * 0.25, 0)),
        vsFpm: down ? 0 : -240,
        headingDeg: RWY.headingDeg,
      }))
    }
    const a = analyzeLanding(samples, RWY)!
    expect(a.touchdownVsFpm).toBeCloseTo(-240, -1)
    expect(a.pastThresholdM).toBeGreaterThan(250)
    expect(a.pastThresholdM).toBeLessThan(350)
    expect(Math.abs(a.centerlineOffsetM - 4)).toBeLessThan(1.5)
    expect(a.grade).toBe('smooth')
  })

  it('grades a hard arrival honestly and returns null with no touchdown', () => {
    const hard = [
      sample({ t: 0, lat: RWY.thrLat, lon: RWY.thrLon, aglFt: 20, vsFpm: -550, onGround: false }),
      sample({ t: 1, lat: RWY.thrLat, lon: RWY.thrLon, aglFt: 0, vsFpm: 0, onGround: true }),
    ]
    expect(analyzeLanding(hard, RWY)!.grade).toBe('hard')
    expect(analyzeLanding([sample({})], RWY)).toBeNull()
  })
})

describe('gradeSteepTurn (ACS: ±100 ft, ±10 kt, 45°±5, rollout ±10°)', () => {
  function turn(altErr: number, bankAvg: number, iasErr: number): ReturnType<typeof gradeSteepTurn> {
    const samples: FlightSample[] = []
    for (let i = 0; i <= 90; i++) {
      samples.push(sample({
        t: i, altFt: 3000 + altErr * Math.sin(i / 9), iasKt: 95 + iasErr,
        rollDeg: i < 4 ? (i / 4) * bankAvg : i > 86 ? ((90 - i) / 4) * bankAvg : bankAvg,
        headingDeg: (i * 4) % 360,
      }))
    }
    return gradeSteepTurn(samples, { entryAltFt: 3000, entryIasKt: 95 })
  }

  it('passes a within-tolerance turn and fails altitude busts', () => {
    const good = turn(60, 45, 4)
    expect(good.pass).toBe(true)
    expect(good.worstAltDevFt).toBeLessThanOrEqual(100)
    const busted = turn(160, 45, 4)
    expect(busted.pass).toBe(false)
    expect(busted.failures.join(' ')).toContain('altitude')
  })

  it('fails shallow bank', () => {
    const shallow = turn(40, 32, 0)
    expect(shallow.pass).toBe(false)
    expect(shallow.failures.join(' ')).toContain('bank')
  })
})
