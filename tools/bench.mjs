// 直接测量单帧渲染耗时（rAF 会被 60fps 限帧，看 FPS 测不出余量）
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/?touch=1', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(500);
await page.evaluate(() => document.dispatchEvent(new Event('x')));
await page.keyboard.press('Space');
await wait(4300);
await page.evaluate(() => {
  window.__inv.addItem('flashlight');
  window.__inv.addItem('pistol');
  window.__inv.quickEquip('flashlight');
  window.__inv.quickEquip('pistol');
});
await wait(300);

const bench = (label, setup) =>
  page.evaluate(
    (s) => {
      if (s) new Function(s)();
      const N = 160;
      window.__render();
      const t0 = performance.now();
      for (let i = 0; i < N; i++) window.__render();
      return +((performance.now() - t0) / N).toFixed(2);
    },
    setup || '',
  );

const noBake = await bench('no-bake', 'window.__game.noBake=true; window.__game.losOcclusion=false; window.__inv.inv.flashOn=true');
const off = await bench('los-off', 'window.__game.noBake=false; window.__game.losOcclusion=false');
const on = await bench('los-on', 'window.__game.losOcclusion=true');
const noFlash = await bench('no-flash', 'window.__game.losOcclusion=false; window.__inv.inv.flashOn=false');

console.log('渲染单帧耗时（ms，越小越好）');
console.log('  烘焙前（每帧重算静态光）:', noBake);
console.log('  烘焙后 · 视线遮挡关     :', off);
console.log('  烘焙后 · 视线遮挡开     :', on);
console.log('  烘焙后 · 手电关         :', noFlash);
console.log('  提速                    :', (noBake / off).toFixed(1) + 'x');
console.log('  16.7ms = 60fps 预算');
await browser.close();
