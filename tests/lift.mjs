// Start from extreme result views (zoomed in, steep, turned far to a side), throw in real time and
// log the camera's per-frame rotation: the lift back up must never snap (yaw/pitch jumps in one frame).
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const base = process.argv[2] || 'http://127.0.0.1:5231/';
const [W, H, DPR] = (process.argv[3] || '1862x1010x2').split('x').map(Number);
const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
await page.goto(base);
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
const D = Math.PI / 180;
for (const [yaw, pitch, zoom] of [[-34, -57, 1.95], [34, -57, 1.95], [-30, -45, 2.6], [25, -50, 0.9], [-38, -40, 1.3], [0, -60, 3]]) {
  const r = await page.evaluate(async ([yaw, pitch, zoom]) => {
    const J = window.__jiao, rig = J.rig, cam = J.camera;
    rig.tgt = { yaw, pitch, zoom };
    rig.snap();
    await new Promise((res) => setTimeout(res, 400));
    const start = { yaw: cam.rotation.y, pitch: cam.rotation.x, fov: cam.fov };
    const log = [];
    let prev = null;
    await new Promise((res) => {
      const t0 = performance.now();
      const f = (now) => {
        const cur = { y: cam.rotation.y, x: cam.rotation.x, fov: cam.fov, t: now };
        if (prev) log.push({ dy: (cur.y - prev.y) / ((now - prev.t) / 1000), dx: (cur.x - prev.x) / ((now - prev.t) / 1000), dfov: (cur.fov - prev.fov) / ((now - prev.t) / 1000), mode: J.info().mode });
        prev = cur;
        if (now - t0 < 1800) requestAnimationFrame(f); else res();
      };
      requestAnimationFrame(f);
      document.getElementById('stage').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    // angular rates in deg/s; a "snap" is a rate far above its neighbours
    const R = 180 / Math.PI;
    let maxYaw = 0, maxPitch = 0, spike = 0, at = 0;
    for (let i = 1; i < log.length - 1; i++) {
      maxYaw = Math.max(maxYaw, Math.abs(log[i].dy * R)); maxPitch = Math.max(maxPitch, Math.abs(log[i].dx * R));
      for (const k of ['dy', 'dx']) {
        const nb = Math.max(Math.abs(log[i - 1][k]), Math.abs(log[i + 1][k]));
        const sp = (Math.abs(log[i][k]) - nb) * R;
        if (sp > spike) { spike = sp; at = i; }
      }
    }
    J.throw(); // leave the mode clean for the next case
    J.advance(12, 30);
    return { start: { yaw: +(start.yaw * R).toFixed(1), pitch: +(start.pitch * R).toFixed(1), fov: +start.fov.toFixed(1) }, maxYawRate: +maxYaw.toFixed(0), maxPitchRate: +maxPitch.toFixed(0), spikeOverNeighbours: +spike.toFixed(0),
      around: spike > 10 ? log.slice(Math.max(0, at - 3), at + 4).map((l) => [+(l.dy * R).toFixed(1), +(l.dx * R).toFixed(1), +l.dfov.toFixed(1), l.mode]) : undefined };
  }, [yaw * D, pitch * D, zoom]);
  console.log(JSON.stringify(r));
}
await browser.close();
