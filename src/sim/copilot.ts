/**
 * Copilot callout engine (Slice 4) — pure, no DOM/audio. A first officer
 * who monitors the flight and calls out, in real crew phraseology:
 * takeoff roll (airspeed alive / eighty knots / vee one / rotate),
 * climb-out (positive rate, gear-up acknowledgment, clean-up speed), and
 * arrival ("one thousand", "sixty knots" on rollout).
 *
 * CALLOUT OWNERSHIP (honest, recorded): TAWS owns "five hundred" and the
 * FIFTY…TEN radio-altimeter countdown for every type — the copilot takes
 * "one thousand" only, so no aural is ever duplicated.
 *
 * Latching: each call fires once per phase. Touchdown re-arms the
 * takeoff family (next leg gets its calls again); liftoff re-arms the
 * landing family. The caller resets latches wholesale on respawn.
 */

export interface CopilotObs {
  kias: number
  aglFt: number
  vsFpm: number
  onGround: boolean
  /** Gear commanded/positioned down (true for fixed gear). */
  gearDown: boolean
  flapsIndex: number
  throttle: number
}

export interface CopilotSpeeds {
  /** Rotate speed. */
  vrKt: number
  /** Decision speed; 0 = type gets no V1 call (GA). */
  v1Kt: number
  /** Climb clean-up schedule speed for the "flaps up" prompt. */
  flapsUpKt: number
}

export interface CopilotLatches {
  fired: Set<string>
  /** True once the flight has been airborne — gates the rollout call. */
  wasAirborne: boolean
}

export function makeCopilotLatches(): CopilotLatches {
  return { fired: new Set(), wasAirborne: false }
}

const TAKEOFF_KEYS = ['alive', 'eighty', 'v1', 'rotate', 'posRate', 'gearUp', 'flapsUp'] as const
const LANDING_KEYS = ['oneThousand', 'sixty'] as const

/**
 * V-speeds from the type's real parameters. Vr = 1.15 × the TAKEOFF-detent
 * stall (the fleet-lattice formula): the takeoff-config stall comes from
 * the same CLmax ratio derive.ts uses for vs0, evaluated at the mid
 * detent instead of full flap. V1 = Vr − 5 kt is a recorded
 * approximation (real V1 needs runway length + weight); GA types get no
 * V1 call at all.
 */
export function copilotSpeedsFor(p: {
  vs1Kt: number
  clMaxClean: number
  flapDClMax: readonly number[]
  flapDetentsDeg: readonly number[]
  jet: boolean
}): CopilotSpeeds {
  const toIdx = Math.min(Math.floor((p.flapDetentsDeg.length - 1) / 2), p.flapDetentsDeg.length - 1)
  const dCl = p.flapDClMax[toIdx] ?? 0
  const vsTO = p.vs1Kt * Math.sqrt(p.clMaxClean / (p.clMaxClean + dCl))
  const vr = Math.round(vsTO * 1.15)
  return {
    vrKt: vr,
    v1Kt: p.jet ? vr - 5 : 0,
    flapsUpKt: Math.round(p.vs1Kt * 1.25),
  }
}

/** One monitoring step: compare the current observation against the
 *  previous one and return the calls that fire now (possibly several on
 *  a large step — in threshold order). */
export function copilotCallouts(
  s: CopilotObs,
  prev: CopilotObs,
  sp: CopilotSpeeds,
  L: CopilotLatches,
  gearRetractable: boolean,
): string[] {
  const out: string[] = []
  const fire = (key: string, text: string): void => {
    if (!L.fired.has(key)) {
      L.fired.add(key)
      out.push(text)
    }
  }

  // Phase edges re-arm the opposite family.
  if (prev.onGround && !s.onGround) {
    L.wasAirborne = true
    for (const k of LANDING_KEYS) L.fired.delete(k)
  }
  if (!prev.onGround && s.onGround) {
    for (const k of TAKEOFF_KEYS) L.fired.delete(k)
  }

  if (s.onGround) {
    // Takeoff roll: power up AND accelerating — a landing rollout under
    // reverse thrust also reads high "throttle" but decelerates.
    if (s.throttle > 0.6 && s.kias >= prev.kias) {
      if (s.kias >= 40) fire('alive', 'airspeed alive')
      if (s.kias >= 80 && sp.vrKt > 90) fire('eighty', 'eighty knots')
      if (sp.v1Kt >= 80 && s.kias >= sp.v1Kt) fire('v1', 'vee one')
      if (s.kias >= sp.vrKt) fire('rotate', 'rotate')
    }
    // Rollout after a flight: sixty knots decelerating.
    if (L.wasAirborne && prev.kias > 60 && s.kias <= 60) {
      fire('sixty', 'sixty knots')
      L.wasAirborne = false
    }
  } else {
    if (s.vsFpm > 300 && s.aglFt > 20) fire('posRate', 'positive rate')
    if (gearRetractable && prev.gearDown && !s.gearDown) fire('gearUp', 'gear up')
    if (s.flapsIndex > 0 && s.kias >= sp.flapsUpKt && s.vsFpm > 0 && s.aglFt > 400) {
      fire('flapsUp', 'flaps up speed')
    }
    // Descending through 1000 AGL ("five hundred" belongs to TAWS).
    if (s.vsFpm < -200 && prev.aglFt > 1000 && s.aglFt <= 1000) fire('oneThousand', 'one thousand')
  }

  return out
}
