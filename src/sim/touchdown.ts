/**
 * Touchdown tyre smoke: at touchdown the wheels spin up from rest to the
 * ground speed in a fraction of a second, and the rubber scrubbed off in
 * that skid smokes. More speed and a firmer arrival mean more smoke; a slow
 * taildragger or a glider on its skid makes little or none.
 */
export function touchdownSmoke(wasOnGround: boolean, onGround: boolean, groundSpeedMs: number, sinkRateMs: number): number {
  if (wasOnGround || !onGround) return 0
  const speed = Math.max(0, Math.min(1, (groundSpeedMs - 20) / 40))
  if (speed <= 0) return 0
  const firm = 0.4 + 0.6 * Math.max(0, Math.min(1, sinkRateMs / 3))
  return speed * firm
}
