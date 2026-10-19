export interface SpeedbrakeControlTarget {
  P: { spoilers?: { groundAutoDeploy: boolean } }
  spoilerCmd: number
  spoilerArmed: boolean
}

/** Advance the pilot lever cycle. Sailplane airbrakes have only DOWN/FULL;
 * transport spoilers retain their DOWN/ARM/FLIGHT cycle. */
export function cycleSpeedbrake(target: SpeedbrakeControlTarget): string {
  const capability = target.P.spoilers
  if (!capability) return 'NO SPEEDBRAKES ON THIS TYPE'
  if (!capability.groundAutoDeploy) {
    target.spoilerArmed = false
    target.spoilerCmd = target.spoilerCmd > 0.5 ? 0 : 1
    return target.spoilerCmd > 0.5 ? 'AIRBRAKES FULL' : 'AIRBRAKES DOWN'
  }
  if (target.spoilerArmed) {
    target.spoilerArmed = false
    target.spoilerCmd = 1
    return 'SPEEDBRAKE — FLIGHT DETENT'
  }
  if (target.spoilerCmd > 0.5) {
    target.spoilerCmd = 0
    return 'SPEEDBRAKE DOWN'
  }
  target.spoilerArmed = true
  return 'SPEEDBRAKE ARMED — auto-deploys on touchdown'
}

/** Apply a hardware ARM detent only where touchdown auto-deploy exists. */
export function armSpeedbrake(target: SpeedbrakeControlTarget): boolean {
  if (!target.P.spoilers?.groundAutoDeploy) {
    target.spoilerArmed = false
    return false
  }
  target.spoilerCmd = 0
  target.spoilerArmed = true
  return true
}
