/**
 * Flight recorder + landing debrief (§18, Phase 8a). 10 Hz sample ring;
 * the debrief/grader layer consumes ONLY these samples (never live state),
 * so what the debrief reports is provably what was flown. Pure module.
 */

export interface FlightSample {
  t: number // sim seconds
  lat: number
  lon: number
  altFt: number
  iasKt: number
  vsFpm: number
  headingDeg: number
  pitchDeg: number
  rollDeg: number
  aglFt: number
  onGround: boolean
}

const SAMPLE_HZ = 10

export class FlightRecorder {
  readonly samples: FlightSample[] = []
  private lastT = -Infinity

  /** Default ring ≈ 20 minutes at 10 Hz. */
  constructor(private readonly maxSamples = 12_000) {}

  record(t: number, s: FlightSample): void {
    if (t - this.lastT < 1 / SAMPLE_HZ - 1e-9) return
    this.lastT = t
    this.samples.push({ ...s, t })
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples)
    }
  }

  reset(): void {
    this.samples.length = 0
    this.lastT = -Infinity
  }
}

export interface RunwayRef {
  thrLat: number
  thrLon: number
  headingDeg: number
  elevFt: number
}

export type LandingGrade = 'smooth' | 'firm' | 'hard'

export interface LandingAnalysis {
  touchdownVsFpm: number
  pastThresholdM: number
  /** Positive = right of centerline. */
  centerlineOffsetM: number
  touchdownIasKt: number
  grade: LandingGrade
}

/** POH-informed bands: ≤300 fpm smooth, ≤500 firm, beyond = hard (the
 *  crash guard owns anything past ~700). */
function gradeOf(vsFpm: number): LandingGrade {
  const sink = -vsFpm
  if (sink <= 300) return 'smooth'
  if (sink <= 500) return 'firm'
  return 'hard'
}

export function analyzeLanding(samples: readonly FlightSample[], rwy: RunwayRef): LandingAnalysis | null {
  // Find the air→ground transition.
  let idx = -1
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]!.onGround && !samples[i - 1]!.onGround) idx = i
  }
  if (idx < 0) return null
  const before = samples[idx - 1]!
  const at = samples[idx]!

  const mLat = 111_320
  const mLon = mLat * Math.cos((rwy.thrLat * Math.PI) / 180)
  const dn = (at.lat - rwy.thrLat) * mLat
  const de = (at.lon - rwy.thrLon) * mLon
  const h = (rwy.headingDeg * Math.PI) / 180
  const along = dn * Math.cos(h) + de * Math.sin(h)
  const cross = -dn * Math.sin(h) + de * Math.cos(h)

  return {
    touchdownVsFpm: before.vsFpm,
    pastThresholdM: along,
    centerlineOffsetM: cross,
    touchdownIasKt: before.iasKt,
    grade: gradeOf(before.vsFpm),
  }
}
