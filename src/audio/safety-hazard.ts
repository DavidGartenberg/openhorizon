import type { SpeechMessage } from './safety-speech'

/**
 * The spoken hazard for this frame. Reactive windshear (jets) outranks
 * every GPWS/TAWS mode, as on real transports: "WINDSHEAR" is spoken
 * three times and repeats while the alert holds. Otherwise the TAWS aural,
 * at warning or caution priority.
 */
export function safetyHazard(windshear: boolean, taws: { level: string; aural?: string | null }): SpeechMessage | undefined {
  if (windshear) return { text: 'Windshear, windshear, windshear', priority: 4 }
  if (taws.level !== 'NONE' && taws.aural) return { text: taws.aural, priority: taws.level === 'WARNING' ? 4 : 2 }
  return undefined
}
