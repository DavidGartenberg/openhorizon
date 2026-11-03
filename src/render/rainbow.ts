/**
 * When a rainbow shows: rain in the air (`rain` 0..1), the sun shining on it
 * (direct transmission through the cloud deck, 0..1) and low enough that the
 * 42° bow around the antisolar point stands above the horizon. 0..1.
 */
export function rainbowStrength(rain: number, sunElevDeg: number, sunTransmission: number): number {
  const ss = (a: number, b: number, x: number): number => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)
  }
  return ss(0.08, 0.35, rain) * ss(0.2, 0.5, sunTransmission) * ss(0, 4, sunElevDeg) * (1 - ss(36, 42, sunElevDeg))
}
