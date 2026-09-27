// Render the physics-driven sound of seeded throws to WAV files and print basic stats.
import { chromium } from '/Users/david/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.argv[2] || 'http://127.0.0.1:5231/';
const out = process.argv[3] || 'renders/audio';
mkdirSync(out, { recursive: true });
const exe = '/Users/david/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base + '?manual');
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), null, { timeout: 60000 });
for (const seed of [3, 7, 21]) {
  const r = await page.evaluate((s) => window.__jiao.recordThrow(s, 6), seed);
  writeFileSync(`${out}/throw_${seed}.wav`, Buffer.from(r.wav, 'base64'));
  console.log('seed', seed, r.reading?.kind, 'peak', r.peak.toFixed(3), 'impacts', r.impacts.length);
  console.log('  first impacts [t, kind, speed]:', JSON.stringify(r.impacts.slice(0, 14)));
}
await browser.close();
