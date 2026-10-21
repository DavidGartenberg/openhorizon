/**
 * Free-text ATC (user goal: "create a atc where it can do anything
 * including emergencys where i type and they respond"). A pure,
 * deterministic intent engine: the pilot types anything; the controller
 * classifies it (emergencies first) and answers in real phraseology
 * with live field data (runway, wind, altimeter) woven in.
 *
 * HONEST SCOPE (recorded): this is a rule engine, not a language model —
 * unrecognized phrasing gets a truthful "say again". Responses are
 * radio TEXT; the structured tower/ground strip machines remain the
 * authority for actual sequencing (the free-text controller answers in
 * parallel and does not double-book the runway).
 */

export interface FreeTextCtx {
  callsign: string
  facility: string // e.g. "San Francisco Tower"
  activeRunway: string
  windDirDeg: number
  windKt: number
  altimeterInHg?: number
  /** Optional real taxi route idents for taxi clearances. */
  taxiVia?: string[]
  /** The airplane's current altitude, ft MSL, for "request higher / lower". */
  altitudeFt?: number
}

export interface AtcReply {
  intent: string
  /** Controller transmission text (no callsign prefix — caller formats). */
  response: string
  /** True when the reply declares an emergency in progress. */
  emergency?: boolean
  /** Slice 5 single-reply rule: this intent is owned by the structured
   *  strip machines (tower/ground) — the caller should transmit THEIR
   *  Transmission[] instead of `response` when a facility is active
   *  (`response` remains the honest fallback for untowered use). */
  bridge?: boolean
}

const rx = (p: string): RegExp => new RegExp(p, 'i')

function wind(ctx: FreeTextCtx): string {
  return `wind ${String(Math.round(ctx.windDirDeg / 10) * 10).padStart(3, '0')} at ${Math.max(1, Math.round(ctx.windKt))}`
}

/** A plausible discrete transponder code for a callsign (digits 0–7, never a
 *  reserved code), stable so the same airplane is always given the same one. Pure. */
export function squawkFor(callsign: string): string {
  let h = 7
  for (const c of callsign) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const d = (n: number): number => Math.floor(h / n) % 8
  const code = `${1 + (d(1) % 6)}${d(8)}${d(64)}${d(512)}`
  return code === '7500' || code === '7600' || code === '7700' || code === '1200' ? '4321' : code
}

const ATIS_LETTER = 'alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliett?|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-?ray|yankee|zulu'

