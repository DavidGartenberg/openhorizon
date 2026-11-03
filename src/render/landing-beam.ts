import * as THREE from 'three'

/**
 * Volumetric landing-light beam: a cone from the airframe's nose, aimed a
 * few degrees down, whose shader integrates the light scattered toward the
 * eye along each view ray through it. Near the lamp it is bright
 * (inverse-square falloff along the beam) and its edges are soft
 * (cos-power off-axis falloff). It shows in rain, snow and fog at night,
 * like a real landing light, and the beam is cut where it meets the ground.
 * Works from outside the cone (chase view) and from inside it (cockpit).
 */
export const BEAM_HALF_ANGLE_RAD = (10 * Math.PI) / 180
export const BEAM_DOWN_RAD = (6 * Math.PI) / 180

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uApex, uAxis, uColor;
  uniform float uCos2, uTanHalf, uLength, uIntensity;
  varying vec3 vWorld;
  float beamAt(vec3 p) {
    vec3 d = p - uApex;
    float along = dot(d, uAxis);
    if (along <= 0.2 || along >= uLength) return 0.0;
    float c = along / length(d); // cos of the off-axis angle
    float cosHalf = sqrt(uCos2);
    float ang = smoothstep(cosHalf, mix(cosHalf, 1.0, 0.65), c);
    float fall = 1.0 / (1.0 + along * along / 400.0);
    float endFade = 1.0 - smoothstep(0.75 * uLength, uLength, along);
    return ang * fall * endFade;
  }
  void main() {
    vec3 ro = cameraPosition;
    vec3 seg = vWorld - ro;
    float tFrag = length(seg);
    vec3 rd = seg / max(tFrag, 1e-4);
    vec3 dc = ro - uApex;
    float camAlong = dot(dc, uAxis);
    bool camInside = camAlong > 0.0 && camAlong < uLength && camAlong / max(length(dc), 1e-4) > sqrt(uCos2);
    float t0, t1;
    if (gl_FrontFacing) {
      // Outside the cone: from where the ray enters, across the chord.
      if (camInside) discard;
      float al = max(dot(vWorld - uApex, uAxis), 0.5);
      t0 = tFrag;
      t1 = tFrag + clamp(2.4 * al * uTanHalf, 1.5, 90.0);
    } else {
      // Inside it: from the eye to where the ray leaves.
      if (!camInside) discard;
      t0 = 0.0;
      t1 = tFrag;
    }
    float dt = (t1 - t0) / 10.0, sum = 0.0;
    for (int i = 0; i < 10; i++) sum += beamAt(ro + rd * (t0 + (float(i) + 0.5) * dt));
    vec3 col = uColor * sum * dt * uIntensity * 0.02;
    if (max(col.r, max(col.g, col.b)) < 0.0015) discard;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** How bright the beam reads: something must scatter it (rain, snow, fog,
 *  a little haze) and it must be dark enough to see. 0..~3. */
export function beamIntensity(precip: number, fog: number, night: number): number {
  return (0.15 + 2.5 * Math.max(precip, 0) + 1.5 * Math.max(fog, 0)) * Math.max(Math.min(night, 1), 0)
}

/** Length of beam above the ground, m: a lamp aimed `downRad` below the
 *  airframe's pitch at `pitchRad` from `aglM` reaches the ground there. */
export function beamGroundCut(aglM: number, pitchRad: number, maxM: number, downRad = BEAM_DOWN_RAD): number {
  const dive = downRad - pitchRad
  if (dive <= 0.01) return maxM
  return Math.max(Math.min(Math.max(aglM, 0.5) / Math.sin(dive), maxM), 2)
}

export class LandingBeam {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly apex = new THREE.Vector3()
  private readonly axis = new THREE.Vector3()

  /** @param apexLocal lamp position in the aircraft group's frame (−z forward) */
  constructor(readonly maxLengthM: number, apexLocal: THREE.Vector3) {
    const r = maxLengthM * Math.tan(BEAM_HALF_ANGLE_RAD)
    const geo = new THREE.ConeGeometry(r, maxLengthM, 24, 1, false)
    geo.translate(0, -maxLengthM / 2, 0) // apex at the origin, opening along −y
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uApex: { value: this.apex }, uAxis: { value: this.axis }, uColor: { value: new THREE.Color(1, 0.95, 0.86) },
        uCos2: { value: Math.cos(BEAM_HALF_ANGLE_RAD) ** 2 }, uTanHalf: { value: Math.tan(BEAM_HALF_ANGLE_RAD) },
        uLength: { value: maxLengthM }, uIntensity: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.position.copy(apexLocal)
    // −y (the cone's opening) → forward (−z) and BEAM_DOWN below it.
    const target = new THREE.Vector3(0, -Math.sin(BEAM_DOWN_RAD), -Math.cos(BEAM_DOWN_RAD))
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 27
    this.mesh.visible = false
  }

  update(on: boolean, intensity: number, lengthM: number): void {
    this.mesh.visible = on && intensity > 0.01
    if (!this.mesh.visible) return
    this.mesh.updateWorldMatrix(true, false)
    this.apex.setFromMatrixPosition(this.mesh.matrixWorld)
    this.axis.set(0, -1, 0).transformDirection(this.mesh.matrixWorld)
    this.mat.uniforms.uIntensity!.value = intensity
    this.mat.uniforms.uLength!.value = Math.min(lengthM, this.maxLengthM)
  }
}
