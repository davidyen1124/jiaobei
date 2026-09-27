// Deterministic screenshots of the running app (dev server or deployed URL).
// usage: node tests/shots.mjs <baseUrl> <outDir> [scenario]
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:5231/';
const out = process.argv[3] || 'renders/shots';
const scenario = process.argv[4] || 'all';
mkdirSync(out, { recursive: true });

const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--force-color-profile=srgb'] });

async function open(w, h, query = '', dpr = 1) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(base + (query ? `?${query}` : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
  await page.waitForTimeout(1300); // let the loading overlay finish fading out
  return { page, logs };
}

const report = {};

if (scenario === 'all' || scenario === 'flow') {
  const { page, logs } = await open(1600, 900, 'manual&capture');
  await page.evaluate(() => window.__jiao.advance(0.5));
  await page.screenshot({ path: `${out}/01_idle.png` });
  const frames = [0.45, 0.85, 1.05, 1.35, 1.7];
  await page.evaluate(() => window.__jiao.throw(7));
  let t = 0;
  for (const [k, f] of frames.entries()) {
    await page.evaluate((d) => window.__jiao.advance(d), f - t);
    t = f;
    await page.screenshot({ path: `${out}/02_flight_${k}.png` });
  }
  const info = await page.evaluate(() => window.__jiao.advance(6));
  await page.evaluate(() => window.__jiao.advance(2.5));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/03_result.png` });
  report.flow = { info, logs };
  await page.close();
}

if (scenario === 'all' || scenario === 'mobile') {
  const { page, logs } = await open(390, 844, 'manual&capture', 2);
  await page.evaluate(() => window.__jiao.advance(0.5));
  await page.screenshot({ path: `${out}/10_mobile_idle.png` });
  await page.evaluate(() => window.__jiao.throw(11));
  const info = await page.evaluate(() => window.__jiao.advance(8));
  await page.evaluate(() => window.__jiao.advance(2.5));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/11_mobile_result.png` });
  report.mobile = { info, logs };
  await page.close();
}

if (scenario === 'all' || scenario === 'ref') {
  const poses = JSON.parse(readFileSync(new URL('../blender/ref_poses.json', import.meta.url)));
  const { page, logs } = await open(1280, 720, 'manual&capture');
  await page.evaluate((p) => { window.__jiao.pose(p); }, poses);
  await page.evaluate(() => {
    // hide the UI chrome for a clean comparison with the Blender reference
    for (const id of ['brand', 'intro', 'tools', 'history', 'result', 'status']) document.getElementById(id).style.display = 'none';
    window.__jiao.setFilm(false);
  });
  await page.evaluate(() => window.__jiao.view(0, -36, 37.3));
  await page.screenshot({ path: `${out}/20_ref_three.png` });
  report.ref = { logs };
  await page.close();
}

if (scenario === 'all' || scenario === 'sizes') {
  for (const [w, h, dpr] of [[2560, 1080, 1], [1024, 1366, 2], [1366, 768, 1], [360, 640, 3]]) {
    const { page, logs } = await open(w, h, 'manual&capture', dpr);
    await page.evaluate(() => window.__jiao.advance(1.2));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}/30_${w}x${h}_idle.png` });
    await page.evaluate(() => window.__jiao.throw(5));
    await page.evaluate(() => window.__jiao.advance(9));
    await page.evaluate(() => window.__jiao.advance(2.5));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/31_${w}x${h}_result.png` });
    report[`size_${w}x${h}`] = { info: await page.evaluate(() => window.__jiao.info()), errors: logs.filter((l) => l.includes('error') && !l.includes('404')) };
    await page.close();
  }
}

if (scenario === 'stats') {
  const { page, logs } = await open(800, 450, 'manual');
  const res = await page.evaluate(() => {
    const c = { sheng: 0, xiao: 0, yin: 0, li: 0 };
    for (let k = 0; k < 40; k++) {
      window.__jiao.throw(5000 + k);
      window.__jiao.advance(10, 30);
      c[window.__jiao.info().reading.kind]++;
    }
    return c;
  });
  report.stats = { res, logs };
  await page.close();
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
