/**
 * 放大看纹素：在几处画面里截一小块原始设备像素，用来确认边缘是硬方块
 * 而不是被插值糊过的渐变。
 *
 *   npm start
 *   node tools/pixcrop.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await wait(1000);

/** 把画布上的一块（逻辑 640×360 坐标）抠出来存成 png */
async function crop(name, lx, ly, lw, lh) {
  const b64 = await page.evaluate(
    (lx2, ly2, lw2, lh2) => {
      const c = document.querySelector('#game');
      const n = c.width / 640;
      const o = document.createElement('canvas');
      o.width = lw2 * n;
      o.height = lh2 * n;
      const g = o.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(c, lx2 * n, ly2 * n, lw2 * n, lh2 * n, 0, 0, lw2 * n, lh2 * n);
      return o.toDataURL('image/png').slice(22);
    },
    lx, ly, lw, lh,
  );
  fs.writeFileSync(`${OUT}crop-${name}.png`, Buffer.from(b64, 'base64'));
  console.log('  crop', name);
}

// 菜单：舱里的个体 + 舱外做记录的人
await wait(700);
await crop('menu-cast', 120, 100, 200, 130);

// 实验室：玩家站位附近
await page.evaluate(() => window.__skipIntro());
await wait(900);
await crop('lab-player', 250, 130, 160, 110);

// 天台：直升机与丧尸
await page.evaluate(() => window.__toRoof());
await wait(1200);
await page.evaluate(() => {
  const g = window.__game;
  g.roofPhase = 'heli';
  g.roofT = 0;
  g.heli = { t: 0, x: 300, y: 40, k: 1 };
});
await wait(1500);
await crop('roof-heli', 200, 20, 300, 180);
await crop('roof-player', 240, 140, 180, 130);

await browser.close();
