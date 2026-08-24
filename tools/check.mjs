// 针对本次改动的定点验证：背包面板尺寸是否恒定、互动提示是否贴到物体上
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
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(400);
await page.evaluate(() => window.__skipIntro());
await page.evaluate(() => {
  window.__inv.addItem('flashlight');
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 2);
  window.__inv.addItem('badge');
});
await wait(300);

/* 1. 背包面板尺寸恒定性 */
await page.keyboard.press('i');
await wait(400);
const sizes = [];
for (const i of [0, 1, 2, 3]) {
  const b = await page.evaluate((n) => {
    const c = document.querySelector(`[data-cell="${n}"]`);
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, i);
  await page.mouse.move(b.x, b.y);
  await wait(160);
  const m = await page.evaluate(() => {
    const p = document.querySelector('.bag-panel').getBoundingClientRect();
    return {
      名称: document.querySelector('.bi-name').textContent,
      面板: Math.round(p.width) + 'x' + Math.round(p.height),
    };
  });
  sizes.push(m);
}
await page.screenshot({ path: OUT + 'C-bag.png' });
await page.keyboard.press('i');
await wait(300);

/* 2. 互动提示位置：应贴在物体附近，而不是屏幕底部中央 */
const spots = [
  ['门', 10.5, 1.3],
  ['储物柜', 2.3, 6.35],
  ['实验床', 4.8, 5.1],
];
const prompts = [];
for (const [name, x, y] of spots) {
  await page.evaluate((p) => { window.__game.player.x = p.x; window.__game.player.y = p.y; }, { x, y });
  await wait(260);
  const r = await page.evaluate(() => {
    const el = document.getElementById('prompt');
    if (el.classList.contains('hidden')) return null;
    const b = el.getBoundingClientRect();
    const st = document.getElementById('stage').getBoundingClientRect();
    return {
      文本: el.textContent.trim(),
      中心x: Math.round(b.x + b.width / 2 - st.x),
      中心y: Math.round(b.y + b.height / 2 - st.y),
      出屏: b.x < st.x || b.y < st.y || b.right > st.right || b.bottom > st.bottom,
    };
  });
  prompts.push({ name, ...(r || { 文本: '（未显示）' }) });
  await page.screenshot({ path: OUT + 'C-prompt-' + name + '.png' });
  // 描边很细，放大截一张才看得清
  const crop = { 门: [420, 130, 120, 90], 储物柜: [140, 140, 120, 90], 实验床: [250, 150, 120, 90] }[name];
  const durl = await page.evaluate((c) => {
    const src = document.getElementById('game');
    const o = document.createElement('canvas');
    o.width = c[2] * 5;
    o.height = c[3] * 5;
    const g = o.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, c[0], c[1], c[2], c[3], 0, 0, o.width, o.height);
    return o.toDataURL();
  }, crop);
  fs.writeFileSync(OUT + 'C-zoom-' + name + '.png', Buffer.from(durl.split(',')[1], 'base64'));
}

console.log('背包面板尺寸（应完全一致）:');
for (const s of sizes) console.log('  ' + s.名称.padEnd(14) + s.面板);
console.log('尺寸恒定:', new Set(sizes.map((s) => s.面板)).size === 1 ? '是' : '否 ← 有问题');
console.log('\n互动提示位置（舞台 1280x720，中心是 640,360）:');
for (const p of prompts) console.log('  ' + p.name.padEnd(5), JSON.stringify(p));
console.log('\n', errs.length ? 'ERR: ' + errs.join(';') : '无报错');
await browser.close();
