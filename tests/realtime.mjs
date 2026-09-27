// Real-time (rAF-driven, no manual stepping) test of repeated throws at a given viewport.
// Logs per-frame camera motion and whether any screen corner falls outside the rendered panorama.
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const base = process.argv[2] || 'http://127.0.0.1:5231/';
const [W, H, DPR] = (process.argv[3] || '1862x1010x2').split('x').map(Number);
const throws = +(process.argv[4] || 8);
const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
await page.goto(base);
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
await page.evaluate(async () => {
  const J = window.__jiao, cam = J.camera;
  window.__log = [];
  const meta = await (await fetch('/assets/scene.json')).json();
  const pano = meta.pano, nadir = meta.nadir;
  const nt = nadir ? Math.tan((nadir.fov / 2) * Math.PI / 180) : 0;
  let prev = null;
  const f = () => {
    const e = cam.rotation, info = J.info();
    // corners in world space
    const tv = Math.tan((cam.fov * Math.PI) / 360), th = tv * cam.aspect;
    let out = 0;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const v = { x: sx * th, y: sy * tv, z: -1 };
      // rotate by camera quaternion
      const q = cam.quaternion; const { x, y, z, w } = q;
      const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z, iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
      const rx = ix * w + iw * -x + iy * -z - iz * -y, ry = iy * w + iw * -y + iz * -x - ix * -z, rz = iz * w + iw * -z + ix * -y - iy * -x;
      const L = Math.hypot(rx, ry, rz);
      const lat = Math.asin(ry / L) * 180 / Math.PI, lon = Math.atan2(rx, -rz) * 180 / Math.PI;
      const inPano = !(lat < pano.latMin || lat > pano.latMax || lon < pano.lonMin || lon > pano.lonMax);
      const inNadir = nadir && ry < 0 && Math.abs(rx / -ry) <= nt && Math.abs(rz / -ry) <= nt;
      if (!inPano && !inNadir) out++;
    }
    const cur = { t: performance.now(), px: e.x, py: e.y, fov: cam.fov, mode: info.mode, out };
    if (prev) cur.dpx = cur.px - prev.px, cur.dpy = cur.py - prev.py, cur.dfov = cur.fov - prev.fov;
    window.__log.push(cur); prev = cur;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const summary = [];
for (let k = 0; k < throws; k++) {
  await page.evaluate(() => { window.__log.length = 0; });
  await page.mouse.click(W * (0.3 + 0.4 * Math.random()), H * (0.3 + 0.3 * Math.random()));
  await page.waitForFunction(() => window.__jiao.info().mode === 'result', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => {
    const L = window.__log;
    const outFrames = L.filter((l) => l.out > 0).length;
    // oscillation: sign flips of the per-frame pitch/yaw change with meaningful size
    let flips = 0, big = 0;
    for (let i = 2; i < L.length; i++) {
      for (const k of ['dpx', 'dpy']) {
        if (Math.abs(L[i][k]) > 0.002 && Math.abs(L[i - 1][k]) > 0.002 && Math.sign(L[i][k]) !== Math.sign(L[i - 1][k])) flips++;
        if (Math.abs(L[i][k]) > 0.03) big++;
      }
    }
    const last = L[L.length - 1];
    // are both blocks visible, on screen and clear of the result card?
    const cam = window.__jiao.camera, r = document.getElementById('result').getBoundingClientRect();
    const V = cam.position.constructor;
    const vis = window.__jiao.info().blocks.map((b) => {
      // whole block: centre and rim points must be on screen with a margin, and clear of the card
      let worst = 'ok';
      for (const [dx, dz] of [[0, 0], [0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]]) {
        const v = new V(b.p[0] + dx, b.p[1], b.p[2] + dz).project(cam);
        const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
        const m = 14;
        if (!(x > m && x < innerWidth - m && y > m && y < innerHeight - m)) worst = 'EDGE';
        if (x > r.left - 6 && x < r.right + 6 && y > r.top - 6 && y < r.bottom + 6) worst = 'UNDER_CARD';
      }
      return worst;
    });
    const bigs = [];
    for (let i = 1; i < L.length; i++) if (Math.abs(L[i].dpx) > 0.03 || Math.abs(L[i].dpy) > 0.03) bigs.push({ dt: +(L[i].t - L[i - 1].t).toFixed(1), dpx: +(L[i].dpx * 57.3).toFixed(2), dpy: +(L[i].dpy * 57.3).toFixed(2), mode: L[i].mode, fov: +L[i].fov.toFixed(1), prevMode: L[i - 1].mode });
    return { bigs, vis, frames: L.length, outFrames, flips, big, final: { pitch: +(last.px * 57.3).toFixed(1), yaw: +(last.py * 57.3).toFixed(1), fov: +last.fov.toFixed(1) }, info: window.__jiao.info() };
  });
  summary.push(s);
  if (k === 0) await page.screenshot({ path: `renders/rt_final_${W}x${H}.png` });
  if (s.bigs.length) console.log('   BIG', JSON.stringify(s.bigs));
  console.log(k, s.info.reading?.kind, 'blocks:', s.vis.join('/'), 'frames', s.frames, 'outside', s.outFrames, 'flips', s.flips, 'bigJumps', s.big, 'final', JSON.stringify(s.final), 'blocks', JSON.stringify(s.info.blocks.map((b) => b.p)));
  if (s.outFrames || s.vis.some((v) => v !== 'ok')) { await page.screenshot({ path: `renders/rt_${k}.png` }); console.log('   DETAIL', JSON.stringify({ mode: s.info.mode, reading: s.info.reading, seed: s.info.seed, cam: s.info.camera, blocks: s.info.blocks })); }
}
console.log('errors', errs.slice(0, 10));
await browser.close();
