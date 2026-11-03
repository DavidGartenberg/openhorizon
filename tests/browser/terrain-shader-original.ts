/** The terrain program as it was at the branch base (2db308d), for A/B cost
 *  measurements in the preview harness (?shader=original). Test-only. */
import { SKY_LOOKUP } from '../../src/render/atmosphere-shader'
import { TERRAIN_COVERAGE_GLSL } from '../../src/world/terrain-coverage'
export const ORIGINAL_TERRAIN_VERT = /* glsl */ `
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
export const ORIGINAL_TERRAIN_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uDayness, uLowSun, uFogDensity, uHasImagery, uSunTransmission, uCloudDensity;
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
  void main() {
    if (coveredByReadyTerrain(vUv)) discard;
    vec2 ground = vWXZ + uWorldOffset;
    float ndl = max(dot(normalize(vNormal),normalize(uSunDir)),0.0);
    vec3 sunTint = vec3(1.0,1.0-0.35*uLowSun,1.0-0.65*uLowSun);
    // Vertex palette is authored as display RGB; imagery is tagged sRGB
    // on upload and is decoded by the texture sampler into linear light.
    vec3 albedo = pow(max(vColor,vec3(0)),vec3(2.2));
    vec4 tex = texture2D(uImagery,vUv);
    float imW = uHasImagery*tex.a*(1.0-smoothstep(38000.0,46000.0,vDist));
    albedo = mix(albedo,tex.rgb,imW);
    float footprint = max(length(dFdx(ground)),length(dFdy(ground)));
    float macro = noise(ground*0.018);
    float detail = noise(ground*0.7);
    float nearDetail = (1.0-smoothstep(1.0,5.0,footprint));
    // Broad biome variation is suppressed on photos; fine grain fades by
    // pixel footprint, keeping low passes detailed and distant hills stable.
    albedo *= mix(0.82+0.36*macro,1.0,imW*0.9);
    albedo *= 1.0+(detail-0.5)*0.16*nearDetail;
    float direct = mix(ndl,mix(1.0,ndl,0.4),imW);
    vec3 lit = albedo*(vec3(0.015)+vec3(0.35,0.43,0.53)*uDayness+
      sunTint*0.65*uDayness*direct*uSunTransmission);
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
