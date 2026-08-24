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

// 直接给予装备
await page.evaluate(() => {
  const g = window.__game;
  g.inv.owned.add('pistol');
  g.inv.owned.add('flashlight');
  g.inv.left = 'flashlight';
  g.inv.right = 'pistol';
  g.inv.flashOn = true;
  document.querySelectorAll('#messages,#help,#prompt,#objective').forEach((e) => (e.style.display = 'none'));
});

const cases = [
  ['beam-right', 7.0, 5.0, 1180, 460],
  ['beam-up', 7.0, 5.0, 700, 120],
  ['beam-left', 7.0, 5.0, 200, 460],
  ['beam-down', 7.0, 5.0, 760, 700],
  ['behind-locker', 4.5, 6.5, 180, 320],
  ['corner', 12.0, 8.5, 400, 180],
];
for (const [name, x, y, mx, my] of cases) {
  await page.evaluate((p) => { window.__game.player.x = p.x; window.__game.player.y = p.y; }, { x, y });
  await page.mouse.move(mx, my);
  await wait(280);
  await page.screenshot({ path: OUT + 'L-' + name + '.png' });
  console.log('shot', name);
}

// 手电筒关闭：只有环境光
await page.evaluate(() => { window.__game.inv.flashOn = false; window.__game.player.x = 7; window.__game.player.y = 5; });
await wait(300);
await page.screenshot({ path: OUT + 'L-ambient.png' });

await browser.close();
