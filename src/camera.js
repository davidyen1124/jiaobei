import * as THREE from 'three';

const D2R = Math.PI / 180;
const EDGE_LAT = 35.5; // below this latitude (deg) the floor plate covers every direction

/**
 * The camera stays at the viewer's eye and only rotates / zooms, which is
 * exactly what the pre-rendered equirectangular temple supports. Framing is
 * kept inside the rendered crop at every aspect ratio.
 */
export class CameraRig {
  constructor(camera, eye, pano) {
    this.camera = camera;
    this.pano = pano;
    camera.position.set(...eye);
    camera.rotation.order = 'YXZ';
    this.eye = new THREE.Vector3(...eye);
    this.cur = { yaw: 0, pitch: -8 * D2R, zoom: 1 };
    this.vel = { yaw: 0, pitch: 0, zoom: 0 };
    this.tgt = { ...this.cur };
    this.omega = 2.6;
    this.aspect = 1;
    this.sway = 1;
    this.#tmp = new THREE.Vector3();
  }

  #tmp;

  /** vertical FOV (deg) at zoom 1 for the current aspect */
  baseFov() {
    const a = this.aspect;
    if (a >= 1) {
      const h = 80 * D2R;
      return Math.min(66, (2 * Math.atan(Math.tan(h / 2) / a)) / D2R);
    }
    // portrait: keep a usable horizontal angle, cap the vertical one
    const v = Math.min(74, (2 * Math.atan(Math.tan((40 * D2R) / 2) / a)) / D2R);
    return Math.max(56, v);
  }

  setAspect(a) {
    this.aspect = a;
    this.camera.aspect = a;
  }

