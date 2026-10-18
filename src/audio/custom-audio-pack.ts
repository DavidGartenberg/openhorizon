import type { ContinuousAural, OneShotAural } from '../sim/boeing-aurals'
import { STATIC_SAFETY_PHRASES } from './browser-speech'

/**
 * User-supplied flight-deck audio pack. The project ships only ORIGINAL
 * synthesized aurals and voices; a user who holds a licence to other
 * recordings (e.g. an OEM or add-on sound pack) can drop them into
 * `public/audio/boeing-custom/` with a `manifest.json`, and the 737 deck
 * plays those instead. The folder is git-ignored, so licensed files never
 * enter the repository. Format:
 *
 *   { "aurals": { "fireBell": "bell.wav", "apWailer": "ap-disc.wav", ... },
 *     "voice":  { "PULL UP": "pull-up.wav", "SINK RATE": "sink-rate.wav", ... } }
 *
 * Aural keys: fireBell, apWailer, configHorn, gearHorn, clacker,
 * stickShaker (looped) and altAlert (one-shot). Voice keys are the
 * standard EGPWS/TCAS phrases. Missing entries keep the built-in sound.
 */
export const CUSTOM_PACK_BASE = '/audio/boeing-custom/'
export const CUSTOM_AURALS: ReadonlyArray<ContinuousAural | OneShotAural> = ['fireBell', 'apWailer', 'configHorn', 'gearHorn', 'clacker', 'stickShaker', 'altAlert']

export interface CustomPack {
  aurals: Partial<Record<ContinuousAural | OneShotAural, string>>
  voice: Record<string, string>
}

/** A plain file name inside the pack folder with an audio extension —
 *  no paths, no traversal, no remote URLs. Pure — tested. */
export function safePackFile(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  return /^[A-Za-z0-9][A-Za-z0-9._ -]{0,80}\.(wav|mp3|ogg|m4a|flac)$/i.test(name) && !name.includes('..') ? name : undefined
}

/** Validate a manifest: unknown keys and unsafe file names are dropped. */
export function parseCustomPack(json: unknown): CustomPack {
  const out: CustomPack = { aurals: {}, voice: {} }
  if (!json || typeof json !== 'object') return out
  const j = json as { aurals?: unknown; voice?: unknown }
  if (j.aurals && typeof j.aurals === 'object') {
    for (const key of CUSTOM_AURALS) {
      const f = safePackFile((j.aurals as Record<string, unknown>)[key])
      if (f) out.aurals[key] = CUSTOM_PACK_BASE + f
    }
  }
  if (j.voice && typeof j.voice === 'object') {
    const phrases = new Set<string>(STATIC_SAFETY_PHRASES)
    for (const [phrase, file] of Object.entries(j.voice as Record<string, unknown>)) {
      const f = safePackFile(file)
      if (f && phrases.has(phrase)) out.voice[phrase] = CUSTOM_PACK_BASE + f
    }
  }
  return out
}

/** Fetch the pack manifest; an absent pack is the normal case. */
export async function loadCustomPack(fetcher: typeof fetch = fetch): Promise<CustomPack> {
  try {
    const r = await fetcher(CUSTOM_PACK_BASE + 'manifest.json', { cache: 'no-store' })
    if (!r.ok) return parseCustomPack(null)
    const type = r.headers.get('content-type') ?? ''
    if (!type.includes('json')) return parseCustomPack(null) // dev servers answer 404s with index.html
    return parseCustomPack(await r.json())
  } catch {
    return parseCustomPack(null)
  }
}
