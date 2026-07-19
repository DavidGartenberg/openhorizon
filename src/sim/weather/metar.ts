/**
 * METAR parser (§11, Phase 5). Pure module — no network, no DOM. Parses the
 * fields the sim consumes (wind, visibility, present weather, cloud layers,
 * temp/dewpoint, altimeter); everything after RMK is ignored. Missing or
 * unparseable fields stay `undefined` — the weather model must handle
 * absence honestly rather than receive fabricated defaults (§1).
 */

export type CloudCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV'

export interface CloudLayer {
  cover: CloudCover
  baseFt: number // AGL, as reported
}

export interface ParsedMetar {
  station: string
  /** Degrees true, or 'VRB'. 0 with windKt 0 = calm. */
  windDirDeg?: number | 'VRB'
  windKt?: number
  gustKt?: number
  visibilitySm?: number
  /** Present-weather groups verbatim (e.g. '-RA', 'TSRA', 'BR', 'FG'). */
  weather: string[]
  clouds: CloudLayer[]
  tempC?: number
  dewpointC?: number
  altimeterInHg?: number
  raw: string
}

const WX_CODES =
  /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP){0,3}(BR|FG|FU|VA|DU|SA|HZ|PY)?(PO|SQ|FC|SS|DS)?$/

function parseTemp(t: string): number | undefined {
  const m = t.match(/^(M?)(\d{2})$/)
  if (!m) return undefined
  return (m[1] === 'M' ? -1 : 1) * parseInt(m[2]!, 10)
}

export function parseMetar(rawIn: string): ParsedMetar {
  const raw = rawIn.trim()
  const beforeRmk = raw.split(/\sRMK\s|\sRMK$/)[0]!
  const tokens = beforeRmk.split(/\s+/)
  // Live feeds prefix the report type ("METAR KDEN ..." / "SPECI KDEN ...").
  if (tokens[0] === 'METAR' || tokens[0] === 'SPECI') tokens.shift()
  const out: ParsedMetar = { station: tokens[0] ?? '', weather: [], clouds: [], raw }

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!

    // Wind: dddssKT / dddssGggKT / VRBssKT / 00000KT
    const wind = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/)
    if (wind) {
      out.windDirDeg = wind[1] === 'VRB' ? 'VRB' : parseInt(wind[1]!, 10)
      out.windKt = parseInt(wind[2]!, 10)
      if (wind[3]) out.gustKt = parseInt(wind[3]!, 10)
      continue
    }

    // Visibility: 10SM, 3SM, P6SM, M1/4SM, 1/2SM, or "1 1/2SM" (the whole-
    // number part was consumed as the previous token).
    const vis = t.match(/^([PM]?)(\d{1,2})?(?:(\d)\/(\d))?SM$/)
    if (vis && (vis[2] !== undefined || vis[3] !== undefined)) {
      let v = 0
      if (vis[3] !== undefined && vis[4] !== undefined) {
        v = parseInt(vis[3]!, 10) / parseInt(vis[4]!, 10)
        // Mixed fraction: previous token was a bare whole number ("1 1/2SM").
        const prev = tokens[i - 1]
        if (prev && /^\d{1,2}$/.test(prev)) v += parseInt(prev, 10)
      } else if (vis[2] !== undefined) {
        v = parseInt(vis[2]!, 10)
      }
      out.visibilitySm = v
      continue
    }

    // Cloud layers: FEW/SCT/BKN/OVC + 3-digit hundreds of feet; VVddd;
    // CLR/SKC/NSC/NCD = no layers.
    const cloud = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(?:CB|TCU)?$/)
    if (cloud) {
      out.clouds.push({ cover: cloud[1] as CloudCover, baseFt: parseInt(cloud[2]!, 10) * 100 })
      continue
    }
    if (/^(CLR|SKC|NSC|NCD)$/.test(t)) continue

    // Temperature/dewpoint: 17/11, M03/M07, 22/M01
    const temps = t.match(/^(M?\d{2})\/(M?\d{2})$/)
    if (temps) {
      out.tempC = parseTemp(temps[1]!)
      out.dewpointC = parseTemp(temps[2]!)
      continue
    }

    // Altimeter: A2992 (inHg ×100)
    const alt = t.match(/^A(\d{4})$/)
    if (alt) {
      out.altimeterInHg = parseInt(alt[1]!, 10) / 100
      continue
    }

    // Present weather (checked after the structured groups so tokens like
    // date/time "191956Z" or "AUTO" never match).
    if (t.length >= 2 && t !== 'AUTO' && !/\d/.test(t) && WX_CODES.test(t)) {
      out.weather.push(t)
    }
  }

  return out
}
