// 冒烟：直升机像素化重绘（v1.8.2）。
// 天台悬停（机体/探照灯/绳索）→ 抓绳过场（伸手/拽入/关门）各截一张，
// 顺带收集控制台报错。跑法：先 `npm start`，再 `node tools/helipix.mjs`。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHROME } from './chrome.mjs';

const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

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
  await page.screenshot({ path: `${OUT}heli-${name}.png` });
  console.log('  shot', name);
};

await wait(700);
// 天台 → 直接进直升机进场
await page.evaluate(() => {
  window.__toRoof();
  window.__game.roofPhase = 'clear';
  window.__game.roofT = 6;
});
await wait(8500); // 进场 4.6s（headless 里前一两秒会被节流，多等一点）
// 玩家走到天台边缘触发放绳
await page.evaluate(() => {
  const r = window.__area().roof;
  window.__game.player.x = r.rope.x;
  window.__game.player.y = r.rope.y + 0.5;
});
await wait(2600); // 绳放到底 + 套环
await shot('hover-rope');
console.log(await page.evaluate(() => JSON.stringify({ phase: window.__game.roofPhase, rope: window.__game.rope })));
// 收尾过场：伸手抓住 → 拽进舱
await page.evaluate(() => window.__toCine());
await wait(1200);
await shot('cine-grab');
await wait(1400);
await shot('cine-haul');
await wait(1100);
await shot('cine-door');
console.log('--- console ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
await browser.close();
