import { describe, expect, it } from 'vitest'
import { CHECKLISTS, checklistProgress, evaluateChecklist, suggestChecklist, type ChecklistState } from '../src/sim/checklists'

const cold: ChecklistState = {
  onGround: true, parkingBrake: true, engineRunning: false, throttle: 0, masterBattery: false, alternator: false, avionics: false,
  magneto: 'off', mixtureRich: true, fuelSelector: 'BOTH', fuelOk: true, pitotHeat: false, landingLight: false, flapsDeg: 0, landingFlapsDeg: 30,
  trim: 0, gearRetractable: false, gearDown: true, kias: 0, aglFt: 0, groundSpeedKt: 0, apMaster: false, isJet: false, hasMixture: true,
  hasSpoilers: false, spoilersArmed: false, spoilersStowed: true, vrefKt: 52,
}
const jet: ChecklistState = { ...cold, isJet: true, hasMixture: false, hasSpoilers: true, gearRetractable: true, landingFlapsDeg: 30, vrefKt: 140 }
const by = (id: string) => CHECKLISTS.find((c) => c.id === id)!
const none = new Set<string>()

describe('checklist evaluation follows the real airplane', () => {
  it('auto items reflect the actual state and cannot be ticked by hand', () => {
    const v = evaluateChecklist(by('before-start'), cold, new Set(['bs-park', 'bs-batt']))
    const get = (id: string) => v.find((i) => i.id === id)!
    expect(get('bs-park')).toMatchObject({ auto: true, status: 'done' }) // really set
    expect(get('bs-batt')).toMatchObject({ auto: true, status: 'todo' }) // ticking is ignored: the battery is off
    const on = evaluateChecklist(by('before-start'), { ...cold, masterBattery: true }, none)
    expect(on.find((i) => i.id === 'bs-batt')!.status).toBe('done')
  })

  it('manual items follow the pilot\'s ticks', () => {
    const before = evaluateChecklist(by('before-start'), cold, none).find((i) => i.id === 'bs-ctl')!
    expect(before).toMatchObject({ auto: false, status: 'todo' })
    const after = evaluateChecklist(by('before-start'), cold, new Set(['bs-ctl'])).find((i) => i.id === 'bs-ctl')!
    expect(after.status).toBe('done')
  })

  it('hides items that do not exist on this airplane', () => {
    const ids = (s: ChecklistState, l: string) => evaluateChecklist(by(l), s, none).map((i) => i.id)
    expect(ids(jet, 'before-start')).not.toContain('bs-mix')
    expect(ids(jet, 'before-start')).not.toContain('bs-fuelsel')
    expect(ids(cold, 'before-start')).toContain('bs-mix')
    expect(ids(cold, 'before-landing')).not.toContain('ld-gear') // fixed gear
    expect(ids(jet, 'before-landing')).toContain('ld-gear')
    expect(ids(cold, 'before-landing')).not.toContain('ld-spoil')
    expect(ids(jet, 'before-landing')).toContain('ld-spoil')
  })

  it('before-landing checks gear, flaps, speed and the light honestly', () => {
    const s: ChecklistState = { ...jet, onGround: false, gearDown: false, flapsDeg: 5, kias: 190, aglFt: 2500, landingLight: false }
    const bad = evaluateChecklist(by('before-landing'), s, none)
    expect(bad.filter((i) => i.auto && i.status === 'todo').map((i) => i.id)).toEqual(['ld-light', 'ld-gear', 'ld-flaps', 'ld-spoil', 'ld-speed'])
    const good = evaluateChecklist(by('before-landing'), { ...s, gearDown: true, flapsDeg: 30, kias: 146, landingLight: true, spoilersArmed: true }, none)
    expect(good.filter((i) => i.auto).every((i) => i.status === 'done')).toBe(true)
  })

  it('progress counts what is done', () => {
    const v = evaluateChecklist(by('before-start'), { ...cold, masterBattery: true, avionics: true, flapsDeg: 20 }, new Set(['bs-ctl']))
    const p = checklistProgress(v)
    expect(p.total).toBe(v.length)
    expect(p.done).toBe(v.filter((i) => i.status === 'done').length)
    expect(p.complete).toBe(false)
    const all = evaluateChecklist(by('before-start'), { ...cold, masterBattery: true, avionics: true }, new Set(['bs-ctl']))
    expect(checklistProgress(all.map((i) => ({ ...i, status: 'done' as const }))).complete).toBe(true)
    expect(checklistProgress([]).complete).toBe(false)
  })
})

describe('suggestChecklist', () => {
  it('follows the phase of flight', () => {
    expect(suggestChecklist(cold)).toBe('before-start')
    expect(suggestChecklist({ ...cold, engineRunning: true })).toBe('engine-start')
    expect(suggestChecklist({ ...cold, engineRunning: true, parkingBrake: false, groundSpeedKt: 8 })).toBe('before-takeoff')
    expect(suggestChecklist({ ...cold, onGround: false, engineRunning: true, aglFt: 1800, kias: 80 })).toBe('before-landing')
    expect(suggestChecklist({ ...cold, onGround: false, engineRunning: true, aglFt: 9000, kias: 220 })).toBe('before-takeoff')
    expect(suggestChecklist({ ...cold, engineRunning: true, parkingBrake: false, groundSpeedKt: 20, flapsDeg: 30 })).toBe('after-landing')
  })
})

describe('definitions', () => {
  it('every item has a unique id and a challenge/response', () => {
    const ids = CHECKLISTS.flatMap((c) => c.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CHECKLISTS) for (const i of c.items) { expect(i.challenge.length).toBeGreaterThan(2); expect(i.response.length).toBeGreaterThan(1) }
  })
})
