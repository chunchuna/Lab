// 验证多平台分发的可行性：iframe 嵌入（itch.io）、桌面键鼠、手机竖屏/横屏
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. iframe 嵌入（itch.io 的运行方式） ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 600 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5173/tools/embed-test.html', { waitUntil: 'networkidle0' });
  await wait(1200);
  // 点进 iframe 内部开始游戏
  const fr = page.frames().find((f) => f.url().endsWith('/index.html'));
  await page.mouse.click(500, 300);
  await wait(4400);
  const info = await fr.evaluate(() => ({
    state: window.__game.state,
    touch: window.__pad.enabled,
    stage: (() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    })(),
    inIframe: window.self !== window.top,
  }));
  await page.screenshot({ path: OUT + 'P-iframe-itch.png' });
  console.log('iframe 嵌入 :', JSON.stringify(info), errs.length ? 'ERR:' + errs.join(';') : '无报错');
  await page.close();
}

/* ---------- 2. 手机竖屏 / 横屏 ---------- */
for (const [name, w, h] of [
  ['手机竖屏', 390, 844],
  ['手机横屏', 844, 390],
  ['平板横屏', 1180, 820],
]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  const cdp = await page.createCDPSession();
  await wait(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: w / 2, y: h / 3, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(4400);
  const info = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    const st = document.getElementById('stick-move');
    const sr = st ? st.getBoundingClientRect() : null;
    return {
      touch: window.__pad.enabled,
      stage: Math.round(r.width) + 'x' + Math.round(r.height),
      fontPx: getComputedStyle(document.getElementById('stage')).fontSize,
      stick: sr ? Math.round(sr.width) + 'px' : 'none',
      覆盖率: Math.round(((r.width * r.height) / (innerWidth * innerHeight)) * 100) + '%',
    };
  });
  await page.screenshot({ path: OUT + 'P-' + name + '.png' });
  console.log(name.padEnd(6), ':', JSON.stringify(info), errs.length ? 'ERR:' + errs.join(';') : '无报错');
  await page.close();
}

/* ---------- 3. 桌面键鼠 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await wait(600);
  await page.keyboard.press('Space');
  await wait(4400);
  await page.mouse.move(900, 400);
  await page.keyboard.down('d');
  await wait(500);
  await page.keyboard.up('d');
  const info = await page.evaluate(() => ({
    touch: window.__pad.enabled,
    moved: +window.__game.player.x.toFixed(2) !== 4.9,
    stage: (() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    })(),
  }));
  await page.screenshot({ path: OUT + 'P-桌面键鼠.png' });
  console.log('桌面键鼠  :', JSON.stringify(info), errs.length ? 'ERR:' + errs.join(';') : '无报错');
  await page.close();
}

await browser.close();
