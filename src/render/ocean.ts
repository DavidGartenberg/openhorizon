import * as THREE from 'three'
import { seaState } from '../sim/weather/sea-state'
import { SKY_LOOKUP } from './atmosphere-shader'

/** Wind-driven deep-water wave spectrum with filtered normals, dielectric
 * Fresnel and the same HDR atmosphere used by the sky and aircraft reflections.
 * Sea remains a flat visual surface: no bathymetry or water-landing dynamics. */
export class Ocean {
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, sky: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSky: { value: sky }, uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uDayness: { value: 1 }, uSlopeScale: { value: 0.6 },
        uWhitecap: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) },
        uWorldOffset: { value: new THREE.Vector2() }, uFogDensity: { value: 9e-6 },
        uSunTransmission: { value: 1 },
        uCloudDensity: { value: 0 }, uCloudColor: { value: new THREE.Color(0xc8ccd2) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying float vCloudDepth;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vCloudDepth = -(viewMatrix * wp).z;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSky;
        uniform float uTime, uDayness, uSlopeScale, uWhitecap, uFogDensity, uSunTransmission, uCloudDensity;
        uniform vec3 uCloudColor;
        uniform vec3 uSunDir;
        uniform vec2 uWind, uWorldOffset;
        varying vec3 vWorldPos;
        varying float vCloudDepth;
        ${SKY_LOOKUP}
        void main() {
          vec2 p = vWorldPos.xz + uWorldOffset;
          float footprint = max(length(dFdx(p)), length(dFdy(p)));
          vec2 slope = vec2(0.0);
          mat2 wind = mat2(uWind.x, uWind.y, -uWind.y, uWind.x);
          // Deep water dispersion omega² = g*k. Progressive frequency
          // filtering removes waves before they become subpixel stripes.
          for (int i=0; i<16; i++) {
            float fi = float(i);
            float angle = (fract(sin(fi*127.1+31.7)*43758.5453)-0.5)*2.6;
            vec2 d = wind*vec2(cos(angle),sin(angle));
            float k = 0.035*pow(1.49,fi);
            float filterW = exp(-0.22*k*k*footprint*footprint);
            float amplitude = 0.06*pow(0.9,fi)*filterW;
            // Broad phase variation breaks the regular crossed-sine grid.
            float phase = 1.8*sin(dot(p,vec2(d.y,-d.x))*k*0.21+fi*3.7);
            slope += d*amplitude*cos(dot(p,d)*k-sqrt(9.81*k)*uTime+fi*5.17+phase);
          }
          slope *= uSlopeScale;
          vec3 n = normalize(vec3(-slope.x,1.0,-slope.y));
          vec3 v = normalize(cameraPosition-vWorldPos);
          float nv = max(dot(n,v),0.001);
          vec3 reflected = reflect(-v,n);
          reflected.y = max(reflected.y,0.003);
          // Water IOR 1.333 -> normal incidence reflectance 0.0204.
          float fresnel = 0.0204+0.9796*pow(1.0-nv,5.0);
          vec3 deep = vec3(0.003,0.018,0.028)*(0.05+0.95*uDayness);
          vec3 color = mix(deep,skyRadiance(uSky,reflected),fresnel);
          vec3 l = normalize(uSunDir);
          vec3 h = normalize(v+l);
          float nl = max(dot(n,l),0.0);
          float nh = max(dot(n,h),0.0);
          float vh = max(dot(v,h),0.0);
          // GGX specular lobe broadens with the unresolved wave variance.
          float roughness = clamp(0.065+0.04*uSlopeScale+0.025*log2(1.0+footprint),0.06,0.3);
          float a2 = pow(roughness,4.0);
          float denom = nh*nh*(a2-1.0)+1.0;
          float distribution = a2/(3.14159265*denom*denom);
          float k = roughness*roughness*0.5;
          float geometry = nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
          float f = 0.0204+0.9796*pow(1.0-vh,5.0);
          float spec = min(20.0, distribution*geometry*f/(4.0*nv+0.001));
          float low = 1.0-smoothstep(0.0,0.4,l.y);
          color += vec3(1.0,1.0-0.35*low,1.0-0.65*low)*spec*3.2*uDayness*uSunTransmission;
          float crest = smoothstep(0.24,0.5,length(slope));
          float breakup = 0.5+0.5*sin(dot(p,vec2(0.37,0.61))+uTime*0.8);
          float foam = uWhitecap*crest*breakup*exp(-footprint*0.2);
          color = mix(color,vec3(0.65,0.73,0.76)*uDayness,foam);
          float distance = length(cameraPosition-vWorldPos);
          vec3 hazeDir = normalize(vWorldPos-cameraPosition);
          hazeDir.y = max(hazeDir.y,0.015);
          float fog = 1.0-exp(-distance*uFogDensity);
          color = mix(color,skyRadiance(uSky,hazeDir),fog);
          gl_FragColor = vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
    // Match standard materials: cloud fog is composed in output color space.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uCloudColor,1.0)).rgb,
      1.0-exp(-vCloudDepth*vCloudDepth*uCloudDensity*uCloudDensity));
        }
      `,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(800_000, 800_000), this.material)
    mesh.rotation.x = -Math.PI/2
    scene.add(mesh)
  }

  setCloudFog(fog: THREE.FogExp2): void {
    this.material.uniforms.uCloudDensity!.value = fog.density
    ;(this.material.uniforms.uCloudColor!.value as THREE.Color).copy(fog.color)
  }

  update(timeSeconds: number, sunDir: THREE.Vector3, dayness: number, windMs: number,
    windTowardRad: number, worldOffsetE = 0, worldOffsetN = 0, fogDensity = 9e-6, sunTransmission = 1): void {
    const u = this.material.uniforms
    u.uTime!.value = timeSeconds
    ;(u.uSunDir!.value as THREE.Vector3).copy(sunDir)
    u.uDayness!.value = dayness
    const s = seaState(windMs)
    u.uSlopeScale!.value = s.slopeScale
    u.uWhitecap!.value = s.whitecap
    ;(u.uWind!.value as THREE.Vector2).set(Math.sin(windTowardRad),-Math.cos(windTowardRad))
    ;(u.uWorldOffset!.value as THREE.Vector2).set(worldOffsetE,-worldOffsetN)
    u.uFogDensity!.value = fogDensity
    u.uSunTransmission!.value = sunTransmission
  }
}
