/**
 * How wet the ground is, from the METAR's present weather: rain and drizzle wet it quickly and it dries over about a quarter
 * of an hour of simulated time; mist and fog leave it damp. The shaders read one shared uniform (0 dry … 1 soaked): pavement
 * goes darker and glossier (sky reflections, puddles in the low spots), terrain darker and a little more saturated.
 * Pure model here; the uniform object is shared by every receiver, the way the cloud shadows' are.
 */

export const wetnessUniforms = { uWet: { value: 0 } }

/** Present-weather groups ('-RA', 'TSRA', 'VCSH', 'BR' ...) → the wetness they would leave, 0..1. */
export function wetnessFromWeather(groups: readonly string[] | undefined | null): number {
  let wet = 0
  for (const raw of groups ?? []) {
    const g = String(raw).toUpperCase()
    const vicinity = g.includes('VC')
    let w = 0
    if (/(RA|DZ|SH|TS|GR|GS|PL)/.test(g)) w = g.startsWith('+') ? 1 : g.startsWith('-') ? 0.62 : 0.85
    else if (/(SN|SG)/.test(g)) w = 0.35                       // snow melting on the surface; cover is another matter
    else if (/FG/.test(g)) w = 0.5
    else if (/BR/.test(g)) w = 0.3
    wet = Math.max(wet, vicinity ? w * 0.4 : w)
  }
  return Math.min(wet, 1)
}

/** Wetting is quick (about 2 minutes to soaked), drying slow (about 15 minutes to dry): rates per simulated second. */
const WET_RATE = 1 / 120
const DRY_RATE = 1 / 900

export class WetnessModel {
  value = 0
  private target = 0
  private lastS: number | null = null

  setTarget(target: number): void { this.target = Math.min(Math.max(target, 0), 1) }

  /** Jump to the target (a new place or a set weather: it was raining there already). */
  snap(): void { this.value = this.target; this.apply() }

  update(simS: number): number {
    const dt = this.lastS === null ? 0 : Math.min(Math.max(simS - this.lastS, 0), 120)
    this.lastS = simS
    const step = (this.target > this.value ? WET_RATE : DRY_RATE) * dt
    this.value = this.target > this.value ? Math.min(this.value + step, this.target) : Math.max(this.value - step, this.target)
    this.apply()
    return this.value
  }

  private apply(): void { wetnessUniforms.uWet.value = this.value }
}
