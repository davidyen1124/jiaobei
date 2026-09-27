import * as THREE from 'three';

/**
 * The temple is path-traced in Cycles from the viewer's eye into two plates:
 *  - an equirectangular crop (lon/lat range) for the hall ahead, and
 *  - a straight-down rectilinear plate for the floor all around the viewer,
 *    which the crop cannot cover once the camera tilts down at a wide angle.
 * Drawing them as a per-pixel direction lookup keeps the background exact under
 * any camera rotation and zoom, so the real-time 3D blocks stay locked to it.
 */
export function createBackground(panoTex, pano, nadirTex, nadir) {
  const d2r = Math.PI / 180;
  const uniforms = {
    map: { value: panoTex },
    nadirMap: { value: nadirTex },
    range: { value: new THREE.Vector4(pano.lonMin * d2r, pano.lonMax * d2r, pano.latMin * d2r, pano.latMax * d2r) },
    nadirTan: { value: Math.tan(((nadir?.fov ?? 110) / 2) * d2r) },
    useNadir: { value: nadirTex ? 1 : 0 },
    invProj: { value: new THREE.Matrix4() },
    camRot: { value: new THREE.Matrix3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform mat4 invProj;
      uniform mat3 camRot;
      varying vec3 vDir;
      void main() {
        vec4 v = invProj * vec4(position.xy, 1.0, 1.0);
        vDir = camRot * (v.xyz / v.w);
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D nadirMap;
      uniform vec4 range;
      uniform float nadirTan;
      uniform float useNadir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // equirectangular crop (Cycles panorama: lon to the right, lat up)
        float lon = atan(d.x, -d.z);
        float lat = asin(clamp(d.y, -1.0, 1.0));
        vec2 uv = vec2((lon - range.x) / (range.y - range.x), (lat - range.z) / (range.w - range.z));
        float ep = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float wp = smoothstep(0.0, 0.012, ep);
        vec3 cp = texture2D(map, clamp(uv, 0.0, 1.0)).rgb;
        // straight-down plate: image right = +x, image up = toward the altar (-z)
        float down = max(-d.y, 1e-4);
        vec2 q = vec2(d.x, -d.z) / down / nadirTan;       // -1..1 inside the frame
        vec2 nuv = q * 0.5 + 0.5;
        float en = 1.0 - max(abs(q.x), abs(q.y));
        float wn = useNadir * step(0.0, -d.y) * smoothstep(0.0, 0.04, en);
        vec3 cn = texture2D(nadirMap, clamp(nuv, 0.0, 1.0)).rgb;
        // the panorama wins where it has data; the floor plate fills in around it
        vec3 c = cp * wp + cn * (1.0 - wp) * wn + vec3(0.012, 0.006, 0.005) * (1.0 - wp) * (1.0 - wn);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  const m4 = new THREE.Matrix4();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    uniforms.invProj.value.copy(camera.projectionMatrixInverse);
    m4.extractRotation(camera.matrixWorld);
    uniforms.camRot.value.setFromMatrix4(m4);
  };
  return { mesh, uniforms };
}

/** is a view direction (three.js world, from the eye) covered by the rendered plates? */
export function covered(dir, pano, nadir) {
  const d2r = Math.PI / 180;
  const L = Math.hypot(dir.x, dir.y, dir.z);
  const lon = Math.atan2(dir.x, -dir.z) / d2r, lat = Math.asin(dir.y / L) / d2r;
  if (lon >= pano.lonMin && lon <= pano.lonMax && lat >= pano.latMin && lat <= pano.latMax) return true;
  if (!nadir || dir.y >= 0) return false;
  const t = Math.tan((nadir.fov / 2) * d2r);
  return Math.abs(dir.x / -dir.y) <= t && Math.abs(dir.z / -dir.y) <= t;
}
