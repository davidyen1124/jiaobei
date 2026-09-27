import RAPIER from '@dimforge/rapier3d-compat';

export const STEP = 1 / 240;
const G = 9.81;

// Material constants (SI). Lacquered camphor/longan wood on honed granite.
export const PHYS = {
  density: 650,          // kg/m^3 -> about 45 g per block (NTM specimens: 30-50 g)
  frictionBlock: 0.42,
  frictionFloor: 0.5,
  restitutionBlock: 0.34,
  restitutionFloor: 0.3,
  linearDamping: 0.02,
  angularDamping: 0.1,
};

/** Small deterministic PRNG so a throw can be replayed from its seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rapierReady = null;
export function initRapier() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

function quatFromAxisAngle(ax, ay, az, ang) {
  const s = Math.sin(ang / 2), l = Math.hypot(ax, ay, az) || 1;
  return { x: (ax / l) * s, y: (ay / l) * s, z: (az / l) * s, w: Math.cos(ang / 2) };
}
function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
/** rotate vector v by quaternion q */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

export class Physics {
  /**
   * @param jiao  collider JSON exported from Blender (convex pieces, y-up, origin = centre of mass)
   * @param statics  list of static colliders from scene.json
   */
  constructor(jiao, statics = []) {
    this.jiao = jiao;
    const world = (this.world = new RAPIER.World({ x: 0, y: -G, z: 0 }));
    world.timestep = STEP;
    world.lengthUnit = 0.1; // blocks are ~0.1 m: tighten the solver's length tolerances
    world.numSolverIterations = 8;
    this.events = new RAPIER.EventQueue(true);
    this.owner = new Map(); // collider handle -> 0 | 1 (block) | 'floor' | name

    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.#static(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0), fixed, 'floor', PHYS.frictionFloor, PHYS.restitutionFloor);
    for (const s of statics) {
      let desc;
      if (s.type === 'box') desc = RAPIER.ColliderDesc.cuboid(...s.half);
      else if (s.type === 'cylinder') desc = RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
      else continue;
      desc.setTranslation(...s.center);
      if (s.rotY) desc.setRotation(quatFromAxisAngle(0, 1, 0, s.rotY));
      this.#static(desc, fixed, s.name || s.type, s.friction ?? 0.5, s.restitution ?? 0.25);
    }
    this.blocks = [0, 1].map((i) => this.#block(i));
    this.acc = this.#zeroAcc();
  }

  #static(desc, body, name, friction, restitution) {
    desc.setFriction(friction).setRestitution(restitution);
    const c = this.world.createCollider(desc, body);
    this.owner.set(c.handle, name);
  }

