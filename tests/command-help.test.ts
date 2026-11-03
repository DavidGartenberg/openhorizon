import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { COMMANDS, helpText } from '../src/ui/command-help'

describe('command help', () => {
  it('documents every typed command main.ts handles', () => {
    const src = fs.readFileSync('src/main.ts', 'utf8')
    const handled = new Set([...src.matchAll(/parts\[0\] === '([A-Z0-9_-]+)'/g)].map((m) => m[1]))
    const documented = new Set(COMMANDS.map((c) => c.word))
    const missing = [...handled].filter((w) => !documented.has(w!))
    expect(missing).toEqual([])
    expect([...documented].filter((w) => !handled.has(w))).toEqual([])
  })

  it('renders one aligned line per command', () => {
    const lines = helpText().split('\n')
    expect(lines.length).toBe(COMMANDS.length + 1)
  })
})
