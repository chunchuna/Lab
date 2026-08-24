// 诊断触屏按钮的命中情况：位置、是否被别的元素盖住、按下后状态
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
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://localhost:5173/?touch=1', { waitUntil: 'networkidle0' });
const cdp = await page.createCDPSession();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(600);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 422, y: 120, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(4300);

await page.evaluate(() => {
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 2);
  window.__inv.quickEquip('pistol');
});
await wait(300);

const info = await page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const out = { stage: { x: st.x, y: st.y, w: st.width, h: st.height }, fontSize: getComputedStyle(document.getElementById('stage')).fontSize, btns: [] };
  for (const b of document.querySelectorAll('#pad [data-act], #pad .stick')) {
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    out.btns.push({
      id: b.dataset.act || b.id,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      hidden: b.classList.contains('hidden'),
      offscreen: r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight,
      topEl: top ? (top.dataset && top.dataset.act ? 'act:' + top.dataset.act : top.id || top.className || top.tagName) : 'none',
    });
  }
  return out;
});
console.log('stage:', JSON.stringify(info.stage), 'font:', info.fontSize);
for (const b of info.btns) console.log(' ', JSON.stringify(b));

// 两两重叠检测：触屏按钮互相压住是最常见的手感问题
const vis = info.btns.filter((b) => !b.hidden && b.w > 0);
const overlaps = [];
for (let i = 0; i < vis.length; i++) {
  for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i];
    const b = vis[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 0 && oy > 0) overlaps.push(`${a.id}×${b.id} (${ox}×${oy}px)`);
  }
}
console.log('重叠:', overlaps.length ? overlaps.join(', ') : '无');
const tooSmall = vis.filter((b) => Math.min(b.w, b.h) < 44).map((b) => `${b.id}=${b.w}x${b.h}`);
console.log('小于 44px 的触控目标:', tooSmall.length ? tooSmall.join(', ') : '无');

// 按住开枪键 400ms，看 pad.firing 与 mag
const fb = info.btns.find((b) => b.id === 'fire');
const fx = fb.x + fb.w / 2;
const fy = fb.y + fb.h / 2;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy, id: 1 }] });
await wait(120);
const mid = await page.evaluate(() => ({ firing: window.__pad ? window.__pad.firing : 'n/a', mag: window.__game.gun.mag }));
await wait(300);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(200);
const after = await page.evaluate(() => ({ mag: window.__game.gun.mag, right: window.__inv.inv.right && window.__inv.inv.right.id }));
console.log('按下中:', JSON.stringify(mid));
console.log('松手后:', JSON.stringify(after));
await browser.close();
