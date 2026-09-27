// Real-time (rAF) check of the toss itself: from the tap until the blocks first reach the floor,
// log each block's per-frame world motion and flag stalls (hands stop before the release) and
// velocity jumps (the flight starting abruptly instead of flowing out of the swing).
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const base = process.argv[2] || 'http://127.0.0.1:5231/';
const [W, H, DPR] = (process.argv[3] || '1862x1010x2').split('x').map(Number);
const throws = +(process.argv[4] || 5);
const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(base);
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
await page.evaluate(() => {
  const J = window.__jiao;
  window.__log = [];
  window.__tap = 0;
  window.addEventListener('pointerup', () => { window.__tap = performance.now(); }, true);
  // older builds have no blocks getter: the blocks are the only shadow casters
  const meshes = J.blocks || (() => { const a = []; J.scene.traverse((o) => { if (o.isMesh && o.castShadow) a.push(o); }); return a; })();
  const f = (now) => {
    const cam = J.camera;
    window.__log.push({
      t: now, mode: J.info().mode,
      pitch: cam.rotation.x * 57.3, fov: cam.fov,
      b: meshes.map((m) => {
        const s = m.position.clone().project(cam);
        return { vis: m.visible, p: m.position.toArray(), q: m.quaternion.toArray(), ndcY: s.y, sx: (s.x * 0.5 + 0.5) * innerWidth, sy: (-s.y * 0.5 + 0.5) * innerHeight };
      }),
    });
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});

const results = [];
for (let k = 0; k < throws; k++) {
  await page.evaluate(() => { window.__log.length = 0; });
  await page.mouse.click(W * (0.35 + 0.3 * Math.random()), H * (0.35 + 0.3 * Math.random()));
  await page.waitForFunction(() => window.__jiao.info().mode === 'result', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const L = window.__log.filter((l) => l.t >= window.__tap - 1);
    const out = [];
    for (const i of [0, 1]) {
      // from the first visible frame until the block first gets near the floor
      const F = [];
      for (const l of L) {
        const b = l.b[i];
        if (!b.vis) continue;
        if (b.p[1] < 0.05) break;
        F.push({ t: l.t, mode: l.mode, ...b });
      }
      const rel = F.findIndex((f) => f.mode === 'throw');
      const tRel = rel >= 0 ? F[rel].t : Infinity;
      const inView = (f) => f.sy < innerHeight && f.sy > 0 && f.sx > 0 && f.sx < innerWidth;
      const onScreen = F.find(inView);
      // after the release: share of flight frames with the block in view, and how far above the top it gets
      const flight = F.filter((f) => f.t >= tRel);
      const inFlight = flight.length ? flight.filter(inView).length / flight.length : 0;
      const topNdc = Math.max(...flight.map((f) => f.ndcY));
      let stall = 0, stallAt = null, run = 0, maxAcc = 0, maxAccAt = null, maxAngAcc = 0, maxJumpPx = 0, maxDt = 0, relAcc = 0, relAngAcc = 0;
      let prevV = null, prevW = null;
      const speeds = [];
      for (let j = 1; j < F.length; j++) {
        const a = F[j - 1], b = F[j], dt = (b.t - a.t) / 1000;
        if (dt <= 0) continue;
        maxDt = Math.max(maxDt, dt);
        const v = [0, 1, 2].map((k) => (b.p[k] - a.p[k]) / dt);
        const sp = Math.hypot(...v);
        speeds.push([+((b.t - window.__tap) / 1000).toFixed(3), +sp.toFixed(2), +v[1].toFixed(2), b.mode]);
        // angle between consecutive orientations
        const dot = Math.min(1, Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]));
        const w = (2 * Math.acos(dot)) / dt;
        if (sp < 0.25) { run += dt; if (run > stall) { stall = run; stallAt = [+((b.t - tRel) / 1000).toFixed(3), b.mode, +b.p[1].toFixed(3)]; } } else run = 0;
        if (prevV) {
          const acc = Math.hypot(v[0] - prevV[0], v[1] - prevV[1], v[2] - prevV[2]) / dt;
          if (acc > maxAcc) { maxAcc = acc; maxAccAt = [+((b.t - window.__tap) / 1000).toFixed(3), a.mode, b.mode]; }
          const angAcc = Math.abs(w - prevW) / dt;
          maxAngAcc = Math.max(maxAngAcc, angAcc);
          // around the release only (later spikes are real collisions, e.g. block on block in mid-air)
          if (Math.abs(b.t - tRel) < 60) { relAcc = Math.max(relAcc, acc); relAngAcc = Math.max(relAngAcc, angAcc); }
        }
        if (inView(a) && inView(b)) maxJumpPx = Math.max(maxJumpPx, Math.hypot(b.sx - a.sx, b.sy - a.sy));
        prevV = v; prevW = w;
      }
      out.push({ inFlight: +inFlight.toFixed(2), topNdc: +topNdc.toFixed(2), onScreen: onScreen ? +((onScreen.t - window.__tap) / 1000).toFixed(3) : null, release: +((tRel - window.__tap) / 1000).toFixed(3), relAcc: +relAcc.toFixed(1), relAngAcc: +relAngAcc.toFixed(0), frames: F.length, airTime: F.length ? +((F[F.length - 1].t - F[0].t) / 1000).toFixed(3) : 0, stall: +stall.toFixed(3), stallAt, maxAcc: +maxAcc.toFixed(1), maxAccAt, maxAngAcc: +maxAngAcc.toFixed(0), maxJumpPx: +maxJumpPx.toFixed(1), maxDtMs: +(maxDt * 1000).toFixed(1), speeds });
    }
    return { out, reading: window.__jiao.info().reading?.kind, tapPitch: +L[0].pitch.toFixed(1), tapFov: +L[0].fov.toFixed(1) };
  });
  results.push(r);
  const [a, b] = r.out;
  console.log(`${k} ${r.reading}  tapCam ${r.tapPitch}°/${r.tapFov}°  inFlight ${a.inFlight}/${b.inFlight}  topNdc ${a.topNdc}/${b.topNdc}  onScreen ${a.onScreen}/${b.onScreen}s  release ${a.release}s  releaseAcc ${a.relAcc}/${b.relAcc} m/s²  releaseAngAcc ${a.relAngAcc}/${b.relAngAcc} rad/s²  stall ${a.stall}s/${b.stall}s  maxAcc ${a.maxAcc}/${b.maxAcc} m/s² at ${JSON.stringify(a.maxAccAt)}  maxAngAcc ${a.maxAngAcc}/${b.maxAngAcc} rad/s²  maxJump ${a.maxJumpPx}px  maxDt ${a.maxDtMs}ms  air ${a.airTime}s`);
  for (const x of r.out) if (x.stall > 0) console.log('   stall at (s after release, mode, height)', JSON.stringify(x.stallAt));
  if (k === 0 && process.env.VERBOSE) console.log(JSON.stringify(a.speeds));
  await page.waitForTimeout(1200);
}
console.log('errors', errs.slice(0, 10));
await browser.close();
