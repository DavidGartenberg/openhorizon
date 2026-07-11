import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * §4.1: /sim (and /math) must stay pure — importable headless in Node with no
 * three.js or DOM dependencies. This guards the architecture rule in CI.
 */
const PURE_DIRS = ['src/sim', 'src/math']

function tsFilesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f))
}

describe('sim purity', () => {
  it('src/sim and src/math never import three.js or touch the DOM', () => {
    const offenders: string[] = []
    for (const dir of PURE_DIRS) {
      for (const file of tsFilesUnder(dir)) {
        const source = fs.readFileSync(file, 'utf8')
        if (/from\s+['"]three/.test(source) || /require\(['"]three/.test(source)) {
          offenders.push(`${file}: imports three`)
        }
        if (/\b(document|window)\./.test(source)) {
          offenders.push(`${file}: touches the DOM`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('pure dirs actually contain code (guard against the test going stale)', () => {
    expect(tsFilesUnder('src/sim').length).toBeGreaterThan(0)
    expect(tsFilesUnder('src/math').length).toBeGreaterThan(0)
  })
})
