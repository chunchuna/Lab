/**
 * 收尾这一整段跑一遍：逃脱过场 → 结束卡片「序章完」→ 主菜单。
 *
 * 两段 QTE 靠脚本按不出稳定节奏（headless 里帧率飘），所以这里从
 * `__toCine()` 起手 —— 人已经吊在绳子上，之后走的全是真实代码路径：
 * updateCine → state='end' → UI.showEnding() → returnToMenu()。
 *
 * 只确认"跑得完、状态对、控制台干净"，画面手感请人眼看。
 *
 *   npm start
 *   node tools/finale.mjs
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
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await wait(200);
  }
  return false;
};
const shot = (name) => page.screenshot({ path: `${OUT}finale-${String(++n).padStart(2, '0')}-${name}.png` });
const peek = () =>
  page.evaluate(() => ({
    state: window.__game.state,
    phase: window.__game.roofPhase,
    area: window.__area().id,
    t: window.__game.cine ? +window.__game.cine.t.toFixed(1) : null,
    endT: +window.__game.endT.toFixed(1),
    ending: !document.querySelector('#ending').classList.contains('hidden'),
    menu: !document.querySelector('#menu').classList.contains('hidden'),
    // HUD 靠 #hud.menu-on 让位（不是 hidden），菜单一幕里应该是 false
    hud: !document.querySelector('#hud').classList.contains('menu-on'),
  }));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await wait(900);

await page.evaluate(() => window.__toCine());
await wait(300);
console.log('过场开始  ', await peek());
await shot('grab');

await wait(4500);
console.log('拽进舱    ', await peek());
await shot('cabin');

await wait(5500);
console.log('拉升离场  ', await peek());
await shot('away');

// CINE.end = 6.3 游戏秒。headless 掉帧，游戏时间跑得比墙钟慢，多等一点
await until(() => window.__game.state === 'end', 40000);
console.log('结束卡片  ', await peek());
await shot('ending');

// END_HOLD = 4.6 秒之后 returnToMenu()
await until(() => window.__game.state === 'menu', 30000);
console.log('回主菜单  ', await peek());
await shot('menu');

// 卡片淡出干净了吗
await wait(1600);
console.log('卡片淡出  ', await peek());
await shot('menu-clean');

// 菜单能重新开一局吗
await page.keyboard.press('Enter');
await wait(1600);
console.log('再开一局  ', await peek());
await shot('replay');

console.log('\n--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
await browser.close();
