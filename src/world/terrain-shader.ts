import { SKY_LOOKUP } from '../render/atmosphere-shader'
import { TERRAIN_COVERAGE_GLSL } from './terrain-coverage'

export const TERRAIN_VERT = /* glsl */ `
  uniform vec2 uNormalScale;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vDist, vCloudDepth;
  varying vec2 vUv;
  varying float vUrban;
  varying vec2 vWXZ;
  varying float vAltitude;
  attribute vec3 color;
  attribute float urban;
  void main() {
    vColor = color;
    vUv = uv;
    vUrban = urban;
    vNormal = normalize(mat3(modelMatrix) * (normal * vec3(uNormalScale.x, 1.0, uNormalScale.y)));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWXZ = wp.xz;
    vAltitude = wp.y;
    float dx = wp.x - cameraPosition.x;
    float dz = wp.z - cameraPosition.z;
    float d2 = dx*dx + dz*dz;
    wp.y -= d2 / (2.0 * 6371000.0); // earth curvature drop
    vDist = sqrt(d2);
    vCloudDepth = -(viewMatrix * wp).z;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
export const TERRAIN_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uDayness, uLowSun, uFogDensity, uHasImagery, uSunTransmission, uCloudDensity;
  // Surface weather (0..1): rain-wet ground and fresh snow cover.
  uniform float uWetness, uSnowCover;
  uniform vec3 uCloudColor;
  uniform sampler2D uImagery, uSky;
  uniform vec2 uWorldOffset;
  varying vec3 vColor, vNormal;
  varying float vDist, vUrban, vAltitude, vCloudDepth;
  varying vec2 vUv, vWXZ;
  ${SKY_LOOKUP}
  ${TERRAIN_COVERAGE_GLSL}
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx)*0.1031);
    p3 += dot(p3,p3.yzx+33.33);
    return fract((p3.x+p3.y)*p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
      mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  // Band-limited fBm in metres, centred on zero. p: ground position (m);
  // fp: pixel footprint (m); f0: base frequency (cycles/m). Every octave
  // fades out as its wavelength approaches the pixel size, so distant
  // terrain stays stable instead of shimmering and near terrain keeps
  // all of its fine structure. Octaves are rotated to hide the lattice.
  float fbmBL(vec2 p, float fp, float f0) {
    const mat2 R = mat2(0.8,-0.6,0.6,0.8);
    float f = f0, a = 0.5, s = 0.0;
    vec2 q = p;
    for (int i = 0; i < 5; i++) {
      float w = 1.0-smoothstep(0.25,0.6,fp*f);
      if (w <= 0.0) break;
      s += a*w*(noise(q*f)-0.5);
      q = R*q+vec2(31.7,17.3);
      f *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  vec3 toLinear(vec3 c) { return pow(max(c,vec3(0)),vec3(2.2)); }
  void main() {
    vec2 ground = vWXZ + uWorldOffset;
    // Derivatives are taken before the discard so they stay well-defined.
    float footprint = max(length(dFdx(ground)),length(dFdy(ground)));
    float altRate = max(abs(dFdx(vAltitude)),abs(dFdy(vAltitude)));
    if (coveredByReadyTerrain(vUv)) discard;
    vec3 L = normalize(uSunDir);
    vec3 N0 = normalize(vNormal);
    vec3 toEye = vec3(cameraPosition.x-vWXZ.x,cameraPosition.y-vAltitude,cameraPosition.z-vWXZ.y);
    vec3 V = normalize(toEye+vec3(1e-5));
    vec3 sunTint = vec3(1.0,1.0-0.35*uLowSun,1.0-0.65*uLowSun);
    // Vertex palette is authored as display RGB; imagery is tagged sRGB
    // on upload and is decoded by the texture sampler into linear light.
    vec3 albedo = toLinear(vColor);
    vec4 tex = texture2D(uImagery,vUv);
    float imW = uHasImagery*tex.a*(1.0-smoothstep(38000.0,46000.0,vDist));
    albedo = mix(albedo,tex.rgb,imW);
    float slope = 1.0-N0.y;                       // 0 flat .. 1 vertical
    float proc = 1.0-imW*0.85;                    // photos keep their own rock/snow
    // ---- broad biome variation (suppressed on photos) ----------------------
    float macro = clamp(0.5+1.6*fbmBL(ground,footprint,1.0/900.0),0.0,1.0);
    float regional = fbmBL(ground+vec2(713.0,-291.0),footprint,1.0/2600.0);
    albedo *= mix(0.82+0.36*macro,1.0,imW*0.9);
    albedo = mix(albedo,albedo*vec3(1.06,1.0,0.88),clamp(regional*2.0+0.5,0.0,1.0)*0.5*proc);
    // ---- cliffs: slope-driven rock with altitude strata --------------------
    float rockNoise = fbmBL(ground,footprint,1.0/70.0);
    float rock = smoothstep(0.17,0.34,slope+rockNoise*0.34)*proc;
    // Strata: wavy, noise-warped beds (~22 m) rather than ruled stripes, faded
    // out before they become sub-pixel and kept low-contrast so cliffs read as
    // layered stone, not zebra.
    float fa = 1.0-smoothstep(0.35,1.6,altRate);
    float band = vAltitude*0.045+rockNoise*5.0+regional*9.0;
    float strata = (0.5+0.5*sin(band*6.2831853))*fa;
    float scree = fbmBL(ground,footprint,1.0/9.0);
    vec3 rockCool = vec3(0.40,0.385,0.37), rockWarm = vec3(0.60,0.50,0.40);
    vec3 rockCol = mix(rockCool,rockWarm,clamp(0.5+regional*1.8,0.0,1.0));
    rockCol *= 0.86+0.2*strata*fa+0.1*(1.0-fa)+scree*0.45;
    albedo = mix(albedo,toLinear(rockCol),rock);
    // ---- snow: altitude line broken up by noise, held off the steeps -------
    float snowLine = 2850.0+260.0*regional*2.0;
    float snow = smoothstep(snowLine-120.0,snowLine+120.0,vAltitude+rockNoise*260.0);
    snow *= 1.0-smoothstep(0.26,0.5,slope+scree*0.12);
    snow *= proc;
    albedo = mix(albedo,toLinear(vec3(0.89,0.915,0.95)),snow);
    // ---- weather: fresh snow settles on all but the steeps (patchy while
    // it builds up); rain darkens and glosses whatever is not snow ----------
    if (uSnowCover > 0.0) {
      float patches = fbmBL(ground+vec2(-417.0,233.0),footprint,1.0/45.0);
      float settle = uSnowCover*(1.0-smoothstep(0.30,0.55,slope+scree*0.15))
        *smoothstep(-0.05,0.25,patches+uSnowCover*0.6-0.25);
      settle = clamp(settle,0.0,1.0);
      albedo = mix(albedo,toLinear(vec3(0.9,0.93,0.965)),settle);
      snow = max(snow,settle);
    }
    float wet = uWetness*(1.0-snow);
    albedo *= 1.0-0.32*wet;
    // ---- fine grain + procedural micro-relief (near field only) ------------
    float grain = fbmBL(ground,footprint,1.0/2.2);
    albedo *= 1.0+grain*0.62;
    float bumpFade = 1.0-smoothstep(2.5,9.0,footprint);
    vec3 N = N0;
    if (bumpFade > 0.0) {
      float relief = mix(0.5,2.3,rock)*(1.0-snow*0.7)*mix(1.0,0.4,imW);
      const float e = 0.45;
      float h0 = fbmBL(ground,footprint,1.0/26.0);
      float hx = fbmBL(ground+vec2(e,0.0),footprint,1.0/26.0);
      float hz = fbmBL(ground+vec2(0.0,e),footprint,1.0/26.0);
      vec2 g = vec2(hx-h0,hz-h0)/e*relief*bumpFade;
      N = normalize(N0-vec3(g.x,0.0,g.y));
    }
    float ndl = max(dot(N,L),0.0);
    float direct = mix(ndl,mix(1.0,ndl,0.4),imW);
    // Hemispheric ambient: slopes turned from the sky see less of it and
    // pick up a warm ground bounce instead; photos already carry baked AO.
    float skyVis = mix(0.5+0.5*N.y,1.0,imW*0.7);
    vec3 skyAmb = vec3(0.35,0.43,0.53)*uDayness*mix(0.5,1.0,skyVis);
    vec3 bounce = vec3(0.09,0.078,0.06)*uDayness*(1.0-skyVis)*(0.4+0.6*uSunTransmission);
    vec3 lit = albedo*(vec3(0.015)+skyAmb+bounce+
      sunTint*0.65*uDayness*direct*uSunTransmission);
    // Snow glints toward the sun.
    vec3 Hh = normalize(L+V);
    float glint = pow(max(dot(N,Hh),0.0),56.0)*snow*ndl;
    lit += sunTint*glint*0.22*uDayness*uSunTransmission;
    // Wet ground: a water film reflects the sky at grazing angles (Fresnel,
    // n = 1.33) and gives a tight sun glint — the wet-road look.
    if (wet > 0.0) {
      float nv = clamp(dot(N0,V),0.0,1.0);
      float fres = 0.02+0.98*pow(1.0-nv,5.0);
      vec3 refl = reflect(-V,N0);
      refl.y = max(refl.y,0.02);
      lit += skyRadiance(uSky,refl)*fres*wet*0.55;
      lit += sunTint*pow(max(dot(N0,Hh),0.0),160.0)*wet*0.9*uDayness*uSunTransmission;
    }
    float night = clamp(1.0-uDayness*1.6,0.0,1.0);
    if (night>0.001 && vUrban>0.001) {
      float h = hash(floor(ground/12.0));
      float speck = smoothstep(0.86,0.93,h)*(0.5+0.5*fract(h*9.7));
      lit += vUrban*night*vec3(1.0,0.5,0.16)*(0.005+0.4*speck*smoothstep(150.0,700.0,vDist));
    }
    vec3 direction = normalize(vec3(vWXZ.x-cameraPosition.x,
      vAltitude-cameraPosition.y,vWXZ.y-cameraPosition.z)+vec3(1e-5));
    vec3 hazeDir = normalize(vec3(direction.x,max(direction.y,0.015),direction.z));
    vec3 haze = skyRadiance(uSky,hazeDir);
    // Integrate an exponential height density along the viewing segment.
    float h0 = max(cameraPosition.y,0.0)/8000.0;
    float h1 = max(vAltitude,0.0)/8000.0;
    float dh = h1-h0;
    float meanDensity = abs(dh)<0.01 ? exp(-0.5*(h0+h1)) : (exp(-h0)-exp(-h1))/dh;
    float distance = length(vec3(vDist,vAltitude-cameraPosition.y,0.0));
    float fog = 1.0-exp(-distance*uFogDensity*meanDensity);
    lit = mix(lit,haze,fog);
    gl_FragColor = vec4(lit,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Match standard materials: cloud fog is composed in output color space.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uCloudColor,1.0)).rgb,
      1.0-exp(-vCloudDepth*vCloudDepth*uCloudDensity*uCloudDensity));
  }
`
