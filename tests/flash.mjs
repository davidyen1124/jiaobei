// Detect flashing: per-frame mean brightness of the real canvas while the app runs on its own rAF,
// plus a recorded video of several real-time throws.
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] || 'http://127.0.0.1:5231/';
const [W, H, DPR] = (process.argv[3] || '1862x1010x1').split('x').map(Number);
const out = process.argv[4] || 'renders/video';
mkdirSync(out, { recursive: true });
const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--force-color-profile=srgb'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, recordVideo: { dir: out, size: { width: Math.round(W / 2), height: Math.round(H / 2) } } });
const page = await ctx.newPage();
await page.goto(base + (base.includes('?') ? '&' : '?') + 'capture');
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
await page.evaluate(() => {
  const gl = window.__jiao.renderer.getContext();
  const c = gl.canvas;
  let buf = null;
  window.__lum = [];
  const f = () => {
    const w = c.width, h = c.height;
    if (!buf || buf.length !== w * h * 4) buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let s = 0, n = 0;
    for (let i = 0; i < buf.length; i += 4 * 7) { s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++; }
    s /= n;
    window.__lum.push([performance.now(), s, window.__jiao.info().mode]);
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
for (let k = 0; k < 4; k++) {
  await page.mouse.click(W * 0.45, H * 0.4);
  await page.waitForFunction(() => window.__jiao.info().mode === 'result', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2200);
}
const r = await page.evaluate(() => {
  const L = window.__lum;
  let maxJump = 0, at = null, jumps = 0;
  for (let i = 1; i < L.length; i++) {
    const d = Math.abs(L[i][1] - L[i - 1][1]);
    if (d > maxJump) { maxJump = d; at = [L[i - 1], L[i]]; }
    if (d > 6) jumps++;
  }
  // a flash = a jump that reverses within a couple of frames (spike), not a monotonic pan
  let spikes = 0; const spikeAt = [];
  for (let i = 1; i < L.length - 2; i++) {
    const a = L[i][1] - L[i - 1][1], b = L[i + 1][1] - L[i][1], c = L[i + 2][1] - L[i + 1][1];
    if (Math.abs(a) > 4 && (Math.sign(b) === -Math.sign(a) && Math.abs(b) > Math.abs(a) * 0.5 || Math.sign(c) === -Math.sign(a) && Math.abs(c) > Math.abs(a) * 0.5)) { spikes++; spikeAt.push(L.slice(i - 2, i + 3).map((x) => [+x[1].toFixed(1), x[2]])); }
  }
  const idx = L.findIndex((x) => x === at[1]);
  const around = L.slice(Math.max(0, idx - 8), idx + 8).map((x) => [+(x[0] - L[0][0]).toFixed(0), +x[1].toFixed(1), x[2]]);
  return { frames: L.length, meanLum: L.reduce((a, b) => a + b[1], 0) / L.length, maxJump, jumpsOver6: jumps, spikes, spikeAt: spikeAt.slice(0, 5), around };
});
console.log(JSON.stringify(r));
await ctx.close();
await browser.close();
