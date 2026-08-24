import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(600);
await page.keyboard.press('Space');
await wait(4200);
await page.evaluate(() => {
  window.__game.noLight = true;
  document.getElementById('hud').style.display = 'none';
});
await page.evaluate(() => { window.__game.player.x = 8; window.__game.player.y = 6.5; });
await wait(300);
await page.screenshot({ path: OUT + 'art-fullbright.png' });

// 只看静态图层
await page.evaluate(() => {
  const l = window.__level.statics;
  const c = document.createElement('canvas');
  c.width = l.img.width; c.height = l.img.height;
  c.getContext('2d').drawImage(l.img, 0, 0);
  window.__dataUrl = c.toDataURL();
});
const durl = await page.evaluate(() => window.__dataUrl);
fs.writeFileSync(OUT + 'art-static.png', Buffer.from(durl.split(',')[1], 'base64'));

console.log(logs.join('\n') || 'clean');
await browser.close();
