// Real-time (rAF) frame-rate check during a throw.
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const base = process.argv[2] || 'http://127.0.0.1:5231/';
const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true });
for (const [w, h, dpr] of [[1600, 900, 1], [390, 844, 3]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
  const loadMs = Date.now() - t0;
  await page.mouse.click(w / 2, h / 3);
  const r = await page.evaluate(() => new Promise((res) => {
    const ts = [];
    const f = (t) => { ts.push(t); if (t - ts[0] < 4500) requestAnimationFrame(f); else {
      const d = ts.slice(1).map((v, i) => v - ts[i]); d.sort((a, b) => a - b);
      res({ frames: d.length, avg: (ts[ts.length - 1] - ts[0]) / d.length, p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1], info: window.__jiao.info() });
    } };
    requestAnimationFrame(f);
  }));
  console.log(`${w}x${h}@${dpr}`, 'load', loadMs, 'ms', 'avg frame', r.avg.toFixed(2), 'p95', r.p95.toFixed(2), 'max', r.max.toFixed(1), 'mode', r.info.mode, r.info.reading?.kind, errs);
  await page.close();
}
await browser.close();
