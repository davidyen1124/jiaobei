import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { createBackground } from './background.js';
import { CameraRig } from './camera.js';
import { TempleAudio } from './audio.js';
import { UI } from './ui.js';
import { ContactShadows, IncenseSmoke, FlameGlows, Dust, createFilmOverlay, LAYER_BLOCKS } from './fx.js';

// physics (Rapier WASM, the bulk of the JS) arrives as a separate chunk while the temple loads
let Phys;
let STEP = 1 / 240;
const params = new URLSearchParams(location.search);
const ASSET = import.meta.env.BASE_URL + 'assets/';
const ui = new UI();
const audio = new TempleAudio();

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Blender rendered the temple through "Khronos PBR Neutral"; three.js' NeutralToneMapping is the same curve,
// so the real-time blocks are graded exactly like the path-traced background.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 60);

// ------------------------------------------------------------------ loading
async function fetchWithProgress(url, weight, report) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) {
    const b = await res.arrayBuffer();
    report(weight, weight);
    return b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    report(weight * Math.min(1, got / total), weight);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

async function loadAll() {
  const parts = {};
  const done = {};
  const report = (key) => (v) => {
    done[key] = v;
    const f = Object.values(done).reduce((a, b) => a + b, 0);
    ui.progress(f, f < 0.55 ? '載入廟宇…' : f < 0.85 ? '請筊杯上桌…' : '上香中…');
  };
  const meta = await (await fetch(ASSET + 'scene.json')).json();
  const physReady = import('./physics.js').then(async (m) => { await m.initRapier(); Phys = m; STEP = m.STEP; });
  const [panoBuf, nadirBuf, glbBuf, hdrBuf, colliders] = await Promise.all([
    fetchWithProgress(ASSET + meta.pano.file, 0.42, report('pano')),
    meta.nadir ? fetchWithProgress(ASSET + meta.nadir.file, 0.2, report('nadir')) : null,
    fetchWithProgress(ASSET + 'jiao.glb', 0.16, report('glb')),
    fetchWithProgress(ASSET + meta.probe.file, 0.17, report('hdr')),
    fetch(ASSET + 'jiao_colliders.json').then((r) => r.json()),
    physReady,
  ]);
  report('rapier')(0.05);
  parts.meta = meta;
  parts.colliders = colliders;

  const loadTex = async (buf) => {
    const url = URL.createObjectURL(new Blob([buf], { type: 'image/webp' }));
    const t = await new THREE.TextureLoader().loadAsync(url);
    URL.revokeObjectURL(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  parts.pano = await loadTex(panoBuf);
  parts.nadir = nadirBuf ? await loadTex(nadirBuf) : null;

  parts.gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBuf, '', res, rej));
  const hdrUrl = URL.createObjectURL(new Blob([hdrBuf]));
  parts.hdr = await new HDRLoader().loadAsync(hdrUrl);
  URL.revokeObjectURL(hdrUrl);
  return parts;
}

// ------------------------------------------------------------------ world
let meta, physics, rig, bg, contact, smoke, glows, dust, film, keyLight, lamps = [];
const blocks = []; // { mesh, prev:{p,q}, cur:{p,q} }
const state = {
  mode: 'loading', // idle | throw | result
  time: 0,
  acc: 0,
  rest: 0,
  simTime: 0,
  cool: [0, 0, 0],
  lastDv: [0, 0, 0],
  focus: new THREE.Vector3(0, 0.05, -1.3),
  seed: params.has('seed') ? +params.get('seed') : null,
  throws: 0,
  lastReading: null,
};

function buildScene(parts) {
  meta = parts.meta;
  bg = createBackground(parts.pano, meta.pano, parts.nadir, meta.nadir);
  scene.add(bg.mesh);

  // image-based light captured by Cycles at the landing spot
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(parts.hdr).texture;
  parts.hdr.dispose();
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.9; // calibrated against the Blender reference render (tests/ref)

  // Blender's lamps are invisible to the probe camera, so re-create them with matching units:
  // Cycles point/spot power P [W] -> radiant intensity P/4π ; a Lambertian area light -> ~P/π on axis.
  lamps = meta.lamps.map((l) => {
    const color = new THREE.Color(...l.color);
    let light;
    if (l.type === 'SPOT') {
      light = new THREE.SpotLight(color, l.power / (4 * Math.PI), 0, l.angle / 2, l.blend, 2);
      light.target.position.set(l.pos[0] + l.dir[0], l.pos[1] + l.dir[1], l.pos[2] + l.dir[2]);
      scene.add(light.target);
    } else if (l.type === 'AREA') {
      light = new THREE.PointLight(color, (l.power / Math.PI) * 0.9, 0, 2);
    } else {
      light = new THREE.PointLight(color, l.power / (4 * Math.PI), 0, 2);
    }
    light.position.set(...l.pos);
    light.intensity *= 0.85; // calibrated against the Blender reference render
    light.userData.base = light.intensity;
    light.userData.flicker = /candle|glass/.test(l.name);
    scene.add(light);
    return light;
  });

  // soft key shadow from the main door behind the viewer
  const land = new THREE.Vector3(0, 0, -1.35);
  const door = new THREE.Vector3(...meta.lights.door);
  keyLight = new THREE.DirectionalLight(0xffffff, 0.0001);
  keyLight.position.copy(land).add(door.clone().sub(land).normalize().multiplyScalar(4));
  keyLight.target.position.copy(land);
  keyLight.castShadow = true;
  const sc = keyLight.shadow;
  sc.mapSize.set(1024, 1024);
  Object.assign(sc.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
  sc.radius = 18;
  sc.blurSamples = 24;
  sc.bias = -0.0004;
  scene.add(keyLight, keyLight.target);

  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.26, transparent: true, depthWrite: false })
  );
  catcher.position.set(0, 0.0004, -1.6);
  catcher.receiveShadow = true;
  catcher.renderOrder = 1;
  scene.add(catcher);

  contact = new ContactShadows(renderer, { center: land, size: 3.2, res: 512, far: 0.06, blur: 1.4, opacity: 0.78 });
  scene.add(contact.mesh);

  // the two blocks
  const src = {};
  parts.gltf.scene.traverse((o) => { if (o.isMesh) src[o.name] = o; });
  // one shared geometry; block B wears its own baked lacquer (different wear pattern)
  const geo = src.Jiao.geometry;
  [src.Jiao.material, (src.JiaoB_material || src.JiaoB || src.Jiao).material].forEach((mat, i) => {
    const m = new THREE.Mesh(geo, mat.clone());
    m.material.side = THREE.FrontSide; // closed solid
    m.material.envMapIntensity = 1;
    m.castShadow = true;
    m.receiveShadow = false;
    m.layers.enable(LAYER_BLOCKS);
    m.visible = false;
    scene.add(m);
    blocks.push({ mesh: m, prev: { p: new THREE.Vector3(), q: new THREE.Quaternion() }, cur: { p: new THREE.Vector3(), q: new THREE.Quaternion() } });
  });

  physics = new Phys.Physics(parts.colliders, meta.statics);
  // warm the solver (first step builds Rapier's internal structures) and the JIT
  physics.toss(Phys.mulberry32(1), { x: 0, y: 1, z: -0.4 }, { x: 0, y: 0, z: -1 });
  for (let i = 0; i < 90; i++) physics.step();
  physics.drainContacts();
  audio.prepare();

  smoke = new IncenseSmoke(meta.smoke);
  scene.add(smoke.group);
  glows = new FlameGlows(meta.flames);
  scene.add(glows.group);
  dust = new Dust(80);
  scene.add(dust.points);
  film = createFilmOverlay();
  scene.add(film);

  rig = new CameraRig(camera, meta.eye, meta.pano);
  resize();
  rig.set(0, idlePitch(), 1);
  rig.snap();
}

