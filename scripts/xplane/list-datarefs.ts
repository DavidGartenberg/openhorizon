/**
 * Lists every dataref animated by the X-Plane 737-800 cockpit objects, with the
 * animation kind, the largest key value and which objects use it. Writes
 * `xp-refs.txt` (tab-separated) to $OUT or the current directory.
 *
 *   npx vite-node scripts/xplane/list-datarefs.ts
 *
 * Reads the user's own install (XPLANE_DIR = the "Laminar Research" folder); nothing is copied.
 * Dev tool, not part of the app: it is why the cockpit's dataref mapping is built the way it is.
 */
import fs from 'node:fs'
import { parseObj8 } from '../../src/render/xplane-obj8'
const dir = (process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research') + '/Boeing 737-800/objects/'
const files = ['floor','main','ovhd2','ovhd1','roof','pdstl','seats','yokes','switch','ind','glass'].map(n => '738_cockpit_' + n)
const refs = new Map<string, {n: number; kinds: Set<string>; maxKey: number; files: Set<string>}>()
for (const f of files) {
  const p = parseObj8(fs.readFileSync(dir + f + '.obj', 'utf8'))
  for (const node of p.anims) for (const s of node.specs) {
    const r = refs.get(s.dataref) ?? { n: 0, kinds: new Set(), maxKey: 0, files: new Set() }
    r.n++; r.kinds.add(s.kind); r.files.add(f.replace('738_cockpit_','')) 
    if (s.kind === 'rotate' || s.kind === 'trans') r.maxKey = Math.max(r.maxKey, ...s.keys.map(k => Math.abs(k[0])))
    refs.set(s.dataref, r)
  }
}
const rows = [...refs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
fs.writeFileSync((process.env.OUT ?? '.') + '/xp-refs.txt', rows.map(([k, r]) => `${k}\t${r.n}\t${[...r.kinds].join('+')}\t${r.maxKey}\t${[...r.files].join(',')}`).join('\n'))
console.log('distinct datarefs:', rows.length)
