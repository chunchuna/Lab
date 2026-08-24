// 用 CPU 降速模拟中低端手机，并对比 DOM UI 是否构成性能瓶颈
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
const cdp = await page.createCDPSession();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(500);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 422, y: 120, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(4300);
await page.evaluate(() => {
  window.__inv.addItem('flashlight');
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 2);
  window.__inv.quickEquip('flashlight');
  window.__inv.quickEquip('pistol');
});
await wait(300);

const measure = async () => {
  await wait(250);
  return page.evaluate(async () => {
    const t0 = performance.now();
    let f = 0;
    await new Promise((res) => {
      const loop = () => {
        f++;
        if (performance.now() - t0 > 2000) res();
        else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    return +(f / ((performance.now() - t0) / 1000)).toFixed(1);
  });
};
const renderMs = async () => {
  await wait(150);
  return page.evaluate(() => {
    const N = 60;
    window.__render();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) window.__render();
    return +((performance.now() - t0) / N).toFixed(2);
  });
};

const rows = [];
for (const rate of [1, 4, 6, 10, 16]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const fps = await measure();
  const rms = await renderMs();
  rows.push({ rate, fps, rms, hud: 'DOM UI 开' });
}

// 隐藏整个 DOM UI，隔离出它的成本
await page.evaluate(() => (document.getElementById('hud').style.display = 'none'));
for (const rate of [6, 10, 16]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const fps = await measure();
  const rms = await renderMs();
  rows.push({ rate, fps, rms, hud: 'DOM UI 关' });
}

await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
console.log('CPU 降速   FPS    render()耗时   DOM UI');
for (const r of rows) {
  console.log(
    '  ' + (r.rate + 'x').padEnd(8) + String(r.fps).padEnd(7) + (r.rms + ' ms').padEnd(15) + r.hud,
  );
}
await browser.close();
