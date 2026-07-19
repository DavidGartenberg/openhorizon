/**
 * ATIS generation (§12.1, Phase 6b): broadcast text built from the SAME
 * BlendedWeather the physics flies in — never a separate weather story.
 * Missing weather is reported as unavailable, not invented (§1).
 */
import type { BlendedWeather } from '../weather/weather'

const PHONETIC = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
  'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
  'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
  'Xray', 'Yankee', 'Zulu',
]

export interface RunwayHeading {
  ident: string
  headingDeg: number
}

/** Best headwind component wins; calm defaults to the first runway. */
export function chooseActiveRunway(runways: readonly RunwayHeading[], windDirDeg: number): string {
  let best = runways[0]?.ident ?? ''
  let bestComp = -Infinity
  for (const r of runways) {
    const diff = ((windDirDeg - r.headingDeg + 540) % 360) - 180
    const comp = Math.cos((diff * Math.PI) / 180)
    if (comp > bestComp) {
      bestComp = comp
      best = r.ident
    }
  }
  return best
}

export interface AtisBroadcast {
  letter: string
  text: string
  activeRunway: string
}

const COVER_WORDS: Record<string, string> = {
  FEW: 'few clouds at', SCT: 'scattered clouds at', BKN: 'broken clouds at',
  OVC: 'overcast at', VV: 'indefinite ceiling',
}

export function buildAtis(
  facilityName: string,
  wx: BlendedWeather | null,
  runways: readonly RunwayHeading[],
  letterIndex: number,
): AtisBroadcast {
  const letter = PHONETIC[letterIndex % 26]!
  const activeRunway = chooseActiveRunway(runways, wx?.windDirDeg ?? 0)
  const parts: string[] = [`${facilityName} information ${letter}.`]
  if (wx) {
    parts.push(
      wx.windKt < 1
        ? 'wind calm.'
        : `wind ${String(Math.round(wx.windDirDeg)).padStart(3, '0')} at ${Math.round(wx.windKt)}${
            wx.gustKt > wx.windKt + 3 ? ` gusting ${Math.round(wx.gustKt)}` : ''
          }.`,
    )
    parts.push(`visibility ${wx.visibilitySm}.`)
    for (const c of wx.clouds) {
      const w = COVER_WORDS[c.cover]
      if (w) parts.push(c.cover === 'VV' ? `${w} ${c.baseFt} vertical visibility.` : `${w} ${c.baseFt}.`)
    }
    parts.push(`altimeter ${wx.qnhInHg.toFixed(2)}.`)
  } else {
    parts.push('weather unavailable.')
  }
  parts.push(`runway ${activeRunway} in use.`)
  parts.push(`advise on initial contact you have information ${letter}.`)
  return { letter, text: parts.join(' '), activeRunway }
}
