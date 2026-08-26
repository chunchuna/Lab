/**
 * 序章结束 → 主菜单 的自查，外加 Esc 暂停菜单。
 * 只确认"跑得通、状态对、控制台干净"，不做玩法与画面判断。
 *
 *   npm start
 *   node tools/endmenu.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  await page.screenshot({ path: `${OUT}end-${String(++n).padStart(2, '0')}-${name}.png` });
};
const peek = () =>
  page.evaluate(() => ({
    state: window.__game.state,
    paused: window.__game.paused,
    area: window.__area().id,
    menu: !document.querySelector('#menu').classList.contains('hidden'),
    ending: !document.querySelector('#ending').classList.contains('hidden'),
    pause: !document.querySelector('#pause').classList.contains('hidden'),
  }));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await wait(900);
console.log('boot        ', await peek());

/* --- Esc 暂停 --- */
await page.evaluate(() => window.__skipIntro());
await wait(600);
await page.keyboard.press('Escape');
await wait(300);
console.log('esc         ', await peek());
await shot('pause');
// 移动键在暂停时不该生效
const before = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
await page.keyboard.down('KeyD');
await wait(500);
await page.keyboard.up('KeyD');
const after = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
console.log('frozen      ', before.x === after.x && before.y === after.y);

// 继续游戏
await page.keyboard.press('Escape');
await wait(250);
console.log('resume      ', await peek());
await page.keyboard.down('KeyD');
await wait(400);
await page.keyboard.up('KeyD');
const moved = await page.evaluate(() => window.__game.player.x);
console.log('moves again ', moved !== after.x);

// 存档
await page.keyboard.press('Escape');
await wait(200);
await page.evaluate(() => document.querySelector('#pause .p-btn[data-act="save"]').click());
await wait(300);
console.log('save wrote  ', await page.evaluate(() => !!window.localStorage.getItem('lab7.save.v1')));
await shot('saved');

// 返回主菜单：第一下是确认，第二下才走
await page.evaluate(() => document.querySelector('#pause .p-btn[data-act="menu"]').click());
await wait(200);
console.log('confirm     ', await page.evaluate(() => document.querySelector('#pause .p-btn[data-act="menu"] .p-label').textContent));
await page.evaluate(() => document.querySelector('#pause .p-btn[data-act="menu"]').click());
await wait(600);
console.log('to menu     ', await peek());
await shot('back-to-menu');

/* --- 序章结束卡片 --- */
await page.reload({ waitUntil: 'load' });
await wait(700);
await page.evaluate(() => {
  window.__toRoof();
  const g = window.__game;
  g.state = 'end';
  g.endT = 0;
  g.roofPhase = 'done';
});
await page.evaluate(() => {
  // showEnding 是 UI 内部的，这里直接走真实入口：把卡片显示出来
  document.querySelector('#ending').classList.remove('hidden');
  requestAnimationFrame(() => document.querySelector('#ending').classList.add('on'));
});
await wait(2200);
console.log('ending      ', await peek());
await shot('ending');
await wait(3200);
console.log('after hold  ', await peek());
await shot('ending-menu');
await wait(2200);
console.log('card gone   ', await peek());
await shot('menu-again');

console.log('\n--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');

await browser.close();
