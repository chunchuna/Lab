/**
 * 文案自查：确认主菜单只剩三个按钮、序章结束卡片只剩一行，且这两处都没有中点。
 * 顺手验一遍「开始游戏」和 __skipIntro 还能用。
 *
 *   node server.js &      # 或 npm start
 *   node tools/copycheck.mjs
 */
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[404] ${r.url()}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await wait(1200);

const menu = await page.evaluate(() => {
  const m = document.querySelector('#menu');
  return {
    text: m.textContent.replace(/\s+/g, ' ').trim(),
    buttons: Array.from(m.querySelectorAll('.m-btn')).map((b) => b.textContent.trim()),
    nodes: m.querySelectorAll('h1, p, .m-note, .m-hint, .m-brand').length,
  };
});
console.log('menu text   :', JSON.stringify(menu.text));
console.log('menu buttons:', menu.buttons);
console.log('menu 多余节点:', menu.nodes);
console.log('menu 中点   :', menu.text.includes('·'));

const pause = await page.evaluate(() => {
  const p = document.querySelector('#pause');
  return {
    buttons: Array.from(p.querySelectorAll('.p-btn')).map((b) => b.textContent.trim()),
    text: p.textContent.replace(/\s+/g, ' ').trim(),
  };
});
console.log('pause buttons:', pause.buttons);
console.log('pause 中点   :', pause.text.includes('·'), '英文:', /[A-Za-z]/.test(pause.text));

const ending = await page.evaluate(() => {
  const e = document.querySelector('#ending');
  return { text: e.textContent.replace(/\s+/g, ' ').trim(), children: e.children.length };
});
console.log('ending text :', JSON.stringify(ending.text), '子节点', ending.children);
console.log('ending 中点 :', ending.text.includes('·'));

// 「开始游戏」还能进序章
await page.evaluate(() => document.querySelector('.m-btn[data-act="start"]').click());
await wait(2600);
console.log('start 后    :', await page.evaluate(() => window.__game.state));

// __skipIntro 还能跳过菜单与起床
await page.reload({ waitUntil: 'load' });
await wait(800);
await page.evaluate(() => window.__skipIntro());
await wait(700);
console.log('skipIntro   :', await page.evaluate(() => ({
  state: window.__game.state,
  menu: getComputedStyle(document.querySelector('#menu')).opacity,
})));

console.log('--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');

await browser.close();
