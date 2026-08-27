// 冒烟：天台雨 + 远景回归排查。
// 1) __toRoof() 截天台（远景 + 雨）；2) __goto('lab') 截实验室，确认无雨。
// 跑法：先 `npm start`，再 `node tools/rainroof.mjs [标签]`。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHROME } from './chrome.mjs';

const tag = process.argv[2] || 'now';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}rain-${tag}-${name}.png` });
  console.log('  shot', name);
};
const state = () => page.evaluate(() => JSON.stringify({
  area: window.__area().id,
  storm: !!window.__game.storm,
}));

await wait(700);
await page.evaluate(() => window.__toRoof());
await wait(2600);
console.log('roof:', await state());
await shot('roof');
await wait(1200);
await shot('roof2');

// 水花只该出现在屋面内：连续采样几秒，逐个落点过一遍反投影判界
let sampled = 0;
let offRoof = 0;
for (let i = 0; i < 24; i++) {
  const r = await page.evaluate(() => {
    const bad = window.__rain.splashes.filter((s) => !window.__splashOnGround(s.x, s.y));
    return { n: window.__rain.splashes.length, bad: bad.map((s) => [s.x | 0, s.y | 0]) };
  });
  sampled += r.n;
  offRoof += r.bad.length;
  if (r.bad.length) console.log('  OFF-ROOF splash:', JSON.stringify(r.bad));
  await wait(250);
}
console.log(`splash check: ${sampled} sampled, ${offRoof} off-roof ${offRoof === 0 ? '(PASS)' : '(FAIL)'}`);

await page.evaluate(() => window.__goto('lab'));
await wait(2200);
console.log('lab:', await state());
await shot('lab');

await page.evaluate(() => window.__goto('corr3', 'fromDorm'));
await wait(2200);
console.log('corr3:', await state());
await shot('corr3');

console.log('--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
await browser.close();
