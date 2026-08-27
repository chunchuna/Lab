/**
 * PC 路径的单帧渲染耗时（主菜单 + 各区域）与建区一次性耗时。
 * bench.mjs 是触屏时代的旧脚本（走 ?touch=1，进不了现在的主菜单），PC 分支用这个。
 *
 *   npm start
 *   node tools/benchpc.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await wait(1200);

const bench = () =>
  page.evaluate(() => {
    const N = 120;
    window.__render();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) window.__render();
    return +((performance.now() - t0) / N).toFixed(2);
  });

console.log('menu  :', await bench(), 'ms/frame');
await page.evaluate(() => window.__skipIntro());
await wait(900);
console.log('lab   :', await bench(), 'ms/frame');
await page.evaluate(() => window.__toRoof());
await wait(1400);
console.log('roof  :', await bench(), 'ms/frame');
// 建区（含 finishArt）的一次性耗时
const t = await page.evaluate(() => {
  const t0 = performance.now();
  window.__goto('corr2', 'fromLab');
  return +(performance.now() - t0).toFixed(1);
});
console.log('corr2 首次进入（含烘焙+finishArt）:', t, 'ms');
console.log('corr2 :', await bench(), 'ms/frame');
await browser.close();
