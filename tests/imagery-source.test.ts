import { describe, expect, it } from 'vitest'
import { googleStyle, imageryBasePath, isGoogleSource, parseImagerySource, resolveImagerySource, viewBounds, IMAGERY_SOURCES } from '../src/world/imagery-source'

describe('imagery source selection', () => {
  it('maps every source to its tile route', () => {
    expect(imageryBasePath('usgs')).toBe('/proxy/imagery')
    expect(imageryBasePath('google-satellite')).toBe('/proxy/gmaps/satellite')
    expect(imageryBasePath('google-hybrid')).toBe('/proxy/gmaps/hybrid')
    expect(imageryBasePath('google-roadmap')).toBe('/proxy/gmaps/roadmap')
    expect(IMAGERY_SOURCES.filter(s => s.google).every(s => isGoogleSource(s.id) && googleStyle(s.id))).toBe(true)
  })

  it('parses stored values and typed commands, defaulting to USGS', () => {
    expect(parseImagerySource(null)).toBe('usgs')
    expect(parseImagerySource('google-roadmap')).toBe('google-roadmap')
    expect(parseImagerySource('GOOGLE')).toBe('google-hybrid')
    expect(parseImagerySource('HYBRID')).toBe('google-hybrid')
    expect(parseImagerySource('MAP')).toBe('google-roadmap')
    expect(parseImagerySource('GOOGLE SATELLITE')).toBe('google-satellite')
    expect(parseImagerySource('nonsense')).toBe('usgs')
  })

  it('falls back to USGS when the server has no Google key', () => {
    expect(resolveImagerySource('google-hybrid', false)).toBe('usgs')
    expect(resolveImagerySource('google-hybrid', true)).toBe('google-hybrid')
    expect(resolveImagerySource('usgs', true)).toBe('usgs')
  })

  it('builds sane attribution bounds, clamped at the poles and dateline', () => {
    const b = viewBounds(37.5, -122.5)
    expect(b.north).toBeGreaterThan(b.south)
    expect(b.east).toBeGreaterThan(b.west)
    const p = viewBounds(89, 179.9)
    expect(p.north).toBeLessThanOrEqual(85)
    expect(p.east).toBeLessThanOrEqual(180)
  })
})