  /** point the rig (target) at a world position, with an optional screen offset in NDC */
  look(p, zoom = 1, ndcOffset = [0, 0]) {
    const d = this.#tmp.copy(p).sub(this.eye);
    let yaw = Math.atan2(-d.x, -d.z);
    let pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    // shift the aim so the target lands at ndcOffset instead of the centre
    const vf = this.fovFor(zoom) * D2R;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.aspect);
    pitch -= Math.atan(Math.tan(vf / 2) * ndcOffset[1]);
    yaw += Math.atan(Math.tan(hf / 2) * ndcOffset[0]);
    this.tgt = { yaw, pitch, zoom };
  }

  /**
   * Aim and zoom so every point lands inside `rect` (NDC, {x0,x1,y0,y1}), e.g. the part of
   * the screen not covered by the result card. Iterates on a scratch camera with the same
   * limits the rig applies, so what it solves for is what will be shown.
   */
  frame(points, rect, zmin = 1, zmax = 3) {
    const cam = this.camera.clone();
    const c = new THREE.Vector3();
    points.forEach((p) => c.add(p));
    c.multiplyScalar(1 / points.length);
    const rcx = (rect.x0 + rect.x1) / 2, rcy = (rect.y0 + rect.y1) / 2;
    this.look(c, 1, [rcx, rcy]);
    let { yaw, pitch } = this.tgt;
    let zoom = 1;
    const v3 = new THREE.Vector3();
    for (let it = 0; it < 18; it++) {
      const v = this.#clamp({ yaw, pitch, zoom });
      cam.rotation.set(v.pitch, v.yaw, 0, 'YXZ');
      cam.fov = this.fovFor(v.zoom);
      cam.aspect = this.aspect;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const p of points) {
        v3.copy(p).project(cam);
        x0 = Math.min(x0, v3.x); x1 = Math.max(x1, v3.x); y0 = Math.min(y0, v3.y); y1 = Math.max(y1, v3.y);
      }
      const bw = Math.max(0.05, x1 - x0), bh = Math.max(0.05, y1 - y0);
      const f = Math.min((rect.x1 - rect.x0) / bw, (rect.y1 - rect.y0) / bh) * 0.9;
      zoom = Math.min(zmax, Math.max(zmin, v.zoom * Math.pow(f, 0.8)));
      const vf = (cam.fov * D2R) / 2, hf = Math.atan(Math.tan(vf) * this.aspect);
      const dx = (x0 + x1) / 2 - rcx, dy = (y0 + y1) / 2 - rcy;
      yaw = v.yaw - Math.atan(dx * Math.tan(hf)) * 0.9;
      pitch = v.pitch + Math.atan(dy * Math.tan(vf)) * 0.9;
    }
    this.tgt = this.#clamp({ yaw, pitch, zoom });
  }

  set(yawDeg, pitchDeg, zoom = 1) {
    this.tgt = { yaw: yawDeg * D2R, pitch: pitchDeg * D2R, zoom };
  }

  fovFor(zoom) {
    const b = this.baseFov() * D2R;
    return (2 * Math.atan(Math.tan(b / 2) / zoom)) / D2R;
  }

  /**
   * Keep a view inside the rendered plates. With the straight-down floor plate the
   * only uncovered directions are above the panorama's top edge and far to the sides,
   * so plain limits suffice. They are continuous in the input, so the spring can never
   * fight the clamp (the old per-corner clamp flipped yaw back and forth = flashing).
   */
  #clamp(v) {
    const p = this.pano;
    const vf = this.fovFor(v.zoom);
    // vertical: top edge under the panorama's top; bottom edge no further than just past straight down
    const pitchMax = p.latMax - 1.8 - vf / 2; // clear of the panorama's soft edge band
    const pitchMin = -88 + vf / 2;
    v.pitch = Math.min(pitchMax, Math.max(pitchMin, v.pitch / D2R)) * D2R;
    // horizontal: the floor plate covers everything below -35° latitude, so only frame
    // points above that must stay inside the panorama's longitude range. Measure how far
    // those points reach at yaw 0 (a continuous function of pitch and zoom), then limit yaw.
    // Below the plate's edge a point's limit fades out with depth instead of switching off:
    // a hard cut made yaw jump several degrees in one frame as the view tilted up across it.
    const tv = Math.tan((vf * D2R) / 2), th = tv * this.aspect;
    const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const s = -1 + (2 * k) / 12;
      pts.push([th, s * tv], [-th, s * tv], [s * th, tv]);
    }
    // the limit peaks where an edge crosses the plate's edge; sample those crossings exactly,
    // or the peak hops between the fixed samples and yaw jitters while it is held at the limit
    const T = Math.tan(-EDGE_LAT * D2R), a = cp * cp - T * T * sp * sp, b = 2 * sp * cp * (1 + T * T);
    for (const x of [th, -th]) {
      const c = sp * sp - T * T * (cp * cp + x * x), disc = b * b - 4 * a * c;
      if (disc < 0 || Math.abs(a) < 1e-9) continue;
      for (const r of [-1, 1]) {
        const y = (-b + r * Math.sqrt(disc)) / (2 * a);
        if (Math.abs(y) <= tv && y * cp + sp < 0) pts.push([x, y]);
      }
    }
    const yyTop = tv * cp + sp, zzTop = tv * sp - cp, x2 = (yyTop * yyTop) / (T * T) - zzTop * zzTop;
    if (yyTop < 0 && x2 >= 0 && x2 <= th * th) pts.push([Math.sqrt(x2), tv], [-Math.sqrt(x2), tv]);
    let right = -90, left = -90;
    for (const [x, y] of pts) {
      const yy = y * cp + sp, zz = y * sp - cp; // (x, y, -1) pitched about X
      const lat = Math.atan2(yy, Math.hypot(x, zz)) / D2R;
      const slack = Math.max(0, -EDGE_LAT - lat) * 1.5;
      const lon = Math.atan2(x, -zz) / D2R;
      right = Math.max(right, lon - slack); left = Math.max(left, -lon - slack);
    }
    const lim = p.lonMax - 1.6;
    const yawLo = right - lim, yawHi = lim - left; // world lon = frame lon - yaw
    const y = v.yaw / D2R;
    v.yaw = (yawLo <= yawHi ? Math.min(yawHi, Math.max(yawLo, y)) : (yawLo + yawHi) / 2) * D2R;
    return v;
  }

  update(dt, time) {
    this.tgt.zoom = Math.max(0.7, Math.min(3.2, this.tgt.zoom));
    const t = this.#clamp({ ...this.tgt });
    const w = this.omega;
    for (const k of ['yaw', 'pitch', 'zoom']) {
      // critically damped spring
      const x = this.cur[k] - t[k];
      const a = -2 * w * this.vel[k] - w * w * x;
      this.vel[k] += a * dt;
      this.cur[k] += this.vel[k] * dt;
    }
    const s = this.sway;
    const yaw = this.cur.yaw + s * 0.0022 * Math.sin(time * 0.31) + s * 0.0011 * Math.sin(time * 0.77 + 1.3);
    const pitch = this.cur.pitch + s * 0.0016 * Math.sin(time * 0.23 + 0.5) + s * 0.0008 * Math.sin(time * 0.61 + 2.1);
    const v = this.#clamp({ yaw, pitch, zoom: this.cur.zoom });
    this.camera.rotation.set(v.pitch, v.yaw, 0);
    const fov = this.fovFor(v.zoom);
    if (Math.abs(fov - this.camera.fov) > 1e-4 || this.camera.aspect !== this.aspect) {
      this.camera.fov = fov;
      this.camera.aspect = this.aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  snap() {
    this.cur = { ...this.#clamp({ ...this.tgt }) };
    this.vel = { yaw: 0, pitch: 0, zoom: 0 };
  }
}