  #block(i) {
    const mp = this.jiao.massProps;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setCcdEnabled(true)
      .setLinearDamping(PHYS.linearDamping)
      .setAngularDamping(PHYS.angularDamping)
      .setTranslation(i * 0.3 - 0.15, -5, 0);
    // exact mass properties of the solid (the convex pieces overlap, so their own
    // densities would over-count); colliders then carry no mass of their own
    if (mp) {
      const [x, y, z, w] = mp.frame;
      desc.setAdditionalMassProperties(mp.mass, { x: 0, y: 0, z: 0 }, { x: mp.principal[0], y: mp.principal[1], z: mp.principal[2] }, { x, y, z, w });
    }
    const body = this.world.createRigidBody(desc);
    for (const hull of this.jiao.hulls) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(hull.flat()));
      if (!desc) continue;
      desc
        .setDensity(mp ? 0 : PHYS.density)
        .setFriction(PHYS.frictionBlock)
        .setRestitution(PHYS.restitutionBlock)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0);
      const c = this.world.createCollider(desc, body);
      this.owner.set(c.handle, i);
    }
    body.sleep();
    // body.mass() stays 0 until the first step, so keep the known value
    const mass = mp ? mp.mass : (this.jiao.volume || 6.9e-5) * PHYS.density;
    return { body, mass };
  }

  #zeroAcc() {
    // impulse accumulated since last read, per contact pair, plus a "touching" flag
    return { floor: [0, 0], block: 0, other: [0, 0], touching: [false, false], blockTouch: false };
  }

  /**
   * Put both blocks in the thrower's cupped hands (flat faces up, "like butterfly
   * wings" as 行天宮 describes) and give them a gentle upward-forward toss.
   * `hand` is the release point, `fwd` the horizontal throw direction (unit).
   */
  toss(rng, hand, fwd) {
    const r = (a, b) => a + (b - a) * rng();
    const side = { x: -fwd.z, y: 0, z: fwd.x }; // right-hand vector
    const yawFwd = Math.atan2(-fwd.x, -fwd.z);
    const vUp = r(1.1, 1.75);
    const vFwd = r(0.8, 1.25);
    const spin = this.tossSpin ?? 1;
    const spinBase = { x: side.x * r(-11, -4) * spin, y: r(-3, 3), z: side.z * r(-11, -4) * spin }; // forward tumble
    this.blocks.forEach(({ body }, i) => {
      const s = i === 0 ? -1 : 1;
      // flat face up: flip about the block's long axis (local x), outer edges facing each other
      let q = quatFromAxisAngle(1, 0, 0, Math.PI);
      q = quatMul(quatFromAxisAngle(0, 1, 0, yawFwd + (s < 0 ? Math.PI / 2 : -Math.PI / 2) + r(-0.25, 0.25)), q);
      q = quatMul(quatFromAxisAngle(side.x, 0, side.z, r(-0.25, 0.25)), q);
      body.setTranslation({ x: hand.x + side.x * s * 0.034, y: hand.y + r(-0.005, 0.005), z: hand.z + side.z * s * 0.034 }, true);
      body.setRotation(q, true);
      const spread = r(0.03, 0.14);
      body.setLinvel({
        x: fwd.x * (vFwd + r(-0.12, 0.12)) + side.x * s * spread + r(-0.05, 0.05),
        y: vUp + r(-0.12, 0.12),
        z: fwd.z * (vFwd + r(-0.12, 0.12)) + side.z * s * spread + r(-0.05, 0.05),
      }, true);
      // each block also rolls about its own long axis as it leaves the fingers
      const roll = rotate(q, { x: r(-1, 1) * 9 * spin, y: 0, z: 0 });
      body.setAngvel({
        x: spinBase.x * r(0.6, 1.4) + r(-6, 6) * spin + roll.x,
        y: spinBase.y + r(-4, 4) + roll.y,
        z: spinBase.z * r(0.6, 1.4) + r(-6, 6) * spin + roll.z,
      }, true);
      body.wakeUp();
    });
    this.acc = this.#zeroAcc();
  }

  /** put a block at a pose (for tests and reference comparisons) */
  place(i, pos, quat) {
    const b = this.blocks[i].body;
    b.setTranslation(pos, true); b.setRotation(quat, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  step() {
    this.world.step(this.events);
    const acc = this.acc;
    this.events.drainContactForceEvents((e) => {
      const a = this.owner.get(e.collider1()), b = this.owner.get(e.collider2());
      const J = e.totalForceMagnitude() * STEP;
      if (typeof a === 'number' && typeof b === 'number') {
        if (a !== b) { acc.block += J; acc.blockTouch = true; }
        return;
      }
      const blk = typeof a === 'number' ? a : typeof b === 'number' ? b : null;
      if (blk === null) return;
      const other = typeof a === 'number' ? b : a;
      if (other === 'floor') acc.floor[blk] += J;
      else acc.other[blk] += J;
      acc.touching[blk] = true;
    });
  }

  /** read and reset accumulated contact impulses */
  drainContacts() {
    const a = this.acc;
    this.acc = this.#zeroAcc();
    return a;
  }

  state(i) {
    const b = this.blocks[i].body;
    return { p: b.translation(), q: b.rotation(), v: b.linvel(), w: b.angvel(), sleeping: b.isSleeping() };
  }

  /**
   * World-space normal of the flat face (local -Y). ny > 0 means the flat face
   * points up (平面朝上 / 陽); ny < 0 means the rounded back is up (凸面朝上 / 陰).
   */
  flatNormal(i) {
    return rotate(this.blocks[i].body.rotation(), { x: 0, y: -1, z: 0 });
  }

  /** classify a settled pair */
  reading() {
    const faces = [0, 1].map((i) => {
      const n = this.flatNormal(i);
      const p = this.blocks[i].body.translation();
      // standing on edge / tip: flat face roughly vertical while resting on the floor
      if (Math.abs(n.y) < 0.35 && p.y > 0.018) return 'stand';
      return n.y > 0 ? 'flat' : 'round';
    });
    let kind;
    if (faces.includes('stand')) kind = 'li';
    else {
      const flats = faces.filter((f) => f === 'flat').length;
      kind = flats === 1 ? 'sheng' : flats === 2 ? 'xiao' : 'yin';
    }
    return { kind, faces };
  }

  isResting(linTol = 0.012, angTol = 0.09) {
    return this.blocks.every(({ body }) => {
      if (body.isSleeping()) return true;
      const v = body.linvel(), w = body.angvel();
      return Math.hypot(v.x, v.y, v.z) < linTol && Math.hypot(w.x, w.y, w.z) < angTol;
    });
  }
}
