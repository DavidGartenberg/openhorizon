/**
 * Finds the glass display openings in the X-Plane 737-800 instrument panel.
 *
 * The panel has one blank black "recess" draw (738_cockpit_main, start 27489,
 * count 78). Everything in front of it is projected onto the recess plane (its
 * TRUE geometric normal, ~(0, 0.29, 0.96) — not the mesh's shading normals, which
 * are ~10° off and would bury the screens); the uncovered rectangles are the
 * screens. Their corners are what XP_B738_SCREENS in src/render/xplane-cockpit.ts holds.
 *
 *   npx vite-node scripts/xplane/find-screens.ts
 *
 * Reads the user's own install (XPLANE_DIR = the "Laminar Research" folder); nothing is copied.
 */
import fs from 'node:fs'
import { parseObj8 } from '../../src/render/xplane-obj8'
const dir = (process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research') + '/Boeing 737-800/objects/'
const load = (f: string) => parseObj8(fs.readFileSync(dir + f + '.obj', 'utf8'))
const main = load('738_cockpit_main')
// the recess draw: start 27489 count 78 (draw with those numbers)
const rd = main.draws.find(d => d.start === 27489 && d.count === 78)!
const tri = (p: typeof main, i: number) => [p.indices[i]!, p.indices[i+1]!, p.indices[i+2]!]
const P = (p: typeof main, v: number): [number, number, number] => [p.vertices[v*3]!, p.vertices[v*3+1]!, p.vertices[v*3+2]!]
// plane from the recess triangles: the TRUE geometric normal of the big recess triangle (not the file's shading normals)
const T = tri(main, rd.start)  // first recess triangle is on the main plane
const pa = P(main, T[0]!), pb = P(main, T[1]!), pc = P(main, T[2]!)
const e1 = [pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]], e2 = [pc[0]-pa[0], pc[1]-pa[1], pc[2]-pa[2]]
let gx = e1[1]!*e2[2]!-e1[2]!*e2[1]!, gy = e1[2]!*e2[0]!-e1[0]!*e2[2]!, gz = e1[0]!*e2[1]!-e1[1]!*e2[0]!
const gl = Math.hypot(gx,gy,gz); gx/=gl; gy/=gl; gz/=gl
if (gz < 0) { gx=-gx; gy=-gy; gz=-gz }
const n: [number,number,number] = [gx, gy, gz]
const c0: [number,number,number] = [0, 0.347, 1.8207]
console.log('geometric recess normal', n.map(v=>v.toFixed(3)), 'point on plane', c0)
const N = main.normals, V = main.vertices
const cross = (a: number[], b: number[]) => [a[1]!*b[2]!-a[2]!*b[1]!, a[2]!*b[0]!-a[0]!*b[2]!, a[0]!*b[1]!-a[1]!*b[0]!]
const norm = (a: number[]) => { const l = Math.hypot(a[0]!,a[1]!,a[2]!); return [a[0]!/l, a[1]!/l, a[2]!/l] as [number,number,number] }
const u = norm(cross([0,1,0], n)), v = norm(cross(n, u))
const dot = (a: number[], b: number[]) => a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!
const to2 = (q: number[]) => { const d = [q[0]!-c0[0], q[1]!-c0[1], q[2]!-c0[2]]; return [dot(d,u), dot(d,v), dot(d,n)] as [number,number,number] }
// recess bounds in (u,v)
let umin=1e9, umax=-1e9, vmin=1e9, vmax=-1e9
for (let i = rd.start; i < rd.start + rd.count; i++) { const [a,b] = to2(P(main, main.indices[i]!)); umin=Math.min(umin,a); umax=Math.max(umax,a); vmin=Math.min(vmin,b); vmax=Math.max(vmax,b) }
console.log('recess uv bounds', [umin,umax,vmin,vmax].map(x=>x.toFixed(3)))
const RES = 0.001, W = Math.ceil((umax-umin)/RES)+1, H = Math.ceil((vmax-vmin)/RES)+1
const rasterize = (tris: Array<[number[],number[],number[]]>) => {
  const m = new Uint8Array(W*H)
  for (const [a,b,c] of tris) {
    const A=[(a[0]!-umin)/RES,(a[1]!-vmin)/RES], B=[(b[0]!-umin)/RES,(b[1]!-vmin)/RES], C=[(c[0]!-umin)/RES,(c[1]!-vmin)/RES]
    const x0=Math.max(0,Math.floor(Math.min(A[0]!,B[0]!,C[0]!))), x1=Math.min(W-1,Math.ceil(Math.max(A[0]!,B[0]!,C[0]!)))
    const y0=Math.max(0,Math.floor(Math.min(A[1]!,B[1]!,C[1]!))), y1=Math.min(H-1,Math.ceil(Math.max(A[1]!,B[1]!,C[1]!)))
    const den = (B[1]!-C[1]!)*(A[0]!-C[0]!)+(C[0]!-B[0]!)*(A[1]!-C[1]!); if (Math.abs(den) < 1e-9) continue
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
      const w1=((B[1]!-C[1]!)*(x-C[0]!)+(C[0]!-B[0]!)*(y-C[1]!))/den, w2=((C[1]!-A[1]!)*(x-C[0]!)+(A[0]!-C[0]!)*(y-C[1]!))/den, w3=1-w1-w2
      if (w1>=-0.02&&w2>=-0.02&&w3>=-0.02) m[y*W+x]=1
    }
  }
  return m
}
const recessTris: Array<[number[],number[],number[]]> = []
for (let i = rd.start; i < rd.start + rd.count; i += 3) recessTris.push(tri(main,i).map(vi => to2(P(main,vi))) as any)
const R = rasterize(recessTris)
// everything IN FRONT of the plane (toward the eye side = +n), from all panel objects
const front: Array<[number[],number[],number[]]> = []
for (const f of ['738_cockpit_main','738_cockpit_ind','738_cockpit_glass','738_cockpit_pdstl']) {
  const p = f === '738_cockpit_main' ? main : load(f)
  for (const d of p.draws) { if (d.lod !== 0) continue; if (p === main && d === rd) continue
    for (let i = d.start; i < d.start + d.count; i += 3) { const q = tri(p,i).map(vi => to2(P(p,vi)))
      const dmin = Math.min(q[0]![2]!,q[1]![2]!,q[2]![2]!), dmax = Math.max(q[0]![2]!,q[1]![2]!,q[2]![2]!)
      if (dmax > 0.0015 && dmin > -0.001) front.push(q as any) } }
}
const F = rasterize(front)
const hole = new Uint8Array(W*H); for (let i = 0; i < hole.length; i++) hole[i] = R[i] && !F[i] ? 1 : 0
// components
const seen = new Uint8Array(W*H); const comps: Array<{n:number,x0:number,x1:number,y0:number,y1:number}> = []
for (let s = 0; s < hole.length; s++) { if (!hole[s] || seen[s]) continue
  const stack=[s]; seen[s]=1; let n=0,x0=1e9,x1=-1,y0=1e9,y1=-1
  while (stack.length) { const k=stack.pop()!; const x=k%W, y=(k/W)|0; n++; x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const xx=x+dx!, yy=y+dy!; if (xx<0||yy<0||xx>=W||yy>=H) continue; const kk=yy*W+xx; if (hole[kk]&&!seen[kk]) { seen[kk]=1; stack.push(kk) } } }
  if (n > 3000) comps.push({n,x0,x1,y0,y1}) }
console.log('hole components:', comps.length)
const back = (uu: number, vv: number) => [c0[0]+u[0]*uu+v[0]*vv, c0[1]+u[1]*uu+v[1]*vv, c0[2]+u[2]*uu+v[2]*vv]
for (const c of comps.sort((a,b)=>a.x0-b.x0)) {
  const ul = umin+c.x0*RES, ur = umin+c.x1*RES, vb = vmin+c.y0*RES, vt = vmin+c.y1*RES
  const fill = c.n / ((c.x1-c.x0+1)*(c.y1-c.y0+1))
  console.log(`  ${((ur-ul)*1000).toFixed(0)}x${((vt-vb)*1000).toFixed(0)} mm fill=${fill.toFixed(2)} TL=${back(ul,vt).map(x=>x.toFixed(3))} TR=${back(ur,vt).map(x=>x.toFixed(3))} BL=${back(ul,vb).map(x=>x.toFixed(3))}`)
}
