/**
 * 主菜单自查：开菜单、点三个按钮、再验一遍 __skipIntro，顺手截几张图。
 * 只用来确认"能跑起来、没报错"，不是玩法测试。
 *
 *   node server.js &      # 或 npm start
 *   node tools/menu.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME || '/usr/bin/google-chrome-stable';
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}menu-${String(++n).padStart(2, '0')}-${name}.png` });
  console.log('  shot', name);
};

/* 'load' 而不是 'networkidle0'：本地静态服务器的 keep-alive 连接会让
   networkidle0 一直等到超时，headless 下尤其明显。 */
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await wait(1200);
await shot('idle');
await wait(2600); // 扑玻璃那一下
await shot('press');

// 键盘选择：没有存档时「读取记录」是灰的，往下一格应该直接跳到「设置」
await page.keyboard.press('KeyS');
await wait(250);
await shot('select-settings');
console.log('  selected:', await page.evaluate(() => document.querySelector('.m-btn.on').dataset.act));

// 设置面板
await page.keyboard.press('Enter');
await wait(400);
await shot('settings');
console.log('  settings open:', await page.evaluate(() => !document.querySelector('#settings').classList.contains('hidden')));
await page.evaluate(() => document.querySelector('#set-los').click());
await page.evaluate(() => {
  const s = document.querySelector('#set-vol');
  s.value = '30';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(200);
console.log('  settings saved:', await page.evaluate(() => window.localStorage.getItem('lab7.settings.v1')));
await page.keyboard.press('Escape');
await wait(300);

// 开始游戏
await page.evaluate(() => document.querySelector('.m-btn[data-act="start"]').click());
await wait(1200);
await shot('wake');
await wait(3200);
await shot('play');
console.log('  state after start:', await page.evaluate(() => window.__game.state));

// 走到走廊，看有没有写进记录
await page.evaluate(() => window.__goto('corr2', 'fromLab'));
await wait(900);
const save = await page.evaluate(() => window.localStorage.getItem('lab7.save.v1'));
console.log('  save record:', save);

// 重新载入：菜单应该认出记录，读取记录可用
await page.reload({ waitUntil: 'load' });
await wait(900);
await shot('with-save');
console.log('  load enabled:', await page.evaluate(() => !document.querySelector('.m-btn[data-act="load"]').classList.contains('off')));
await page.evaluate(() => document.querySelector('.m-btn[data-act="load"]').click());
await wait(1400);
console.log('  after load:', await page.evaluate(() => ({ state: window.__game.state, area: window.__area().id })));
await shot('loaded');

// __skipIntro 还得能用
await page.reload({ waitUntil: 'load' });
await wait(700);
await page.evaluate(() => window.__skipIntro());
await wait(600);
console.log('  skipIntro:', await page.evaluate(() => ({ state: window.__game.state, menuHidden: getComputedStyle(document.querySelector('#menu')).opacity })));
await shot('skipintro');

// 帧率
const perf = await page.evaluate(async () => {
  const t0 = performance.now();
  let frames = 0;
  await new Promise((res) => {
    const loop = () => {
      frames++;
      if (performance.now() - t0 > 1500) res();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return (frames / ((performance.now() - t0) / 1000)).toFixed(1);
});

console.log('\n--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
console.log('--- fps (play) ---');
console.log(perf);

await browser.close();
