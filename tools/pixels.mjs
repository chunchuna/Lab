/**
 * 像素质感自查：几处画面各截一张，并统计画面里"相邻设备像素完全同色"的
 * 比例 —— 纹素是硬边方块的话这个值会很高，平滑矢量图形则低。
 * 顺带在 dpr=1 与 dpr=2 各跑一遍，确认画布后备存储仍是 640N×360N。
 *
 *   npm start
 *   node tools/pixels.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const dpr of [1, 2]) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: dpr },
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await wait(1200);

  const info = await page.evaluate(() => {
    const c = document.querySelector('#game');
    return { backing: c.width + 'x' + c.height, css: c.clientWidth + 'x' + c.clientHeight, dpr: window.devicePixelRatio };
  });
  console.log(`dpr=${dpr}`, info);

  await page.screenshot({ path: `${OUT}pix-dpr${dpr}-menu.png` });

  await page.evaluate(() => window.__skipIntro());
  await wait(900);
  await page.screenshot({ path: `${OUT}pix-dpr${dpr}-lab.png` });

  await page.evaluate(() => window.__toRoof());
  await wait(1500);
  await page.screenshot({ path: `${OUT}pix-dpr${dpr}-roof.png` });

  /* 纹素统计：画布上取一块，看横向相邻像素同色的比例。
     纹素是 N 个设备像素宽的方块时，同色率约为 1 - 1/N。 */
  const stats = await page.evaluate(() => {
    const c = document.querySelector('#game');
    const g = c.getContext('2d');
    const w = Math.min(640, c.width);
    const h = Math.min(360, c.height);
    const x0 = ((c.width - w) / 2) | 0;
    const y0 = ((c.height - h) / 2) | 0;
    const d = g.getImageData(x0, y0, w, h).data;
    let same = 0;
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const i = (y * w + x) * 4;
        total++;
        if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2]) same++;
      }
    }
    return { sameRun: (same / total).toFixed(3), n: window.__game ? undefined : undefined };
  });
  console.log(`  相邻同色率 ${stats.sameRun}`, logs.length ? logs : '(no errors)');

  await browser.close();
}
