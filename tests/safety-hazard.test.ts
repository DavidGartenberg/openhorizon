import { describe, expect, it } from 'vitest'
import { safetyHazard } from '../src/audio/safety-hazard'
import { SafetySpeechController, type SpeechMessage } from '../src/audio/safety-speech'

describe('windshear aural', () => {
  it('outranks every TAWS mode and is spoken at warning priority', () => {
    expect(safetyHazard(true, { level: 'WARNING', aural: 'PULL UP' })).toEqual({ text: 'Windshear, windshear, windshear', priority: 4 })
    expect(safetyHazard(false, { level: 'WARNING', aural: 'PULL UP' })).toEqual({ text: 'PULL UP', priority: 4 })
    expect(safetyHazard(false, { level: 'CAUTION', aural: 'TERRAIN' })).toEqual({ text: 'TERRAIN', priority: 2 })
    expect(safetyHazard(false, { level: 'NONE', aural: null })).toBeUndefined()
  })

  it('interrupts a terrain caution already being spoken', () => {
    const spoken: string[] = []
    let cancels = 0
    const c = new SafetySpeechController({ speak: (m: SpeechMessage) => { spoken.push(m.text) }, cancel: () => { cancels++ } })
    c.update(0, safetyHazard(false, { level: 'CAUTION', aural: 'TERRAIN' }))
    c.update(100, safetyHazard(true, { level: 'CAUTION', aural: 'TERRAIN' }))
    expect(spoken).toEqual(['TERRAIN', 'Windshear, windshear, windshear'])
    expect(cancels).toBeGreaterThan(0)
  })
})
