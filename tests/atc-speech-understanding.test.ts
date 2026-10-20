/**
 * What the controller understands from SPOKEN transmissions: phrases as a
 * speech recognizer returns them (lowercase, no punctuation, numbers either
 * as words or digits), run through the same normalizer the push-to-talk uses.
 */
import { describe, expect, it } from 'vitest'
import { normalizeAviation } from '../src/voice/ptt'
import { interpretTransmission, type FreeTextCtx } from '../src/sim/atc/freetext'

const ctx: FreeTextCtx = { callsign: 'N123AB', facility: 'San Francisco Tower', activeRunway: '28L', windDirDeg: 280, windKt: 12, altimeterInHg: 29.92 }
const hear = (spoken: string) => interpretTransmission(normalizeAviation(spoken), ctx)

describe('spoken numbers become what the controller reads', () => {
  const cases: Array<[string, string]> = [
    ['turn left heading two seven zero', 'turn left heading 270'],
    ['heading three six zero', 'heading 360'],
    ['climb and maintain three thousand five hundred', 'climb and maintain 3500'],
    ['descend and maintain five thousand', 'descend and maintain 5000'],
    ['climb and maintain one two thousand', 'climb and maintain 12000'],
    ['maintain ten thousand', 'maintain 10000'],
    ['maintain fifteen hundred', 'maintain 1500'],
    ['flight level three five zero', 'flight level 350'],
    ['squawk one two zero zero', 'squawk 1200'],
    ['contact tower one one eight point seven', 'contact tower 118.7'],
    ['runway two eight left', 'runway 28L'],
    ['runway 2 8 left', 'runway 28L'],
    ['runway three four right', 'runway 34R'],
    ['cessna November one two three alpha bravo ready', 'cessna N123AB ready'],
  ]
  for (const [said, expected] of cases) it(`"${said}"`, () => expect(normalizeAviation(said)).toContain(expected))

  it('leaves ordinary words alone', () => {
    expect(normalizeAviation('number one for departure')).toBe('number one for departure')
    expect(normalizeAviation('one moment please')).toBe('one moment please')
  })
})

describe('departure and ground', () => {
  const cases: Array<[string, string]> = [
    ['tower cessna one two three alpha bravo ready for departure runway two eight left', 'takeoff'],
    ['holding short two eight left ready to go', 'takeoff'],
    ['ready for takeoff', 'takeoff'],
    ['request takeoff', 'takeoff'],
    ['request taxi', 'taxi'],
    ['ground ready to taxi', 'taxi'],
    ['request taxi to runway two eight left', 'taxi'],
    ['request startup', 'startup'],
    ['ready for pushback', 'pushback'],
    ['request pushback and start', 'pushback'],
  ]
  for (const [said, intent] of cases) it(`"${said}" → ${intent}`, () => expect(hear(said).intent).toBe(intent))
})

describe('arrival and pattern', () => {
  const cases: Array<[string, string]> = [
    ['inbound for landing', 'landing'],
    ['five miles south inbound full stop', 'landing'],
    ['request straight in runway two eight left', 'landing'],
    ['request landing', 'landing'],
    ['request touch and go', 'option'],
    ['request the option', 'option'],
    ['request a low approach', 'option'],
    ['request left traffic', 'pattern'],
    ['request right pattern', 'pattern'],
    ['request closed traffic', 'pattern'],
    ['downwind runway two eight left', 'position'],
    ['turning base', 'position'],
    ['established on final', 'position'],
    ['established on the localizer runway two eight left', 'position'],
    ['going around', 'goAround'],
    ['go around', 'goAround'],
  ]
  for (const [said, intent] of cases) it(`"${said}" → ${intent}`, () => expect(hear(said).intent).toBe(intent))
})

describe('information requests', () => {
  const cases: Array<[string, string]> = [
    ['request weather', 'weather'],
    ['say the wind', 'weather'],
    ['request altimeter', 'weather'],
    ['i have the current altimeter', 'weather'],
    ['request atis', 'atis'],
    ['i have information bravo', 'atis'],
    ['radio check', 'radioCheck'],
    ['how do you read', 'radioCheck'],
    ['request flight following', 'flightFollowing'],
    ['request vfr advisories', 'flightFollowing'],
    ['request ifr clearance to san jose', 'clearance'],
    ['request clearance', 'clearance'],
    ['request frequency change', 'freqChange'],
    ['request higher', 'altitudeRequest'],
    ['request lower', 'altitudeRequest'],
    ['request five thousand', 'altitudeRequest'],
    ['request direct sfo', 'direct'],
  ]
  for (const [said, intent] of cases) it(`"${said}" → ${intent}`, () => expect(hear(said).intent).toBe(intent))
})

describe('instructions the pilot reads back or acknowledges', () => {
  const cases: Array<[string, string]> = [
    ['roger', 'ack'],
    ['wilco', 'ack'],
    ['affirmative', 'ack'],
    ['negative', 'ack'],
    ['unable', 'ack'],
    ['good morning', 'courtesy'],
    ['thanks good day', 'courtesy'],
    ['cleared to land runway two eight left', 'readback'],
    ['heading two seven zero', 'heading'],
    ['climb and maintain three thousand five hundred', 'altitude'],
  ]
  for (const [said, intent] of cases) it(`"${said}" → ${intent}`, () => expect(hear(said).intent).toBe(intent))
})

describe('emergencies are never missed in speech', () => {
  const cases = [
    'mayday mayday mayday engine failure',
    'pan pan pan pan pan pan low on fuel',
    'we have an engine fire',
    'declaring an emergency',
    'i have a medical emergency on board',
    'smoke in the cockpit',
  ]
  for (const said of cases) it(`"${said}"`, () => expect(hear(said).emergency).toBe(true))
  it('"no emergency" is not an emergency', () => expect(hear('negative no emergency').emergency).toBeFalsy())
})

describe('what it answers', () => {
  it('gives real field data for weather, ATIS and clearances', () => {
    expect(hear('request weather').response).toMatch(/wind 280 at 12.*altimeter 29\.92/)
    expect(hear('request atis').response).toMatch(/28L/)
    expect(hear('request taxi').response).toMatch(/28L/)
    expect(hear('climb and maintain three thousand five hundred').response).toBe('climb and maintain 3,500')
    expect(hear('turn left heading two seven zero').response).toBe('turn left heading 270')
  })
  it('answers pattern and flight-following requests with something a pilot can act on', () => {
    expect(hear('request left traffic').response).toMatch(/left traffic.*28L/)
    expect(hear('request flight following').response).toMatch(/squawk \d{4}/)
  })
  it('still says again to gibberish rather than guessing', () => {
    expect(hear('purple elephant sandwich').intent).toBe('unknown')
    expect(hear('purple elephant sandwich').response).toMatch(/say again/)
  })
})
