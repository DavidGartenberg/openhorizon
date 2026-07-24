/**
 * Imagery proxy payload validation (Phase 13b): the disk cache must only
 * ever hold real image bytes — an upstream error page cached as .jpg
 * would poison the tile forever. Magic bytes, not headers, decide.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error untyped .mjs module (precedent: aircraft-types-parse)
import { isImageBuf } from '../server/parse.mjs'

describe('isImageBuf', () => {
  it('accepts JPEG magic (FF D8 FF)', () => {
    expect(isImageBuf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(true)
  })
  it('accepts PNG magic (89 50 4E 47)', () => {
    expect(isImageBuf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(true)
  })
  it('rejects an HTML error page', () => {
    expect(isImageBuf(new TextEncoder().encode('<!DOCTYPE html><html>Service unavailable</html>'))).toBe(false)
  })
  it('rejects empty and truncated payloads', () => {
    expect(isImageBuf(new Uint8Array([]))).toBe(false)
    expect(isImageBuf(new Uint8Array([0xff]))).toBe(false)
  })
})
