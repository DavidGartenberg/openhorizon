/**
 * Ground shadow catcher (13a): the terrain's custom ShaderMaterial can't
 * receive three.js shadow maps without hand-assembled shader chunks, so a
 * transparent ShadowMaterial plane pinned to the terrain height under the
 * aircraft catches the sun shadow instead. Exact over flattened airport
 * ground, approximate on slopes — recorded deviation. Opaque runway
 * strips (which DO receiveShadow) draw over it, so there is no
 * double-darkening on pavement.
 */
import * as THREE from 'three'

export class ShadowCatcher {
  readonly mesh: THREE.Mesh

  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShadowMaterial({ opacity: 0.32 })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), mat)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.receiveShadow = true
    this.mesh.renderOrder = 5 // over terrain, under airport surfaces (20)
    scene.add(this.mesh)
  }

  /** Pin under the aircraft at terrain height (render frame: y up). */
  update(xE: number, yUp: number, zS: number): void {
    this.mesh.position.set(xE, yUp + 0.04, zS)
  }
}
