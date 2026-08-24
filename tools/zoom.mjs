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
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(500);
await page.keyboard.press('Space');
await wait(4200);
await page.evaluate(() => { window.__game.noLight = true; });
await wait(200);

// 参数: name,x,y,w,h,zoom
const crops = JSON.parse(process.argv[2] || '[]');
for (const c of crops) {
  const durl = await page.evaluate((c) => {
    const src = document.getElementById('game');
    const o = document.createElement('canvas');
    o.width = c.w * c.z;
    o.height = c.h * c.z;
    const g = o.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, o.width, o.height);
    return o.toDataURL();
  }, c);
  fs.writeFileSync(OUT + 'zoom-' + c.name + '.png', Buffer.from(durl.split(',')[1], 'base64'));
  console.log('wrote zoom-' + c.name + '.png');
}
await browser.close();
