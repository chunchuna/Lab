// 验证：复活后画面不黑、准星形态一致、上楼过程中玩家不被台阶挡住
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lum = () =>
  page.evaluate(() => {
    const g = document.getElementById('game').getContext('2d');
    const d = g.getImageData(160, 100, 320, 180).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return +(s / (d.length / 4) / 3).toFixed(1);
  });

await wait(400);
await page.evaluate(() => window.__skipIntro());
await wait(300);

/* ---- 1. 复活后画面是否还黑 ---- */
await page.evaluate(() => window.__goto('stair', 'fromCorr2'));
await wait(1300);
const normal = await lum();
await page.evaluate(() => { window.__game.player.hp = 1; window.__game.state = 'dead'; window.__game.phase = 0; });
await wait(4200); // 死亡 3.6s 后复活
const afterRespawn = await lum();
await wait(900); // 淡入结束
const settled = await lum();
console.log('正常亮度:', normal, ' 复活瞬间:', afterRespawn, ' 淡入后:', settled);
console.log('复活后画面正常:', settled > normal * 0.6 ? '是' : '否 ← 还是黑的');
console.log('fade 残留值:', await page.evaluate(() => window.__game.fade));
await page.screenshot({ path: OUT + 'R-respawn.png' });

/* ---- 2. 准星形态一致性 ---- */
const curHTML = () => page.evaluate(() => document.getElementById('cursor-g').innerHTML);
const unarmed = await curHTML();
await page.evaluate(() => {
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 5);
  window.__inv.quickEquip('pistol');
});
await wait(500);
const armed = await curHTML();
const nLines = (s) => (s.match(/<line/g) || []).length;
const nRects = (s) => (s.match(/<rect/g) || []).length;
console.log('\n无枪：', nLines(unarmed), '段线 +', nRects(unarmed), '个中心点');
console.log('有枪：', nLines(armed), '段线 +', nRects(armed), '个中心点');
console.log('形态一致:', nLines(unarmed) === 4 && nLines(armed) === 4 && nRects(unarmed) === nRects(armed) ? '是' : '否');
const worldRet = await page.evaluate(() => {
  // 键鼠下不应再画画面内准星
  return window.__pad.enabled;
});
console.log('触屏模式:', worldRet, '（键鼠下不画画面内准星）');

/* ---- 3. 上楼时玩家是否被台阶挡住 ---- */
await page.evaluate(() => { window.__game.player.x = 6.9; window.__game.player.y = 3.5; });
await wait(300);
const frames = [];
await page.keyboard.down('w');
await page.keyboard.down('d');
for (let i = 0; i < 6; i++) {
  await wait(230);
  const st = await page.evaluate(() => ({
    y: +window.__game.player.y.toFixed(2),
    z: +(window.__game.player.z || 0).toFixed(2),
    area: window.__area().id,
  }));
  frames.push(st);
  if (st.area !== 'stair') break;
  // 以玩家为中心截图，否则很容易截错地方
  const durl = await page.evaluate(() => {
    const a = window.__area();
    const p = window.__game.player;
    const cx = a.cam.x + (p.x - p.y) * 18;
    const cy = a.cam.y + (p.x + p.y) * 9 - (p.z || 0) * 18;
    const w = 110, h = 88;
    const src = document.getElementById('game');
    const o = document.createElement('canvas');
    o.width = w * 5; o.height = h * 5;
    const g = o.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, Math.round(cx - w / 2), Math.round(cy - h * 0.62), w, h, 0, 0, o.width, o.height);
    return o.toDataURL();
  });
  fs.writeFileSync(OUT + `R-stair-${i}.png`, Buffer.from(durl.split(',')[1], 'base64'));
}
await page.keyboard.up('w');
await page.keyboard.up('d');
console.log('\n上楼过程:', frames.map((f) => `y${f.y}/z${f.z}`).join(' '));
console.log('最终区域:', frames[frames.length - 1].area);
console.log(errs.length ? 'ERR: ' + errs.join(';') : '无报错');
await browser.close();
