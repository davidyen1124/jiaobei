// Headless physics check: outcome distribution, landing spread and settle time.
import { readFileSync } from 'node:fs';
import { Physics, initRapier, mulberry32, STEP, PHYS } from '../src/physics.js';
if (process.env.PHYS) Object.assign(PHYS, JSON.parse(process.env.PHYS));

await initRapier();
const jiao = JSON.parse(readFileSync(new URL('../public/assets/jiao_colliders.json', import.meta.url)));
const N = +(process.argv[2] || 300);
const counts = { sheng: 0, xiao: 0, yin: 0, li: 0 };
const times = [], dists = [], xs = [], bounces = [];
const t0 = Date.now();
const phys = new Physics(jiao, []);
phys.tossSpin = +(process.argv[3] || 1);
for (let k = 0; k < N; k++) {
  const rng = mulberry32(1000 + k);
  phys.toss(rng, { x: 0, y: 0.98, z: -0.42 }, { x: 0, y: 0, z: -1 });
  let t = 0, rest = 0, hits = 0;
  while (t < 10) {
    phys.step(); t += STEP;
    const c = phys.drainContacts();
    for (const i of [0, 1]) if (c.floor[i] / 0.045 > 0.25) hits++;
    if (phys.isResting()) { rest += STEP; if (rest > 0.35) break; } else rest = 0;
  }
  const r = phys.reading();
  counts[r.kind]++;
  times.push(t);
  for (const i of [0, 1]) { const p = phys.state(i).p; dists.push(-p.z); xs.push(p.x); }
  bounces.push(hits);
}
const pct = (v) => ((100 * v) / N).toFixed(1) + '%';
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))].toFixed(2); };
console.log('throws', N, 'wall', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'mass', phys.blocks[0].body.mass().toFixed(4));
console.log('聖', pct(counts.sheng), '笑', pct(counts.xiao), '陰', pct(counts.yin), '立', pct(counts.li));
console.log('settle s p10/p50/p90', q(times, 0.1), q(times, 0.5), q(times, 0.9), 'max', Math.max(...times).toFixed(2));
console.log('rest distance m p10/p50/p90', q(dists, 0.1), q(dists, 0.5), q(dists, 0.9), ' x p10/p90', q(xs, 0.1), q(xs, 0.9));
console.log('impact-steps p50', q(bounces, 0.5));
