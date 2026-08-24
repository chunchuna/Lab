// 放大某个区域的局部，用来检查门洞/房间内景是否读得出来
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
const [areaId, spawn, sx, sy, sw, sh, z, name, noLight] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(400);
await page.evaluate((a) => {
  window.__skipIntro();
  window.__inv.addItem('flashlight');
  window.__inv.quickEquip('flashlight');
  window.__game.inv = undefined;
  window.__goto(a.id, a.sp);
}, { id: areaId, sp: spawn });
await wait(900);
if (noLight === '1') await page.evaluate(() => { window.__game.noLight = true; });
await wait(400);
const durl = await page.evaluate((c) => {
  const src = document.getElementById('game');
  const o = document.createElement('canvas');
  o.width = c.w * c.z; o.height = c.h * c.z;
  const g = o.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, o.width, o.height);
  return o.toDataURL();
}, { x: +sx, y: +sy, w: +sw, h: +sh, z: +z });
fs.writeFileSync(OUT + 'A-' + name + '.png', Buffer.from(durl.split(',')[1], 'base64'));
console.log('wrote A-' + name + '.png');
await browser.close();
