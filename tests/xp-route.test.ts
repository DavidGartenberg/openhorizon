/**
 * Local X-Plane asset route (server/xp-static.mjs): the path-safety helper
 * must keep every request inside the configured aircraft folder and on the
 * .obj/.png/.dds/.txt allow-list, and the manifest must report honestly
 * when the install is absent.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error untyped .mjs module (precedent: imagery-validate)
import { resolveXpPath, xpManifest, xpContentType } from '../server/xp-static.mjs'

const BASE = '/fake/X-Plane 12/Aircraft/Laminar Research'

describe('resolveXpPath', () => {
  it('rejects .. traversal (plain, nested, and percent-encoded)', () => {
    expect(resolveXpPath('../../etc/passwd.txt', BASE)).toBeNull()
    expect(resolveXpPath('Cessna 172 SP/../../../etc/passwd.txt', BASE)).toBeNull()
    expect(resolveXpPath('%2e%2e/%2e%2e/etc/passwd.txt', BASE)).toBeNull()
    expect(resolveXpPath('Cessna%20172%20SP%2F..%2F..%2Fsecret.txt', BASE)).toBeNull()
  })

  it('rejects absolute paths, backslashes, NUL bytes, empty segments and bad encoding', () => {
    expect(resolveXpPath('/etc/passwd.txt', BASE)).toBeNull()
    expect(resolveXpPath('%2Fetc%2Fpasswd.txt', BASE)).toBeNull()
    expect(resolveXpPath('..\\..\\win.txt', BASE)).toBeNull()
    expect(resolveXpPath('Cessna 172 SP/x.obj%00.png', BASE)).toBeNull()
    expect(resolveXpPath('Cessna 172 SP//x.obj', BASE)).toBeNull()
    expect(resolveXpPath('./Cessna 172 SP/x.obj', BASE)).toBeNull()
    expect(resolveXpPath('', BASE)).toBeNull()
    expect(resolveXpPath('%E0%A4%A', BASE)).toBeNull()
  })

  it('never resolves into a sibling dir that merely shares the base prefix', () => {
    expect(resolveXpPath('../Laminar Research-evil/x.obj', BASE)).toBeNull()
  })

  it('rejects extensions outside the allow-list', () => {
    expect(resolveXpPath('Cessna 172 SP/Cessna_172SP.acf', BASE)).toBeNull()
    expect(resolveXpPath('Cessna 172 SP/X-Plane G1000 Manual.pdf', BASE)).toBeNull()
    expect(resolveXpPath('Cessna 172 SP/objects', BASE)).toBeNull()
    expect(resolveXpPath('Cessna 172 SP/x.obj.exe', BASE)).toBeNull()
  })

  it('accepts allowed files under the base with the right Content-Type', () => {
    expect(resolveXpPath('Cessna%20172%20SP/Cessna_172SP_cockpit.obj', BASE)).toEqual({
      abs: path.join(BASE, 'Cessna 172 SP', 'Cessna_172SP_cockpit.obj'),
      contentType: 'text/plain; charset=utf-8',
    })
    expect(resolveXpPath('Cessna 172 SP/objects/fuselage.PNG', BASE)?.contentType).toBe('image/png')
    expect(resolveXpPath('Boeing 737-800/objects/wing.dds', BASE)?.contentType).toBe('application/octet-stream')
    expect(resolveXpPath('Cessna 172 SP/Cessna_172SP_vrconfig.txt', BASE)?.contentType).toBe('text/plain; charset=utf-8')
  })
})

describe('xpContentType', () => {
  it('maps the four allowed extensions (case-insensitive) and nothing else', () => {
    expect(xpContentType('.obj')).toBe('text/plain; charset=utf-8')
    expect(xpContentType('.png')).toBe('image/png')
    expect(xpContentType('.DDS')).toBe('application/octet-stream')
    expect(xpContentType('.txt')).toBe('text/plain; charset=utf-8')
    expect(xpContentType('.acf')).toBeNull()
    expect(xpContentType('')).toBeNull()
  })
})

describe('xpManifest', () => {
  it('reports available:false with the configured base when the dir is missing', () => {
    expect(xpManifest('/definitely/not/an/xplane/install')).toEqual({
      available: false,
      base: '/definitely/not/an/xplane/install',
    })
  })
  it('reports available:true for an existing directory', () => {
    expect(xpManifest(process.cwd()).available).toBe(true)
  })
})
