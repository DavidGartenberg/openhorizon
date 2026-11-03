/**
 * Ground-surface weather over time: how wet the ground is, and how much
 * fresh snow lies on it. Drives the terrain and pavement shaders (and is
 * independent of the runway friction model, which reads the reported
 * weather directly).
 *
 * Rain wets the ground within a couple of minutes (faster when heavy) and
 * it dries over about half an hour after the rain stops (faster in sun).
 * Snow at or below about +1 °C builds cover over ~15 minutes; above +2 °C it
 * melts, and melting snow keeps the ground wet.
 */
import { precipitationFromWeather } from '../systems/airframe-ice'

/** Strongest precipitation intensity in the groups: light 0.4, moderate 0.7, heavy 1. */
export function precipIntensity(weather: readonly string[]): number {
  let k = 0
  for (const w of weather) {
    if (w.includes('VC')) continue
    if (!/(DZ|RA|SN|SG|PL|GR|GS)/.test(w)) continue
    k = Math.max(k, w.startsWith('+') ? 1 : w.startsWith('-') ? 0.4 : 0.7)
  }
  return k
}

export class SurfaceWeatherState {
  wetness = 0
  snow = 0

  step(dt: number, weather: readonly string[], surfaceTempC: number | undefined, sunElevDeg: number): void {
    if (dt <= 0) return
    const p = precipitationFromWeather(weather)
    const k = precipIntensity(weather)
    const t = surfaceTempC ?? 10
    const sun = Math.max(0, Math.min(1, Math.sin((sunElevDeg * Math.PI) / 180)))
    const raining = (p === 'rain' || p === 'drizzle' || p === 'freezingRain') && k > 0
    const snowing = p === 'snow' && k > 0
    if (snowing && t <= 1.5) this.snow = Math.min(1, this.snow + (k * dt) / 900)
    else if (t > 2) this.snow = Math.max(0, this.snow - (dt * (t - 1)) / 3600)
    const melting = this.snow > 0 && t > 2
    if (raining || (snowing && t > 1.5) || melting) this.wetness = Math.min(1, this.wetness + (Math.max(k, 0.3) * dt) / 120)
    else this.wetness = Math.max(0, this.wetness - (dt * (0.3 + 0.7 * sun)) / 1800)
  }
}