/** Classify one pilot transmission and produce the controller's answer. */
export function interpretTransmission(text: string, ctx: FreeTextCtx): AtcReply {
  const t = text.trim().toLowerCase()
  const rwy = ctx.activeRunway

  // ---- EMERGENCIES first (any mention wins over other intents) ----
  // Negation-aware: "no emergency" / "negative emergency" / "cancel the
  // emergency" used to be answered as a mayday (substring trap).
  const negatedEmergency = rx('\\b(no|not|negative|cancel(l?ing)?|without)\\s+(an?\\s+|the\\s+)?emergency').test(t)
  const declared = !negatedEmergency && rx('mayday|pan[- ]?pan|declar\\w* (an? )?emergency|emergency').test(t)
  if (declared || rx('engine (fire|failure|failed|out|quit)|on fire|smoke in|fuel emergency|min(imum)? fuel|medical').test(t)) {
    const base = `roger your ${rx('pan[- ]?pan').test(t) ? 'pan-pan' : 'mayday'}, `
    if (rx('fire|smoke').test(t)) {
      return {
        intent: 'emergency-fire',
        emergency: true,
        response: base + `cleared to land any runway, runway ${rwy} available, ${wind(ctx)}, fire and rescue rolling — say souls on board and fuel remaining`,
      }
    }
    if (rx('engine').test(t)) {
      return {
        intent: 'emergency-engine',
        emergency: true,
        response: base + `cleared straight-in runway ${rwy}, ${wind(ctx)}, emergency equipment standing by — say souls on board and fuel remaining`,
      }
    }
    if (rx('medical').test(t)) {
      return {
        intent: 'emergency-medical',
        emergency: true,
        response: `roger, cleared straight-in runway ${rwy}, ${wind(ctx)}, ambulance will meet you on the ramp`,
      }
    }
    if (rx('fuel').test(t)) {
      return {
        intent: 'emergency-fuel',
        emergency: true,
        response: `roger minimum fuel, you are number one, cleared to land runway ${rwy}, ${wind(ctx)}`,
      }
    }
    return {
      intent: 'emergency',
      emergency: true,
      response: base + `all aircraft standby — cleared to land any runway, runway ${rwy} available, ${wind(ctx)}, say nature of emergency, souls on board and fuel remaining`,
    }
  }

  // Souls/fuel follow-up after an emergency ask.
  const souls = t.match(/(\d+)\s*souls/)
  if (souls || rx('souls on board').test(t)) {
    const fuelM = t.match(/(\d+(?:\.\d+)?)\s*(hours?|minutes?|lbs|pounds|kg)/)
    return {
      intent: 'emergency-souls',
      response: `roger, ${souls ? `${souls[1]} souls` : 'souls'}${fuelM ? ` and ${fuelM[1]} ${fuelM[2]} of fuel` : ''} copied — equipment is standing by, wind ${wind(ctx).slice(5)}`,
    }
  }

  // A bare acknowledgment ("roger", "wilco", "unable", "negative") — a short
  // utterance, nothing else in it: answered, never mistaken for a request.
  if (!negatedEmergency && t.split(/\s+/).length <= 3 && rx('^(roger|wilco|affirm(ative)?|negative|unable|copy|stand(ing)? by|ok(ay)?)\\b').test(t)) {
    return { intent: 'ack', response: 'roger' }
  }

  // ---- Normal requests ----
  // Readback echo FIRST ("cleared to land 28R, N123AB" is the pilot
  // reading a clearance BACK — matching the landing pattern first
  // re-requested landing and re-queued the pilot last).
  if (rx('\\bcleared\\b').test(t) && t.includes(rwy.toLowerCase())) {
    return { intent: 'readback', response: 'readback correct' }
  }
  if (rx('ready (for )?(immediate )?(takeoff|departure)|request (takeoff|departure)|ready to go\\b|holding short.*\\bready\\b').test(t)) {
    return { intent: 'takeoff', bridge: true, response: `runway ${rwy}, ${wind(ctx)}, cleared for takeoff` }
  }
  if (rx('go[- ]?around|going around').test(t)) {
    return { intent: 'goAround', bridge: true, response: `roger, fly runway heading, climb and maintain 2,000, report downwind runway ${rwy}` }
  }
  if (rx('touch and go|the option|low approach|low pass|stop and go').test(t)) {
    return { intent: 'option', response: `runway ${rwy}, cleared for the option, ${wind(ctx)}` }
  }
  // Ground services: pushback before startup ("pushback and start").
  if (rx('push ?back').test(t)) {
    return { intent: 'pushback', response: `pushback approved, expect runway ${rwy}, advise ready to taxi` }
  }
  if (rx('\\b(request|ready (for|to))\\b[^.]*\\bstart[- ]?up\\b|\\bengine start\\b|\\bstart[- ]?up\\b').test(t)) {
    return { intent: 'startup', response: 'startup approved, advise ready to taxi' }
  }
  // Traffic pattern work.
  if (rx('closed traffic|pattern work|\\b(left|right)?\\s*(traffic|pattern)\\b').test(t) && rx('\\b(request|remain|staying|stay|closed|pattern work)\\b').test(t)) {
    const side = rx('\\bright\\b').test(t) ? 'right' : 'left'
    return { intent: 'pattern', response: `${side} traffic approved, report downwind runway ${rwy}` }
  }
  // Established on an approach / final.
  if (rx('\\bestablished\\b').test(t)) {
    return { intent: 'position', bridge: true, response: `roger, number one, runway ${rwy}, cleared to land, ${wind(ctx)}` }
  }
  // Landing needs INTENT, not the substring "land" ("oakland center" and
  // "check landing gear" both got "cleared to land").
  if (rx('\\b(request|inbound|ready)\\b[^.]*\\bland(ing)?\\b|\\bfull stop\\b|\\bwant to land\\b|^land(ing)?\\b|\\bstraight[- ]in\\b').test(t)) {
    return { intent: 'landing', bridge: true, response: `runway ${rwy}, cleared to land, ${wind(ctx)}` }
  }
  if (rx('\\btaxi\\b').test(t)) {
    const via = ctx.taxiVia?.length ? `taxi via ${ctx.taxiVia.join(', ')}` : 'taxi via the parallel'
    return { intent: 'taxi', bridge: true, response: `runway ${rwy}, ${via}, hold short runway ${rwy}` }
  }
  const alt = t.match(/(?:climb|descend|maintain).*?(\d{3,5})\s*(?:feet|ft)?|(?:fl|flight level)\s*(\d{2,3})/)
  if (alt) {
    const target = alt[2] ? `flight level ${alt[2]}` : `${Number(alt[1]).toLocaleString('en-US')}`
    const verb = rx('descend').test(t) ? 'descend and maintain' : 'climb and maintain'
    return { intent: 'altitude', response: `${verb} ${target}` }
  }
  const hdg = t.match(/heading\s*(\d{1,3})/)
  if (hdg) {
    const turnDir = rx('left').test(t) ? 'turn left' : 'turn right'
    return { intent: 'heading', response: `${turnDir} heading ${hdg[1]!.padStart(3, '0')}` }
  }
  const direct = t.match(/direct\s+([a-z]{3,5})/i)
  if (direct) {
    return { intent: 'direct', response: `cleared direct ${direct[1]!.toUpperCase()}` }
  }
  if (rx(`\\batis\\b|\\binformation (${ATIS_LETTER})\\b`).test(t)) {
    const alti = ctx.altimeterInHg ? `, altimeter ${ctx.altimeterInHg.toFixed(2)}` : ''
    return { intent: 'atis', response: `roger, ${wind(ctx)}${alti}, landing and departing runway ${rwy}` }
  }
  if (rx('flight following|vfr advisories|radar services|traffic advisories|request advisories').test(t)) {
    return { intent: 'flightFollowing', response: `squawk ${squawkFor(ctx.callsign)}, radar contact, report ready for frequency change` }
  }
  if (rx('clearance|flight plan|ifr release').test(t)) {
    const dest = t.match(/\bto\s+([a-z]{3,5})\b/)
    return { intent: 'clearance', response: `cleared${dest ? ` to ${dest[1]!.toUpperCase()}` : ''} as filed, maintain 3,000, expect higher 10 minutes after departure, squawk ${squawkFor(ctx.callsign)}` }
  }
  if (rx('request (higher|lower|\\d{3,5}|flight level \\d+)').test(t)) {
    const asked = t.match(/request (\d{3,5})/)
    const fl = t.match(/request flight level (\d+)/)
    const here = ctx.altitudeFt
    if (asked || fl) {
      const target = fl ? `flight level ${fl[1]}` : Number(asked![1]).toLocaleString('en-US')
      const lower = !fl && here !== undefined && Number(asked![1]) < here
      return { intent: 'altitudeRequest', response: `${lower ? 'descend' : 'climb'} and maintain ${target}` }
    }
    const up = rx('higher').test(t)
    const base = here !== undefined ? Math.round(here / 1000) * 1000 : 3000
    const target = Math.max(1000, up ? base + 1000 : base - 1000)
    return { intent: 'altitudeRequest', response: `${up ? 'climb' : 'descend'} and maintain ${target.toLocaleString('en-US')}` }
  }
  if (rx('(say|request).*(wind|weather|altimeter)|altimeter').test(t)) {
    const alti = ctx.altimeterInHg ? `, altimeter ${ctx.altimeterInHg.toFixed(2)}` : ''
    return { intent: 'weather', response: `${wind(ctx)}${alti}` }
  }
  if (rx('radio check|how do you (read|hear)').test(t)) {
    return { intent: 'radioCheck', response: 'read you five by five' }
  }
  if (rx('\\b(left|right)?\\s*(downwind|base|final)\\b').test(t)) {
    return { intent: 'position', bridge: true, response: `roger, number one, runway ${rwy}, cleared to land, ${wind(ctx)}` }
  }
  if (rx('frequency change|switch(ing)? to|contact (ground|departure|approach)').test(t)) {
    return { intent: 'freqChange', response: 'frequency change approved, good day' }
  }
  if (rx('cancel|never ?mind|disregard').test(t)) {
    return { intent: 'cancel', response: 'roger, disregard' }
  }
  if (rx('thank|good day|so long|good (morning|afternoon|evening)').test(t)) {
    return { intent: 'courtesy', response: 'good day' }
  }
  if (negatedEmergency) {
    return { intent: 'noEmergency', response: 'roger, no emergency' }
  }

  return { intent: 'unknown', response: `say again, ${ctx.callsign}` }
}
