import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,760', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on('requestfailed', (r) => logs.push(`[404] ${r.url()}`));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png` });
  console.log('  shot', name);
};

const at = (x, y) => page.evaluate((p) => { window.__game.player.x = p.x; window.__game.player.y = p.y; }, { x, y });
const aim = (x, y) => page.mouse.move(x, y);

await wait(900);
await shot('menu');

// 开始 -> 醒来
await page.keyboard.press('Space');
await wait(900);
await shot('wake-lying');
await wait(1400);
await shot('wake-rising');
await wait(1600);
await shot('play-start');

// 真实 WASD 移动
await aim(760, 300);
await page.keyboard.down('d');
await wait(700);
await page.keyboard.up('d');
await shot('after-walk');

// 走到储物柜
await at(2.6, 7.4);
await aim(430, 420);
await wait(300);
await shot('locker-prompt');
await page.keyboard.press('e');
await wait(500);
await shot('locker-open');
await page.keyboard.press('e');
await wait(1400);
await shot('locker-looted-bag');
await page.keyboard.press('i'); // 关闭自动弹出的背包
await wait(400);
await page.keyboard.press('1');
await page.keyboard.press('2');
await wait(300);

// 手电筒
await aim(1000, 260);
await wait(400);
await shot('flashlight-right');
await aim(300, 200);
await wait(400);
await shot('flashlight-up-left');
await at(8.5, 6.5);
await aim(1050, 620);
await wait(400);
await shot('flashlight-center');

// 开枪
await aim(1100, 300);
await page.mouse.down();
await wait(90);
await shot('firing');
await page.mouse.up();
await wait(700);
await shot('after-shot');
await page.keyboard.press('r');
await wait(600);
await shot('reloading');
await wait(1200);

// 门 + 人脸识别
await at(11.55, 1.4);
await aim(760, 200);
await wait(400);
await shot('door-prompt');
await page.keyboard.press('e');
await wait(1800);
await shot('scan-mid');
await wait(2200);
await shot('scan-late');
await wait(2600);
await shot('scan-error');
await wait(2600);
await shot('after-scan');

// 关灯（手电筒关闭）看纯环境光
await page.keyboard.press('f');
await wait(400);
await shot('flash-off');

// 性能
const perf = await page.evaluate(async () => {
  const t0 = performance.now();
  let frames = 0;
  await new Promise((res) => {
    const loop = () => {
      frames++;
      if (performance.now() - t0 > 2000) res();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return { fps: (frames / ((performance.now() - t0) / 1000)).toFixed(1) };
});

console.log('\n--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
console.log('--- fps ---');
console.log(perf.fps);

await browser.close();
