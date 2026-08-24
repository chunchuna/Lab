import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const crop = async (name, x, y, w, h, z) => {
  const durl = await page.evaluate((c) => {
    const src = document.getElementById('game');
    const o = document.createElement('canvas');
    o.width = c.w * c.z; o.height = c.h * c.z;
    const g = o.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, o.width, o.height);
    return o.toDataURL();
  }, { x, y, w, h, z });
  fs.writeFileSync(OUT + name + '.png', Buffer.from(durl.split(',')[1], 'base64'));
};

await wait(500);
await page.keyboard.press('Space');
await page.evaluate(() => { window.__game.fadeOff = true; });
await wait(700);
await crop('W1-lying', 230, 120, 170, 110, 4);
await wait(1300);
await crop('W2-sitting', 230, 120, 170, 110, 4);
await wait(900);
await crop('W3-standing', 230, 120, 170, 110, 4);
await wait(1500);
// 角色特写
await page.evaluate(() => { window.__game.player.x = 6.5; window.__game.player.y = 5.5; });
await page.mouse.move(1000, 400);
await wait(300);
await crop('W4-char', 290, 170, 90, 70, 6);
console.log('done');
await browser.close();
