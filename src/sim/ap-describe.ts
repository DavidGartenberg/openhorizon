/**
 * What the autopilot is doing, in plain words (pure).
 *
 * The annunciators (ROL, ALTS, GS …) are cryptic to anyone who does not fly a
 * Boeing. This turns the SAME state they read into a sentence and a next-step
 * hint. It only ever restates real state it is given — never a guess — and it
 * never shows the word "flare" (the autoland must not announce it on screen).
 */
import type { LateralMode, VerticalMode } from './autopilot'
import type { ApSelections, UserVertical } from './ap-panel'

export interface ApDescribeInput {
  master: boolean
  onGround: boolean
  lateral: LateralMode
  /** The lateral mode is armed (capturing), not yet tracking. */
  lateralArmed: boolean
  /** The pilot's vertical mode, and what the control law is actually flying (ALTS = capture armed). */
  vertical: UserVertical
  verticalActual: VerticalMode
  sel: ApSelections
  altHoldFt: number
  current: { altitudeFt: number; headingDeg: number; iasKt: number; vsFpm: number }
  autothrottle: { engaged: boolean; mode: string } | null
  autoland: { phase: string } | null
  /** What NAV is following. */
  navSource: 'flight plan' | 'VOR' | null
}

export interface ApDescription { headline: string; next?: string }

const ft = (n: number): string => Math.round(n).toLocaleString('en-US')
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const angleDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)

export function describeAutopilot(i: ApDescribeInput): ApDescription {
  if (!i.master) {
    return i.onGround
      ? { headline: 'Autopilot is off.', next: 'Take off first: the autopilot can be engaged once you are airborne.' }
      : { headline: 'Autopilot is off — you are flying by hand.', next: 'Press HDG or ALT (or CLIMB/DESCEND) to engage and hold, or AUTOPILOT to hold what you are doing.' }
  }

  const parts: string[] = []
  let lateralIsApproach = false
  switch (i.lateral) {
    case 'HDG': {
      const hdg = String(i.sel.headingDeg).padStart(3, '0')
      parts.push(angleDiff(i.current.headingDeg, i.sel.headingDeg) > 3 ? `turning to heading ${hdg}°` : `holding heading ${hdg}°`)
      break
    }
    case 'NAV': parts.push(i.navSource === 'VOR' ? 'tracking the VOR' : 'following the flight plan'); break
    case 'APR': {
      lateralIsApproach = true
      parts.push(i.lateralArmed ? 'intercepting the localizer' : (i.verticalActual === 'GS' ? 'tracking the localizer and glideslope' : 'tracking the localizer'))
      break
    }
    case 'BC': parts.push('tracking the back course'); break
    default: parts.push('wings level')
  }

  const rateText = (fpm: number): string => `${ft(Math.abs(fpm))} ft/min`
  switch (i.verticalActual) {
    case 'ALT': parts.push(`holding ${ft(i.vertical === 'ALT' ? i.altHoldFt : i.sel.altitudeFt)} ft`); break
    case 'ALTS': {
      const up = i.vertical === 'FLC' ? i.sel.altitudeFt > i.current.altitudeFt : i.sel.vsFpm > 0
      parts.push(i.vertical === 'FLC'
        ? `${up ? 'climbing' : 'descending'} to ${ft(i.sel.altitudeFt)} ft holding ${Math.round(i.sel.iasKt)} kt, then it will level off`
        : `${up ? 'climbing' : 'descending'} to ${ft(i.sel.altitudeFt)} ft at ${rateText(i.sel.vsFpm)}, then it will level off`)
      break
    }
    case 'VS': parts.push(`${i.sel.vsFpm >= 0 ? 'climbing' : 'descending'} at ${rateText(i.sel.vsFpm)}`); break
    case 'FLC': parts.push(`${i.sel.altitudeFt >= i.current.altitudeFt ? 'climbing' : 'descending'} holding ${Math.round(i.sel.iasKt)} kt`); break
    case 'GS': if (!lateralIsApproach) parts.push('following the glideslope'); break
    default: parts.push('holding the present pitch')
  }

  if (i.autothrottle?.engaged) {
    parts.push(i.autothrottle.mode === 'N1' ? 'autothrottle at climb thrust'
      : i.autothrottle.mode === 'RETARD' ? 'autothrottle retarding to idle'
      : `autothrottle holding ${Math.round(i.sel.iasKt)} kt`)
  }

  let headline = `${cap(parts.join(', '))}.`
  let next: string | undefined

  if (i.autoland) {
    const phase = i.autoland.phase
    if (phase === 'ROLLOUT') headline = 'Autoland: rolling out on the runway and braking to a stop.'
    else if (phase === 'DONE') headline = 'Autoland complete — the airplane has stopped.'
    else if (phase === 'FLARE' || phase === 'LAND') headline = 'Autoland: landing now.'
    else {
      headline = `${headline.slice(0, -1)} — AUTOLAND armed: it will fly the approach, land and roll out to a stop.`
      next = 'Keep your hands off: it lands and stops the airplane. Press AUTOLAND again to cancel and keep flying the approach.'
    }
    return { headline, ...(next ? { next } : {}) }
  }

  const needLateral = i.lateral === 'ROL'
  const needVertical = i.vertical === 'PIT'
  if (needLateral && needVertical) next = 'Press HDG to hold a heading, and ALT or CLIMB/DESCEND to control altitude.'
  else if (needLateral) next = 'Press HDG to hold a heading, or NAV to follow a route.'
  else if (needVertical) next = 'Press ALT to hold this altitude, or CLIMB/DESCEND to go to the selected one.'
  return { headline, ...(next ? { next } : {}) }
}
