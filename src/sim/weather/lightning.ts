/**
 * Lightning: when strikes happen, where, and what a bolt looks like.
 *
 * Sources: a reported thunderstorm (METAR TS at the station: strikes all
 * around, 0.8–12 km; heavy +TS more often; VCTS in the vicinity, 8–16 km),
 * or a heavy radar cell within 25 km (strikes near that distance). Mean
 * intervals follow storm severity; the actual gaps are exponential (strikes
 * are a Poisson process). Thunder arrives distance / 343 m/s later.
 *
 * Bolt shape: recursive midpoint displacement from the cloud base to the
 * ground with a few forked branches. Deterministic for a given seed.
 */
export interface StormInput {
  /** METAR present-weather groups in effect. */
  weather: readonly string[]
  /** Distance (m) to the nearest heavy radar cell, or null. */
  heavyCellDistM: number | null
}

export interface Strike {
  distanceM: number
  bearingRad: number
  /** Seconds until the thunder is heard. */
  thunderDelayS: number
}

/** Mean seconds between strikes, and the distance band, for the conditions. */
export function stormActivity(s: StormInput): { meanIntervalS: number; minM: number; maxM: number } | null {
  const ts = s.weather.filter((w) => w.includes('TS'))
  const here = ts.find((w) => !w.includes('VC'))
  if (here) return here.startsWith('+') ? { meanIntervalS: 5, minM: 800, maxM: 10_000 } : { meanIntervalS: 9, minM: 1_200, maxM: 12_000 }
  if (ts.length) return { meanIntervalS: 15, minM: 8_000, maxM: 16_000 }
  if (s.heavyCellDistM !== null) {
    const d = Math.max(s.heavyCellDistM, 500)
    return { meanIntervalS: 11, minM: Math.max(500, d - 2000), maxM: d + 2000 }
  }
  return null
}

export class LightningScheduler {
  private nextAtS: number | null = null

  /** A strike due at `nowS`, or null. */
  step(nowS: number, input: StormInput, rnd: () => number = Math.random): Strike | null {
    const act = stormActivity(input)
    if (!act) { this.nextAtS = null; return null }
    this.nextAtS ??= nowS + -Math.log(1 - rnd()) * act.meanIntervalS
    if (nowS < this.nextAtS) return null
    this.nextAtS = nowS + Math.max(0.8, -Math.log(1 - rnd()) * act.meanIntervalS)
    const distanceM = act.minM + (act.maxM - act.minM) * rnd()
    return { distanceM, bearingRad: rnd() * Math.PI * 2, thunderDelayS: distanceM / 343 }
  }
}

/** A bolt as line segments [x0,y0,z0,x1,y1,z1,…] in metres, ground strike at
 *  the origin, cloud base at y = heightM, y up. */
export function boltSegments(heightM: number, seed: number): number[] {
  let s = seed >>> 0 || 1
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const out: number[] = []
  const subdivide = (a: number[], b: number[], spread: number, depth: number, branchDepth: number): void => {
    if (depth === 0) { out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!); return }
    const mid = [(a[0]! + b[0]!) / 2 + (rnd() - 0.5) * spread, (a[1]! + b[1]!) / 2 + (rnd() - 0.5) * spread * 0.25, (a[2]! + b[2]!) / 2 + (rnd() - 0.5) * spread]
    subdivide(a, mid, spread / 2, depth - 1, branchDepth)
    subdivide(mid, b, spread / 2, depth - 1, branchDepth)
    // Forks leave the main channel downward and die out.
    if (branchDepth > 0 && depth >= 4 && rnd() < 0.35) {
      const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!) * 0.6
      const end = [mid[0]! + (rnd() - 0.5) * len, mid[1]! - len * (0.4 + 0.4 * rnd()), mid[2]! + (rnd() - 0.5) * len]
      subdivide(mid, end, spread / 3, depth - 2, branchDepth - 1)
    }
  }
  subdivide([0, heightM, 0], [0, 0, 0], heightM * 0.35, 7, 2)
  return out
}
