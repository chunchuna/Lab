// 移动端触屏验证：手机横屏视口 + 真实 touch 事件，检查摇杆/按钮是否驱动游戏逻辑
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
});
const page = await browser.newPage();
// iPhone 14 横屏尺寸
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5173/?touch=1', { waitUntil: 'networkidle0' });

const cdp = await page.createCDPSession();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: OUT + 'M-' + n + '.png' });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const box = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, sel);
const st = () =>
  page.evaluate(() => ({
    state: window.__game.state,
    x: +window.__game.player.x.toFixed(2),
    y: +window.__game.player.y.toFixed(2),
    aim: +window.__game.player.aim.toFixed(2),
    bag: window.__game.bagOpen,
    mag: window.__game.gun.mag,
  }));

async function drag(sel, dx, dy, hold = 420) {
  const b = await box(sel);
  if (!b) throw new Error('no ' + sel);
  await touch('touchStart', [{ x: b.x, y: b.y, id: 1 }]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: b.x + (dx * i) / 6, y: b.y + (dy * i) / 6, id: 1 }]);
    await wait(20);
  }
  await wait(hold);
  await touch('touchEnd', []); // 最后一根手指抬起时 touchPoints 必须为空
}
async function tap(sel) {
  const b = await box(sel);
  if (!b) throw new Error('no ' + sel);
  await touch('touchStart', [{ x: b.x, y: b.y, id: 1 }]);
  await wait(220);
  await touch('touchEnd', []);
  await wait(220);
}

await wait(700);
await shot('01-title');

// 点击开始
await touch('touchStart', [{ x: 422, y: 120, id: 1 }]);
await wait(60);
await touch('touchEnd', []);
await wait(4300);
await shot('02-play');
const s0 = await st();

// 左摇杆：向右上推
await drag('#stick-move', 46, -30, 600);
const s1 = await st();
await shot('03-after-move');

// 右摇杆：改朝向
await drag('#stick-aim', -44, 22, 320);
const s2 = await st();
await shot('04-after-aim');

// 拿装备：直接放进背包并装备，验证按钮联动
await page.evaluate(() => {
  window.__inv.addItem('flashlight');
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 2);
  window.__inv.quickEquip('flashlight');
  window.__inv.quickEquip('pistol');
});
await wait(400);
await shot('05-equipped');
const btns = await page.evaluate(() =>
  [...document.querySelectorAll('#pad [data-act]')].map(
    (b) => b.dataset.act + (b.classList.contains('hidden') ? ':hidden' : ':shown'),
  ),
);

// 开枪按钮
await tap('[data-act="fire"]');
await wait(300);
const s3 = await st();
await shot('06-fired');

// 背包按钮 + 触屏拖拽
await tap('[data-act="bag"]');
await wait(500);
await shot('07-bag');
const s4 = await st();

// 触屏把手枪从右手拖回背包格子
const a = await box('[data-slot="right"]');
const c = await box('[data-cell="5"]');
await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', [{ x: a.x + ((c.x - a.x) * i) / 8, y: a.y + ((c.y - a.y) * i) / 8, id: 1 }]);
  await wait(18);
}
await touch('touchEnd', []);
await wait(300);
await shot('08-bag-drag');
const dragRes = await page.evaluate(() => ({
  right: window.__inv.inv.right && window.__inv.inv.right.id,
  cell5: window.__inv.inv.bag[5] && window.__inv.inv.bag[5].id,
}));

await tap('[data-act="bag"]');
await wait(400);

// 性能
const perf = await page.evaluate(async () => {
  const t0 = performance.now();
  let f = 0;
  await new Promise((res) => {
    const loop = () => {
      f++;
      if (performance.now() - t0 > 3000) res();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return (f / ((performance.now() - t0) / 1000)).toFixed(1);
});

console.log('开局      :', JSON.stringify(s0));
console.log('推左摇杆后:', JSON.stringify(s1), '位移=', (Math.hypot(s1.x - s0.x, s1.y - s0.y)).toFixed(2));
console.log('推右摇杆后:', JSON.stringify(s2), 'aim 变化=', (s2.aim - s1.aim).toFixed(2));
console.log('按钮可见性:', btns.join('  '));
console.log('开枪后    :', JSON.stringify(s3));
console.log('背包状态  :', JSON.stringify(s4));
console.log('触屏拖拽  :', JSON.stringify(dragRes));
console.log('FPS       :', perf);
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
