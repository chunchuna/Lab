// 走一遍新流程：打门 -> 二层走廊 -> 丧尸 -> 楼梯间 -> 三层 -> 对讲机 -> 一层剧情杀
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
page.on('pageerror', (e) => errs.push(e.message + '\n' + (e.stack || '')));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: OUT + 'G-' + n + '.png' });
const st = () =>
  page.evaluate(() => ({
    area: window.__area().id,
    state: window.__game.state,
    hp: window.__game.player.hp,
    door: window.__game.door.hits + (window.__game.door.broken ? '/破' : ''),
    zombies: window.__horde.list.filter((z) => !z.dead).length,
    dead: window.__horde.list.filter((z) => z.dead).length,
    mag: window.__game.gun.mag,
    radio: window.__game.radioStep,
  }));
const at = (x, y) => page.evaluate((p) => { window.__game.player.x = p.x; window.__game.player.y = p.y; }, { x, y });
async function aimAt(x, y) {
  const c = await page.evaluate((w) => {
    const a = window.__area();
    const st2 = document.getElementById('stage').getBoundingClientRect();
    const sc = st2.width / 640;
    return { x: st2.x + (a.cam.x + (w.x - w.y) * 18) * sc, y: st2.y + (a.cam.y + (w.x + w.y) * 9) * sc };
  }, { x, y });
  await page.mouse.move(c.x, c.y);
}
const press = async (k) => { await page.keyboard.press(k); await wait(240); };

await wait(400);
await page.evaluate(() => window.__skipIntro());
await page.evaluate(() => {
  window.__inv.addItem('flashlight');
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 6);
  window.__inv.quickEquip('flashlight');
  window.__inv.quickEquip('pistol');
});
await wait(300);
console.log('开局            ', JSON.stringify(await st()));

/* 1. 没试过门禁时打门：应该只给提示，不计数 */
await at(10.5, 1.3);
await aimAt(10.5, -1);
await wait(200);
await page.mouse.down(); await wait(120); await page.mouse.up();
await wait(400);
console.log('未识别就打门    ', JSON.stringify(await st()), '← hits 应为 0');

/* 2. 用门禁 -> 报错 */
await press('e');
await wait(9200);
console.log('门禁识别失败后  ', JSON.stringify(await st()));

/* 3. 打三枪 */
for (let i = 0; i < 3; i++) {
  await at(10.5, 1.3);
  await aimAt(10.5, -1);
  await page.mouse.down(); await wait(130); await page.mouse.up();
  await wait(600);
  console.log('  第 ' + (i + 1) + ' 枪        ', JSON.stringify(await st()));
}
await shot('01-door-broken');

/* 4. 出门到走廊 */
await at(10.5, 1.3);
await press('e');
await wait(1400);
console.log('出门后          ', JSON.stringify(await st()));
await shot('02-corr2');

/* 5. 等丧尸涌出 */
await wait(11000);
const s5 = await st();
console.log('等 11 秒后      ', JSON.stringify(s5), '← 应有丧尸');
await shot('03-horde');

/* 6. 打丧尸 */
const zpos = await page.evaluate(() => {
  const z = window.__horde.list.find((q) => !q.dead);
  return z ? { x: z.x, y: z.y } : null;
});
if (zpos) {
  await aimAt(zpos.x, zpos.y);
  for (let i = 0; i < 4; i++) {
    await page.mouse.down(); await wait(120); await page.mouse.up(); await wait(280);
  }
}
console.log('对丧尸开 4 枪后 ', JSON.stringify(await st()), '← dead 应 > 0');
await shot('04-shooting');

/* 7. 退到楼梯间 */
await at(1.2, 2.4);
await wait(300);
await press('e');
await wait(1400);
console.log('进楼梯间        ', JSON.stringify(await st()));
await shot('05-stair');

/* 8. 上三层 */
await at(6.6, 1.3);
await wait(300);
await press('e');
await wait(1400);
console.log('上三层          ', JSON.stringify(await st()));
await shot('06-corr3');

/* 9. 进 312 + 对讲机 */
await at(13.4, 1.1);
await wait(300);
await press('e');
await wait(1400);
console.log('进 312          ', JSON.stringify(await st()));
await shot('07-dorm312');
await at(3.4, 3.0);
await wait(300);
await press('e');
await wait(4000);
console.log('对讲机播报中    ', JSON.stringify(await st()), '← radio 应递增');
await shot('08-radio');

/* 10. 下一层，等剧情杀 */
await page.evaluate(() => window.__goto('stair', 'fromCorr3'));
await wait(600);
await page.evaluate(() => window.__goto('corr1', 'fromStair'));
await wait(600);
await shot('09-corr1');
await wait(8500);
console.log('一层等 8.5 秒后 ', JSON.stringify(await st()), '← 应已死亡或已重生');
await shot('10-after-death');
await wait(3000);
console.log('重生后          ', JSON.stringify(await st()), '← 应回到 stair');

const fps = await page.evaluate(async () => {
  const t0 = performance.now();
  let f = 0;
  await new Promise((res) => {
    const loop = () => { f++; if (performance.now() - t0 > 2000) res(); else requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  return (f / ((performance.now() - t0) / 1000)).toFixed(1);
});
console.log('\nFPS:', fps);
console.log(errs.length ? 'ERR:\n' + errs.join('\n---\n') : '无报错');
await browser.close();
