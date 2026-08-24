// 验证背包拖拽装备 + 视线遮挡开关。仅访问本地 http://localhost:5173 并截图到 shots/
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
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: OUT + 'B-' + n + '.png' });
const box = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);

async function drag(fromSel, toSel) {
  const a = await box(fromSel);
  const b = await box(toSel);
  if (!a || !b) throw new Error('missing ' + fromSel + ' / ' + toSel);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
    await wait(16);
  }
  await page.mouse.up();
  await wait(160);
}

await wait(500);
await page.keyboard.press('Space');
await wait(4300);

// 走到柜子前，开柜取物
await page.evaluate(() => { window.__game.player.x = 2.3; window.__game.player.y = 6.35; });
await wait(200);
await page.keyboard.press('e');
await wait(400);
await page.keyboard.press('e');
await wait(1400); // 自动打开背包
await shot('01-bag-open');

const state0 = await page.evaluate(() => ({
  bag: window.__inv.inv.bag.map((s) => (s ? s.id + 'x' + s.n : null)),
  left: window.__inv.inv.left && window.__inv.inv.left.id,
  right: window.__inv.inv.right && window.__inv.inv.right.id,
}));

// 拖：手电筒(格子0) -> 左手，手枪(格子1) -> 右手
await drag('[data-cell="0"]', '[data-slot="left"]');
await shot('02-drag-left');
await drag('[data-cell="1"]', '[data-slot="right"]');
await shot('03-both-hands');

const state1 = await page.evaluate(() => ({
  bag: window.__inv.inv.bag.map((s) => (s ? s.id + 'x' + s.n : null)),
  left: window.__inv.inv.left && window.__inv.inv.left.id,
  right: window.__inv.inv.right && window.__inv.inv.right.id,
}));

// 拖不可装备物品（弹匣，格子2）到手上，应被拒绝
await drag('[data-cell="2"]', '[data-slot="left"]');
const state2 = await page.evaluate(() => ({
  left: window.__inv.inv.left && window.__inv.inv.left.id,
  bag2: window.__inv.inv.bag[2] && window.__inv.inv.bag[2].id,
}));

// 左右手互换（拖手到手）
await drag('[data-slot="left"]', '[data-slot="right"]');
const state3 = await page.evaluate(() => ({
  left: window.__inv.inv.left && window.__inv.inv.left.id,
  right: window.__inv.inv.right && window.__inv.inv.right.id,
}));
await drag('[data-slot="left"]', '[data-slot="right"]');
await shot('04-after-swap');

// 关背包看游戏内
await page.keyboard.press('i');
await wait(400);
await page.evaluate(() => { window.__game.player.x = 7; window.__game.player.y = 5; });
await page.mouse.move(1150, 470);
await wait(400);
await shot('05-ingame-los-off');

// 打开视线遮挡
await page.keyboard.press('v');
await wait(400);
await shot('06-ingame-los-on');
const los = await page.evaluate(() => window.__game.losOcclusion);
await page.keyboard.press('v');
await wait(300);
await shot('07-los-off-again');

// 换弹消耗背包弹匣
const before = await page.evaluate(() => window.__inv.countItem('mag'));
await page.mouse.down();
await wait(500);
await page.mouse.up();
await page.keyboard.press('r');
await wait(1900);
const after = await page.evaluate(() => window.__inv.countItem('mag'));

console.log('初始:', JSON.stringify(state0));
console.log('拖两件后:', JSON.stringify(state1));
console.log('弹匣拖到手（应被拒绝）:', JSON.stringify(state2));
console.log('手到手交换:', JSON.stringify(state3));
console.log('LOS 开关:', los);
console.log('换弹前后弹匣:', before, '->', after);
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
