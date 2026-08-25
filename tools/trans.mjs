// 验证换区域的淡入淡出是否真的画到屏幕上（采样画面平均亮度）
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(400);
await page.evaluate(() => {
  window.__skipIntro();
  window.__goto('stair', 'fromCorr2');
});
await wait(1200);

const lum = () =>
  page.evaluate(() => {
    const c = document.getElementById('game');
    const g = c.getContext('2d');
    const d = g.getImageData(180, 120, 280, 160).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return +(s / (d.length / 4) / 3).toFixed(1);
  });

const before = await lum();
await page.evaluate(() => {
  window.__game.player.x = 2.1;
  window.__game.player.y = 1.6;
});
await wait(300);
await page.keyboard.press('e');
await wait(150); // 淡出中途
const mid = await lum();
const trans = await page.evaluate(() => !!window.__game.trans);
await wait(900); // 过渡结束
const after = await lum();
console.log('过渡前亮度:', before, ' 过渡中:', mid, ' 过渡后:', after);
console.log('过渡中处于 trans 状态:', trans);
console.log(mid < before * 0.7 ? '淡出可见（生效）' : '← 没看到变暗，可能没生效');
console.log('已切到:', await page.evaluate(() => window.__area().id));
await browser.close();
