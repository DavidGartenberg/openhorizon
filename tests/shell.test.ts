import { describe, expect, it } from 'vitest'
import { launchCommand, parsePendingLaunch, type LaunchChoice } from '../src/ui/shell/launcher'
import { toolbarVisible } from '../src/ui/shell/toolbar'
import { clampWindowPos } from '../src/ui/shell/window'
import { noteKind } from '../src/ui/shell/notify'
import { planeMenuEntries } from '../src/render/plane-menu'

const choice: LaunchChoice = { aircraft: 'A320', airport: 'KSFO', runway: '28R', final: true, time: 'sunset', weather: 'clear' }

describe('free-flight launch', () => {
  it('builds the same spawn command the search box uses', () => {
    expect(launchCommand(choice)).toBe('KSFO 28R FINAL')
    expect(launchCommand({ ...choice, runway: undefined, final: false })).toBe('KSFO')
  })
  it('round-trips a launch across a reload and rejects anything malformed', () => {
    expect(parsePendingLaunch(JSON.stringify(choice))).toEqual(choice)
    expect(parsePendingLaunch(null)).toBeNull()
    expect(parsePendingLaunch('{oops')).toBeNull()
    expect(parsePendingLaunch(JSON.stringify({ ...choice, airport: 'KSFO; drop' }))).toBeNull()
    expect(parsePendingLaunch(JSON.stringify({ ...choice, runway: '28R<script>' }))).toBeNull()
    expect(parsePendingLaunch(JSON.stringify({ ...choice, time: 'midnight' }))).toBeNull()
    expect(parsePendingLaunch(JSON.stringify({ ...choice, weather: 'hail' }))).toBeNull()
  })
  it('offers every flyable aircraft, grouped', () => {
    const list = planeMenuEntries()
    expect(list.length).toBeGreaterThan(100)
    expect(list.slice(0, 3).map(e => e.key)).toEqual(expect.arrayContaining(['172', 'CUB', '737']))
  })
})

describe('shell behaviour', () => {
  it('toolbar shows near the top edge, while hovered, briefly after use, or pinned — hides otherwise', () => {
    const base = { pointerY: 500, overToolbar: false, msSinceWanted: 10_000, pinned: false }
    expect(toolbarVisible(base)).toBe(false)
    expect(toolbarVisible({ ...base, pointerY: 20 })).toBe(true)
    expect(toolbarVisible({ ...base, overToolbar: true })).toBe(true)
    expect(toolbarVisible({ ...base, msSinceWanted: 800 })).toBe(true)
    expect(toolbarVisible({ ...base, pinned: true })).toBe(true)
  })
  it('a dragged window keeps its title bar reachable', () => {
    expect(clampWindowPos(-5000, -50, 400, 1280, 800)).toEqual({ x: 8 - 400 + 120, y: 52 })
    expect(clampWindowPos(5000, 5000, 400, 1280, 800)).toEqual({ x: 1160, y: 756 })
    expect(clampWindowPos(300, 200, 400, 1280, 800)).toEqual({ x: 300, y: 200 })
  })
  it('notifications are coloured by urgency', () => {
    expect(noteKind('ENGINE QUIT — inverted')).toBe('alert')
    expect(noteKind('NO ATC IN RANGE')).toBe('warn')
    expect(noteKind('GEAR DOWN')).toBe('info')
  })
})
