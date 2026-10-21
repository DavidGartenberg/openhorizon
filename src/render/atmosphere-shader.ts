/** Shared linear HDR sky lookup. Longitude wraps, poles clamp. */
export const SKY_LOOKUP = /* glsl */ `
  vec2 skyUv(vec3 direction) {
    vec3 d = normalize(direction);
    return vec2(atan(d.z, d.x) / 6.28318530718 + 0.5,
                asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
  }
  vec3 skyRadiance(sampler2D sky, vec3 direction) {
    return texture2D(sky, skyUv(direction)).rgb;
  }
`

/** Metres, Rayleigh + aerosol single scattering, with ozone absorption (the
 * Chappuis band eats red and green, which is what makes a twilight zenith blue-violet). Integrated into a small
 * floating-point lookup, never at screen resolution. */
export const SKY_INTEGRATION = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uAltitude;
  varying vec2 vUv;
  const float PI = 3.14159265359;
  const float RP = 6371000.0;
  const float RA = 6471000.0;
  const vec3 BR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
  const float BM = 12e-6;
  const vec3 BO = vec3(0.65e-6, 1.881e-6, 0.085e-6);
  float atmosphereExit(vec3 p, vec3 d) {
    float b = dot(p, d);
    return -b + sqrt(max(0.0, b*b - dot(p,p) + RA*RA));
  }
  vec3 density(vec3 p) {
    float h = max(0.0, length(p) - RP);
    float ozone = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); // tent layer peaking at 25 km
    return vec3(exp(-h / vec2(8000.0, 1200.0)), ozone);
  }
  void main() {
    float longitude = (vUv.x - 0.5) * 2.0 * PI;
    float latitude = (vUv.y - 0.5) * PI;
    vec3 dir = vec3(cos(latitude)*cos(longitude), sin(latitude), cos(latitude)*sin(longitude));
    // Ground geometry covers the lower hemisphere. Continue the geometric
    // horizon radiance below it; the environment probe supplies ground.
    float horizon = -sqrt(2.0 * uAltitude / RP);
    dir.y = max(dir.y, horizon + 0.001);
    dir = normalize(dir);
    vec3 ro = vec3(0.0, RP + max(uAltitude, 20.0), 0.0);
    float ds = atmosphereExit(ro, dir) / 20.0;
    vec3 optical = vec3(0.0);
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    for (int i = 0; i < 20; i++) {
      vec3 p = ro + dir * (float(i) + 0.5) * ds;
      vec3 local = density(p) * ds;
      optical += local * 0.5;
      float dl = atmosphereExit(p, uSunDir) / 8.0;
      vec3 lightOptical = vec3(0.0);
      float visible = 1.0;
      for (int j = 0; j < 8; j++) {
        vec3 q = p + uSunDir * (float(j) + 0.5) * dl;
        if (length(q) < RP) visible = 0.0;
        lightOptical += density(q) * dl;
      }
      vec3 total = optical + lightOptical;
      vec3 transmission = exp(-BR * total.x - BM * 1.1 * total.y - BO * total.z) * visible;
      sumR += local.x * transmission;
      sumM += local.y * transmission;
      optical += local * 0.5;
    }
    float mu = dot(dir, uSunDir);
    float phaseR = 3.0 / (16.0*PI) * (1.0+mu*mu);
    float g = 0.76;
    float phaseM = 3.0/(8.0*PI) * (1.0-g*g)*(1.0+mu*mu) /
      ((2.0+g*g)*pow(max(0.01, 1.0+g*g-2.0*g*mu), 1.5));
    vec3 radiance = 22.0 * (sumR*BR*phaseR + sumM*BM*phaseM);
    float night = 1.0 - smoothstep(-0.12, 0.02, uSunDir.y);
    radiance += vec3(0.0012, 0.0020, 0.0040) * night;
    gl_FragColor = vec4(radiance, 1.0);
  }
`
