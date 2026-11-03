import { describe, expect, it } from 'vitest'
import { FlightEventLog, environmentDebrief } from '../src/sim/flight-events'

describe('environment debrief', () => {
  it('reports nothing for an uneventful flight', () => {
    expect(environmentDebrief(new FlightEventLog(), 1.4, 0.6)).toBe('')
  })

  it('summarises g, damage, windshear, ice and hydroplaning', () => {
    const log = new FlightEventLog()
    log.add(10, 'overstress', 'OVERSTRESS 4.2 G (LIMIT 3.8)')
    log.add(50, 'windshear', 'WINDSHEAR')
    log.add(80, 'windshear', 'WINDSHEAR')
    log.add(95, 'hydroplaning', 'HYDROPLANING')
    log.noteIce(1.2); log.noteIce(2.6); log.noteIce(0.4)
    expect(environmentDebrief(log, 4.2, -0.6)).toBe('MAX 4.2 G · MIN -0.6 G · OVERSTRESS · WINDSHEAR ×2 · ICE 2.6 MM · HYDROPLANED')
    expect(log.kinds().sort()).toEqual(['hydroplaning', 'overstress', 'windshear'])
  })

  it('a structural failure outranks the overstress that preceded it', () => {
    const log = new FlightEventLog()
    log.add(1, 'overstress', 'x'); log.add(2, 'failure', 'y')
    expect(environmentDebrief(log, 6, 1)).toBe('MAX 6.0 G · STRUCTURAL FAILURE')
    log.reset()
    expect(environmentDebrief(log, 1, 1)).toBe('')
  })
})
