// 冒烟：营地基线截图（直升机 / 晨光 / 镜头）。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { CHROME } from './chrome.mjs';

const OUT = '/tmp/shots/';
fs.mkdirSync(OUT, { recursive: true });
const TAG = process.argv[2] || 'base';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${TAG}-${name}.png` });
  console.log('  shot', name);
};

await wait(800);
await page.evaluate(() => window.__toCamp());
await wait(1200);

// 站到停机坪边上看直升机
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 12.5;
  g.player.y = 9.5;
});
await wait(1400);
await shot('heli');

// 广场全景（看晨光整体色调）
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 21;
  g.player.y = 13;
});
await wait(1400);
await shot('plaza');

// v2.1.0 扩建区：食堂（长桌 + 打饭棚 + 排队）
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 33;
  g.player.y = 15;
});
await wait(1400);
await shot('mess');

// 卫生区（浴室 + 旱厕）
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 61;
  g.player.y = 18;
});
await wait(1400);
await shot('hygiene');

// 焚烧区（垃圾山 + 火 + 苍蝇）与东南角帐篷海
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 60;
  g.player.y = 35;
});
await wait(1400);
await shot('dump');

// 镜头停止抖动:按 d 走 1 秒，松开后逐帧记录 cam
await page.keyboard.down('d');
await wait(1000);
await page.keyboard.up('d');
const camTrace = await page.evaluate(() => new Promise((resolve) => {
  const g = window.__game;
  const rows = [];
  let n = 0;
  const step = () => {
    rows.push([g.cam.x.toFixed(4), g.cam.y.toFixed(4)]);
    if (++n < 120) requestAnimationFrame(step);
    else resolve(rows);
  };
  requestAnimationFrame(step);
}));
await shot('after-walk');
// 打印相邻帧的 delta，找“停住后突然跳一下”
let lines = [];
for (let i = 1; i < camTrace.length; i++) {
  const dx = camTrace[i][0] - camTrace[i - 1][0];
  const dy = camTrace[i][1] - camTrace[i - 1][1];
  lines.push(`${i}: dx=${dx.toFixed(4)} dy=${dy.toFixed(4)}`);
}
console.log(lines.slice(0, 90).join('\n'));

console.log('console:', logs.length ? logs.join('\n') : '(clean)');
await browser.close();
