// 抓起床动画的关键帧，检查比例是否一致、有没有拉伸
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(400);
// 关掉黑幕，才看得清动作
await page.evaluate(() => { window.__game.fadeOff = true; });
await page.keyboard.press('Space');

const shots = [];
const targets = [0.8, 1.6, 1.95, 2.3, 2.6, 2.9, 3.2];
let i = 0;
const t0 = Date.now();
while (i < targets.length && Date.now() - t0 < 9000) {
  const ph = await page.evaluate(() => window.__game.phase);
  if (ph >= targets[i]) {
    const durl = await page.evaluate(() => {
      const src = document.getElementById('game');
      const o = document.createElement('canvas');
      o.width = 150 * 4; o.height = 110 * 4;
      const g = o.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(src, 230, 130, 150, 110, 0, 0, o.width, o.height);
      return o.toDataURL();
    });
    fs.writeFileSync(OUT + `WK-${i}-t${targets[i]}.png`, Buffer.from(durl.split(',')[1], 'base64'));
    shots.push(targets[i]);
    i++;
  }
  await wait(40);
}
console.log('抓到帧:', shots.join(' '));
await browser.close();