function idlePitch() {
  return rig.aspect < 1 ? -4 : 3;
}

// ------------------------------------------------------------------ throw
// One unbroken toss: the cupped hands sweep up from below the frame and let go. The swing ends
// exactly in the physics launch state (position, velocity and spin), so the flight carries straight
// on from it; no ease-out to a standstill and no hold before the blocks leap into the air.
const SWING = 0.22; // tap -> release (the hands are mostly below the frame, so keep it short)
const SWING_LIFT = 0.26; // extra swing time when the view first has to lift off the last result
const SPIN_IN = 0.12; // wrist flick: the tumble builds up over the end of the swing

function throwBlocks() {
  if (state.mode === 'throw' || state.mode === 'swing' || state.mode === 'loading') return;
  audio.start().then(() => audio.pickup());
  const seed = state.seed != null ? state.seed + state.throws : (Math.random() * 2 ** 31) | 0;
  state.throws++;
  state.lastSeed = seed;
  const rng = Phys.mulberry32(seed);
  const eye = new THREE.Vector3(...meta.eye);
  const hand = { x: eye.x + (rng() - 0.5) * 0.04, y: eye.y - 0.14, z: eye.z - 0.42 };
  const yaw = (rng() - 0.5) * 0.14;
  // the toss is decided now (seeded); the world is only stepped once the hands let go
  physics.toss(rng, hand, { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
  const L = (state.launch = blocks.map((b, i) => {
    const s = physics.state(i);
    b.mesh.visible = true;
    return {
      p: new THREE.Vector3(s.p.x, s.p.y, s.p.z), q: new THREE.Quaternion(s.q.x, s.q.y, s.q.z, s.q.w),
      v: new THREE.Vector3(s.v.x, s.v.y, s.v.z), w: new THREE.Vector3(s.w.x, s.w.y, s.w.z),
    };
  }));
  // the flight (ballistic estimate from the launch state): release, apex and touchdown of each block
  const flight = [], land = new THREE.Vector3();
  let apex = -90;
  for (const l of L) {
    const ta = Math.max(0, l.v.y / 9.81);
    const tl = (l.v.y + Math.sqrt(l.v.y * l.v.y + 2 * 9.81 * Math.max(0, l.p.y - 0.01))) / 9.81;
    const top = new THREE.Vector3(l.p.x + l.v.x * ta, l.p.y + l.v.y * ta - 4.905 * ta * ta, l.p.z + l.v.z * ta);
    const down = new THREE.Vector3(l.p.x + l.v.x * tl, 0.02, l.p.z + l.v.z * tl * 1.12); // plus a little slide
    flight.push(l.p, top, down);
    land.x += down.x / 2; land.z += down.z / 2;
    apex = Math.max(apex, Math.atan2(top.y - eye.y, Math.hypot(top.x - eye.x, top.z - eye.z)) * THREE.MathUtils.RAD2DEG);
  }
  land.z = Math.max(-2.2, land.z);
  state.focus.copy(land);
  state.landT = 0.35;
  // coming from a close-up of the last result, the apex starts far above the top of the view and
  // the camera (a spring, at rest) needs a head start: lift quicker, and let the hands take longer
  // to come up from below the frame, so the pair rises into view instead of flying out of it
  const headroom = rig.cur.pitch * THREE.MathUtils.RAD2DEG + rig.fovFor(rig.cur.zoom) / 2 - apex; // deg
  const k = THREE.MathUtils.clamp((3 - headroom) / 20, 0, 1);
  const T = (state.swing = SWING + SWING_LIFT * k);
  rig.omega = 3 + 3.5 * k;
  // with plenty of room above (idle view) aim straight at the touchdown: the lagging spring keeps
  // the rise in view on its way down. Otherwise frame the whole flight, without zooming in, so the
  // view doesn't stop short of the apex.
  rig.look(land, 1.05, [0, 0.02]);
  const aim = rig.tgt, m = THREE.MathUtils.clamp((25 - headroom) / 15, 0, 1);
  rig.frame(flight, { x0: -0.8, x1: 0.8, y0: -0.8, y1: 0.8 }, 0.7, Math.min(1.05, Math.max(0.7, rig.cur.zoom)));
  for (const key of ['yaw', 'pitch', 'zoom']) rig.tgt[key] = THREE.MathUtils.lerp(aim[key], rig.tgt[key], m);
  // shared hand path: already rising as it enters the frame, speeding up (constant acceleration)
  // to the pair's mean launch velocity at the release point
  const c1 = L[0].p.clone().add(L[1].p).multiplyScalar(0.5);
  const v1 = L[0].v.clone().add(L[1].v).multiplyScalar(0.5);
  const u0 = new THREE.Vector3(v1.x * 0.4, v1.y * 0.75, v1.z * 0.4);
  state.hand = { c1, v1, u0, c0: c1.clone().addScaledVector(u0.clone().add(v1), -T / 2) };
  state.mode = 'swing';
  state.swingT = 0;
  state.acc = 0; state.rest = 0; state.simTime = 0;
  state.cool = [0, 0, 0]; state.lastDv = [0, 0, 0];
  physics.drainContacts();
  ui.throwing();
  swingPose(0);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
function swingPose(t) {
  const T = state.swing;
  t = Math.min(t, T);
  const { c0, c1, v1, u0 } = state.hand;
  const s = t / T;
  const lift = (1 - s) * (1 - s); // hands still tilted, levelling out (with zero rate) as they let go
  const fs = s ** 4 * (s - 1); // eases in each block's own share of the release velocity at the very end
  const tau = T - t; // time left until the release
  const g = tau < SPIN_IN ? tau - (tau * tau) / (2 * SPIN_IN) : SPIN_IN / 2; // spin ramps 0 -> ω
  blocks.forEach((b, i) => {
    const L = state.launch[i];
    b.cur.p.copy(c0).addScaledVector(u0, t).addScaledVector(_v.copy(v1).sub(u0), (0.5 * t * t) / T)
      .add(L.p).sub(c1)
      .addScaledVector(_v.copy(L.v).sub(v1), T * fs);
    _e.set(0.35 * lift * (i ? -1 : 1), 0, 0.18 * lift);
    b.cur.q.copy(L.q).premultiply(_q.setFromEuler(_e));
    const w = L.w.length();
    if (w > 1e-6) b.cur.q.premultiply(_q.setFromAxisAngle(_v.copy(L.w).divideScalar(w), -w * g));
    b.prev.p.copy(b.cur.p); b.prev.q.copy(b.cur.q);
  });
}

function contactsToSound(dtFrame) {
  const c = physics.drainContacts();
  const m = physics.blocks[0].mass;
  const support = m * 9.81 * dtFrame * 1.1;
  for (const i of [0, 1]) {
    const s = physics.state(i);
    const cam = new THREE.Vector3(s.p.x, s.p.y, s.p.z).applyMatrix4(camera.matrixWorldInverse);
    const dist = cam.length();
    const pan = THREE.MathUtils.clamp(cam.x / Math.max(0.3, -cam.z) * 1.2, -1, 1);
    const hit = (key, J, kind) => {
      const dv = Math.max(0, J - support) / m;
      if (dv < 0.06) return;
      if (state.cool[key] > 0 && dv < state.lastDv[key] * 1.8) return;
      state.cool[key] = 0.045;
      state.lastDv[key] = dv;
      audio.impact(dv, kind, pan, i, dist);
    };
    hit(i, c.floor[i], 'floor');
    if (c.other[i] > 0) hit(i, c.other[i] + support, 'wood');
    // scraping only while the contact point actually slips (rolling / rocking is silent):
    // v_contact = v + ω × r, with r from the centre of mass straight down to the floor
    const v = s.v, w = s.w, h = s.p.y;
    const slip = Math.hypot(v.x + w.z * h, v.z - w.x * h);
    audio.setSlide(i, c.touching[i] && h < 0.03 ? slip : 0, pan);
  }
  if (c.block > 0) {
    const dv = (c.block / m) * 1.5;
    if (dv > 0.05 && !(state.cool[2] > 0 && dv < state.lastDv[2] * 1.8)) {
      state.cool[2] = 0.04; state.lastDv[2] = dv;
      const s = physics.state(0);
      audio.impact(dv, 'block', THREE.MathUtils.clamp(s.p.x, -1, 1), 0, 1.3);
    }
  }
}

/** points spanning both blocks (centre + rim), for framing */
function pairPoints() {
  const pts = [];
  for (const i of [0, 1]) {
    const s = physics.state(i).p;
    for (const [dx, dz] of [[0, 0], [0.065, 0], [-0.065, 0], [0, 0.065], [0, -0.065]]) pts.push(new THREE.Vector3(s.x + dx, s.y + 0.012, s.z + dz));
  }
  return pts;
}

function settle() {
  const reading = physics.reading();
  state.mode = 'result';
  state.lastReading = reading;
  for (const i of [0, 1]) audio.setSlide(i, 0, 0);
  const streak = ui.show(reading.kind);
  audio.chime(reading.kind);
  if (reading.kind === 'sheng' && streak === 3) { audio.chime('sheng', 0.9); audio.chime('li', 1.8); }
  // frame the answer: both blocks, whole, in the part of the screen the card leaves free
  const narrow = window.matchMedia('(max-width: 700px), (max-aspect-ratio: 9/10)').matches;
  // layout box of the card without its slide-in transform (offset* ignore transforms)
  const el = document.getElementById('result');
  const card = { top: el.offsetTop, left: el.offsetLeft };
  const W = window.innerWidth, H = window.innerHeight;
  const ndcX = (px) => (px / W) * 2 - 1, ndcY = (py) => 1 - (py / H) * 2;
  const rect = narrow
    ? { x0: -0.86, x1: 0.86, y0: ndcY(card.top) + 0.08, y1: 0.7 }
    : { x0: -0.86, x1: ndcX(card.left) - 0.08, y0: -0.8, y1: 0.72 };
  rig.omega = 1.8;
  rig.frame(pairPoints(), rect, narrow ? 0.7 : 0.85, 3.0);
}

// ------------------------------------------------------------------ loop
function stepSim(dt) {
  state.acc += dt;
  let n = 0;
  while (state.acc >= STEP && n < 40) {
    blocks.forEach((b) => { b.prev.p.copy(b.cur.p); b.prev.q.copy(b.cur.q); });
    physics.step();
    blocks.forEach((b, i) => {
      const s = physics.state(i);
      b.cur.p.set(s.p.x, s.p.y, s.p.z); b.cur.q.set(s.q.x, s.q.y, s.q.z, s.q.w);
    });
    state.acc -= STEP;
    state.simTime += STEP;
    n++;
  }
  contactsToSound(dt);
  for (let k = 0; k < 3; k++) state.cool[k] -= dt;

  // once they are down, follow the pair as it bounces, slides and rocks
  if (state.simTime > state.landT && (state.followTick = (state.followTick || 0) + 1) % 3 === 0) {
    rig.omega = 2.4;
    rig.frame(pairPoints(), { x0: -0.72, x1: 0.72, y0: -0.7, y1: 0.62 }, 0.8, 1.2);
  }

  if (physics.isResting() && state.simTime > 0.6) state.rest += dt; else state.rest = 0;
  if (state.rest > 0.4 || state.simTime > 9) settle();
}

function advance(dt) {
  state.time += dt;
  if (state.mode === 'swing') {
    state.swingT += dt;
    swingPose(state.swingT);
    if (state.swingT >= state.swing) {
      state.mode = 'throw';
      blocks.forEach((b, i) => { b.cur.p.copy(state.launch[i].p); b.cur.q.copy(state.launch[i].q); b.prev.p.copy(b.cur.p); b.prev.q.copy(b.cur.q); });
      // the rest of this frame is already flight; plus one step, because the interpolated pose
      // trails the physics by a step and would otherwise hold the release pose for a frame
      stepSim(state.swingT - state.swing + STEP);
    }
  } else if (state.mode === 'throw') stepSim(dt);
  const alpha = state.mode === 'throw' ? state.acc / STEP : 1;
  for (const b of blocks) {
    b.mesh.position.lerpVectors(b.prev.p, b.cur.p, alpha);
    b.mesh.quaternion.slerpQuaternions(b.prev.q, b.cur.q, alpha);
  }
  rig.sway = state.mode === 'result' ? 0.6 : 1;
  rig.update(dt, state.time);
  smoke.update(dt, state.time);
  glows.update(state.time);
  for (const l of lamps) {
    if (!l.userData.flicker) continue;
    const t = state.time, k = l.position.x * 7.1;
    l.intensity = l.userData.base * (0.86 + 0.1 * Math.sin(t * 11 + k) + 0.06 * Math.sin(t * 23.7 + k * 2) + 0.04 * Math.sin(t * 4.3 + k));
  }
  dust.update(state.time);
  film.material.uniforms.time.value = state.time;
}

function render() {
  camera.updateMatrixWorld();
  if (blocks[0].mesh.visible) contact.update(scene);
  renderer.render(scene, camera);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
  if (!window.__jiao?.manual) {
    try {
      advance(dt);
      render();
    } catch (err) {
      console.error(err);
    }
  }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (rig) {
    rig.setAspect(w / h);
    film.material.uniforms.aspect.value = w / h;
    if (state.mode === 'idle') rig.set(0, idlePitch(), 1);
  }
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ input
function onThrowInput(e) {
  if (ui.infoOpen) return;
  if (e.target.closest && e.target.closest('button, #info, a')) return;
  throwBlocks();
}
canvas.addEventListener('pointerup', onThrowInput);
for (const id of ['intro', 'result', 'brand', 'status']) document.getElementById(id).addEventListener('pointerup', onThrowInput);
window.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && !ui.infoOpen && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    throwBlocks();
  }
});
ui.onSound((on) => audio.setEnabled(on));
ui.onInfo();

// ------------------------------------------------------------------ boot
(async () => {
  try {
    const parts = await loadAll();
    buildScene(parts);
    await document.fonts?.ready;
    // warm every shader (blocks, shadow passes) now instead of on the first throw
    blocks.forEach((b) => { b.mesh.visible = true; b.mesh.position.set(0, 0.02, -1.4); });
    renderer.compile(scene, camera);
    contact.update(scene);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    blocks.forEach((b) => { b.mesh.visible = false; });
    state.mode = 'idle';
    ui.ready();
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    ui.error('載入失敗，請重新整理頁面。');
  }
})();

// ------------------------------------------------------------------ test hooks
window.__jiao = {
  manual: params.has('manual'),
  /** step the whole app by hand (hidden tabs pause rAF) */
  advance(seconds, fps = 60) {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) advance(1 / fps);
    render();
    return this.info();
  },
  throw(seed) {
    if (seed != null) { state.seed = seed; state.throws = 0; }
    if (state.mode === 'throw' || state.mode === 'swing') state.mode = 'result';
    throwBlocks();
    return this.info();
  },
  /** place both blocks at poses (three.js coords) and show them as a settled throw */
  pose(poses) {
    poses.forEach((p, i) => {
      physics.place(i, { x: p.p[0], y: p.p[1], z: p.p[2] }, { x: p.q[0], y: p.q[1], z: p.q[2], w: p.q[3] });
      const b = blocks[i];
      b.cur.p.set(...p.p); b.cur.q.set(...p.q); b.prev.p.copy(b.cur.p); b.prev.q.copy(b.cur.q);
      b.mesh.visible = true;
    });
    state.mode = 'posed';
  },
  view(yawDeg, pitchDeg, vfovDeg) {
    rig.set(yawDeg, pitchDeg, 1);
    rig.snap();
    rig.sway = 0;
    advance(0);
    camera.rotation.set(pitchDeg * Math.PI / 180, yawDeg * Math.PI / 180, 0);
    if (vfovDeg) { camera.fov = vfovDeg; camera.updateProjectionMatrix(); }
    render();
  },
  /** record the sound events of one seeded throw and render them offline -> WAV (base64) */
  async recordThrow(seed = 1, seconds = 6) {
    const events = [];
    audio.onEvent = (e) => events.push([state.simTime + (state.mode === 'swing' ? state.swingT - state.swing : 0), ...e]);
    this.throw(seed);
    const T = state.swing;
    events.push([-T, 'pickup']);
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) advance(1 / 60);
    audio.onEvent = null;
    const sr = 44100, dur = seconds + T + 2.5;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
    const off = new TempleAudio();
    await off.start(ctx);
    const t0 = T + 0.05;
    for (const [t, type, ...a] of events) {
      const at = t0 + t;
      if (type === 'impact') off.impact(a[0], a[1], a[2], a[3], a[4], at);
      else if (type === 'slide') off.setSlide(a[0], a[1], a[2], at);
      else if (type === 'chime') off.chime(a[0], a[1], at);
      else if (type === 'pickup') off.pickup(at);
    }
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const pcm = new DataView(new ArrayBuffer(44 + L.length * 4));
    const w = (o, str) => [...str].forEach((c, i) => pcm.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); pcm.setUint32(4, 36 + L.length * 4, true); w(8, 'WAVEfmt '); pcm.setUint32(16, 16, true);
    pcm.setUint16(20, 1, true); pcm.setUint16(22, 2, true); pcm.setUint32(24, sr, true); pcm.setUint32(28, sr * 4, true);
    pcm.setUint16(32, 4, true); pcm.setUint16(34, 16, true); w(36, 'data'); pcm.setUint32(40, L.length * 4, true);
    let peak = 0;
    for (let i = 0; i < L.length; i++) {
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      pcm.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      pcm.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const impacts = events.filter((e) => e[1] === 'impact').map((e) => [+e[0].toFixed(3), e[3], +e[2].toFixed(3)]);
    return { wav: btoa(bin), peak, impacts, reading: state.lastReading };
  },
  info() {
    return {
      mode: state.mode, seed: state.lastSeed, simTime: +state.simTime.toFixed(3), reading: state.lastReading,
      blocks: [0, 1].map((i) => { const s = physics.state(i); return { p: [s.p.x, s.p.y, s.p.z].map((v) => +v.toFixed(4)) }; }),
      camera: { yaw: rig.cur.yaw, pitch: rig.cur.pitch, zoom: rig.cur.zoom, fov: camera.fov },
    };
  },
  setFilm(on) { film.visible = on; render(); },
  /** lighting calibration against the Blender reference render */
  tune({ env, lamps: ls } = {}) {
    if (env != null) scene.environmentIntensity = env;
    if (ls != null) for (const l of lamps) { l.userData.base = (l.userData.base0 ??= l.userData.base / 0.85) * ls; l.intensity = l.userData.base; }
    render();
  },
  get renderer() { return renderer; },
  get physics() { return physics; },
  get blocks() { return blocks.map((b) => b.mesh); },
  get rig() { return rig; },
  get audio() { return audio; },
  get scene() { return scene; },
  get camera() { return camera; },
};
