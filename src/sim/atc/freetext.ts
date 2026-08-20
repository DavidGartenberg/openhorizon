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
}

export interface AtcReply {
  intent: string
  /** Controller transmission text (no callsign prefix — caller formats). */
  response: string
  /** True when the reply declares an emergency in progress. */
  emergency?: boolean
}

const rx = (p: string): RegExp => new RegExp(p, 'i')

function wind(ctx: FreeTextCtx): string {
  return `wind ${String(Math.round(ctx.windDirDeg / 10) * 10).padStart(3, '0')} at ${Math.max(1, Math.round(ctx.windKt))}`
}

/** Classify one pilot transmission and produce the controller's answer. */
export function interpretTransmission(text: string, ctx: FreeTextCtx): AtcReply {
  const t = text.trim().toLowerCase()
  const rwy = ctx.activeRunway

  // ---- EMERGENCIES first (any mention wins over other intents) ----
  const declared = rx('mayday|pan[- ]?pan|declar\\w* (an? )?emergency|emergency').test(t)
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

  // ---- Normal requests ----
  if (rx('ready (for )?(takeoff|departure)|request (takeoff|departure)').test(t)) {
    return { intent: 'takeoff', response: `runway ${rwy}, ${wind(ctx)}, cleared for takeoff` }
  }
  if (rx('go[- ]?around|going around').test(t)) {
    return { intent: 'goAround', response: `roger, fly runway heading, climb and maintain 2,000, report downwind runway ${rwy}` }
  }
  if (rx('touch and go|the option').test(t)) {
    return { intent: 'option', response: `runway ${rwy}, cleared for the option, ${wind(ctx)}` }
  }
  if (rx('(request|cleared to|inbound.*)?land|full stop|landing').test(t)) {
    return { intent: 'landing', response: `runway ${rwy}, cleared to land, ${wind(ctx)}` }
  }
  if (rx('taxi').test(t)) {
    const via = ctx.taxiVia?.length ? `taxi via ${ctx.taxiVia.join(', ')}` : 'taxi via the parallel'
    return { intent: 'taxi', response: `runway ${rwy}, ${via}, hold short runway ${rwy}` }
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
  if (rx('(say|request).*(wind|weather|altimeter)|altimeter').test(t)) {
    const alti = ctx.altimeterInHg ? `, altimeter ${ctx.altimeterInHg.toFixed(2)}` : ''
    return { intent: 'weather', response: `${wind(ctx)}${alti}` }
  }
  if (rx('radio check|how do you (read|hear)').test(t)) {
    return { intent: 'radioCheck', response: 'read you five by five' }
  }
  if (rx('(left|right)?\\s*(downwind|base|final)').test(t)) {
    return { intent: 'position', response: `roger, number one, runway ${rwy}, cleared to land, ${wind(ctx)}` }
  }
  if (rx('frequency change|switch(ing)? to|contact (ground|departure|approach)').test(t)) {
    return { intent: 'freqChange', response: 'frequency change approved, good day' }
  }
  if (rx('cancel|never ?mind|disregard').test(t)) {
    return { intent: 'cancel', response: 'roger, disregard' }
  }
  if (rx('thank|good day|so long').test(t)) {
    return { intent: 'courtesy', response: 'good day' }
  }
  // Readback-ish echo (contains runway + a clearance verb).
  if (rx('cleared').test(t) && t.includes(rwy.toLowerCase())) {
    return { intent: 'readback', response: 'readback correct' }
  }

  return { intent: 'unknown', response: `say again, ${ctx.callsign}` }
}
