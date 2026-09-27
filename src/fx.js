import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

export const LAYER_BLOCKS = 1;

/**
 * Soft ambient-occlusion style contact shadow under the blocks: render them
 * from below the floor as "closeness to the ground", blur, and lay the result
 * on the floor (same idea as drei's <ContactShadows>).
 */
export class ContactShadows {
  constructor(renderer, { center, size = 2.6, res = 512, far = 0.09, blur = 1.6, opacity = 0.85 }) {
    this.renderer = renderer;
    this.blur = blur;
    const rt = (this.rt = new THREE.WebGLRenderTarget(res, res));
    this.rtBlur = new THREE.WebGLRenderTarget(res, res);
    rt.texture.generateMipmaps = this.rtBlur.texture.generateMipmaps = false;

    this.cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, far);
    this.cam.position.set(center.x, -0.0005, center.z);
    this.cam.rotation.x = Math.PI / 2; // look up from under the floor
    this.cam.layers.set(LAYER_BLOCKS);

    this.depthMat = new THREE.MeshDepthMaterial();
    this.depthMat.depthTest = this.depthMat.depthWrite = false;
    this.depthMat.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = { value: 1.0 };
      shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'float a = pow(1.0 - fragCoordZ, 2.2) * darkness; gl_FragColor = vec4(vec3(0.0), a);'
      );
    };
    this.hBlur = new THREE.ShaderMaterial({ ...HorizontalBlurShader, depthTest: false });
    this.vBlur = new THREE.ShaderMaterial({ ...VerticalBlurShader, depthTest: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    const mat = new THREE.MeshBasicMaterial({
      map: rt.texture, transparent: true, opacity, depthWrite: false, toneMapped: false,
    });
    const plane = (this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2), mat));
    plane.scale.y = -1;
    plane.position.set(center.x, 0.0006, center.z);
    plane.renderOrder = 2;
  }

  #blurPass(amount) {
    const r = this.renderer;
    this.quad.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    r.setRenderTarget(this.rtBlur);
    r.render(this.quadScene, this.quadCam);
    this.quad.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    r.setRenderTarget(this.rt);
    r.render(this.quadScene, this.quadCam);
  }

  update(scene) {
    const r = this.renderer;
    const prevBg = scene.background, prevOverride = scene.overrideMaterial, prevRT = r.getRenderTarget();
    const prevClear = r.getClearAlpha(), prevColor = r.getClearColor(new THREE.Color());
    scene.background = null;
    scene.overrideMaterial = this.depthMat;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.cam);
    scene.overrideMaterial = prevOverride;
    this.#blurPass(this.blur);
    this.#blurPass(this.blur * 0.45);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevColor, prevClear);
    scene.background = prevBg;
  }
}

function softSprite(size = 128, noise = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      let a = Math.max(0, 1 - r);
      a = a * a * (3 - 2 * a);
      if (noise) {
        const n = Math.sin(x * 0.21 + Math.sin(y * 0.13) * 3) * Math.sin(y * 0.17 + Math.sin(x * 0.11) * 2.3);
        a *= 1 - noise + noise * (0.5 + 0.5 * n);
      }
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** incense smoke rising from the censer: slow, curling, barely-there wisps */
export class IncenseSmoke {
  constructor(origin, count = 34) {
    this.origin = new THREE.Vector3(...origin);
    const tex = softSprite(128, 0.55);
    this.group = new THREE.Group();
    this.parts = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xd9d2cc, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.renderOrder = 5;
      this.group.add(s);
      this.parts.push({ s, age: (i / count) * 9, life: 9, seed: Math.random() * 100, rot: Math.random() * 6 });
    }
  }

  update(dt, time) {
    for (const p of this.parts) {
      p.age += dt;
      if (p.age > p.life) { p.age -= p.life; p.seed = Math.random() * 100; }
      const u = p.age / p.life;
      const h = u * 1.6;
      const sway = Math.sin(time * 0.35 + p.seed) * 0.06 * u + Math.sin(h * 3.1 + p.seed) * 0.05 * u;
      p.s.position.set(this.origin.x + sway + Math.sin(p.seed) * 0.04, this.origin.y + h, this.origin.z + Math.cos(p.seed * 1.7) * 0.05 * u);
      const size = 0.05 + u * 0.55;
      p.s.scale.set(size, size * 1.6, 1);
      p.s.material.rotation = p.rot + u * 0.8;
      p.s.material.opacity = 0.11 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.4);
    }
  }
}

/** flickering glow over the painted candle flames */
export class FlameGlows {
  constructor(positions) {
    const tex = softSprite(64);
    this.group = new THREE.Group();
    this.items = positions.map((p, i) => {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xffa04a, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.position.set(...p);
      s.scale.setScalar(0.07);
      s.renderOrder = 6;
      this.group.add(s);
      return { s, seed: i * 13.7 };
    });
  }

  update(time) {
    for (const { s, seed } of this.items) {
      const f = 0.5 + 0.25 * Math.sin(time * 11 + seed) + 0.15 * Math.sin(time * 23.7 + seed * 2) + 0.1 * Math.sin(time * 4.3 + seed);
      s.material.opacity = 0.1 + 0.16 * f;
      s.scale.set(0.06 + 0.015 * f, 0.075 + 0.02 * f, 1);
    }
  }
}

/** dust motes drifting through the door light */
export class Dust {
  constructor(count = 90) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2.6;
      pos[i * 3 + 1] = 0.25 + Math.random() * 2.2;
      pos[i * 3 + 2] = -0.5 - Math.random() * 2.2;
      this.seed[i] = Math.random() * 100;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.base = pos.slice();
    const m = new THREE.PointsMaterial({ color: 0xffe2b8, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.22,
      map: softSprite(32), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.points = new THREE.Points(g, m);
    this.points.renderOrder = 7;
    this.points.frustumCulled = false;
  }

  update(time) {
    const a = this.points.geometry.attributes.position;
    for (let i = 0; i < this.seed.length; i++) {
      const s = this.seed[i];
      a.array[i * 3] = this.base[i * 3] + Math.sin(time * 0.07 + s) * 0.12;
      a.array[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(time * 0.05 + s * 1.3) * 0.15 + ((time * 0.01 + s) % 1) * 0.05;
      a.array[i * 3 + 2] = this.base[i * 3 + 2] + Math.cos(time * 0.06 + s * 0.7) * 0.12;
    }
    a.needsUpdate = true;
    this.points.material.opacity = 0.16 + 0.05 * Math.sin(time * 0.4);
  }
}

/** final film pass: very light grain + vignette, drawn over everything */
export function createFilmOverlay() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, grain: { value: 0.035 }, vignette: { value: 0.32 }, aspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float time, grain, vignette, aspect;
      varying vec2 vUv;
      float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      void main() {
        vec2 q = vUv - 0.5;
        q.x *= mix(1.0, aspect, 0.6);
        float v = 1.0 - vignette * smoothstep(0.35, 0.95, length(q) * 1.25);
        float n = hash(gl_FragCoord.xy + fract(time * 7.13) * 91.7) - 0.5;
        // multiply-x2 blending: 0.5 is neutral
        gl_FragColor = vec4(vec3(0.5 * v + n * grain), 1.0);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.SrcColorFactor,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  return mesh;
}
