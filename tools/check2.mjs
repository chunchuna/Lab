// 验证本轮改动：楼梯可走上去、走到顶自动换层、一层被围才死、丧尸朝向与速度
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = async (k, ms) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); };

/* ---- 1. 起床动画：整段位置/旋转是否连续，比例是否恒定 ---- */
await wait(400);
await page.keyboard.press('Space');
const frames = [];
for (let i = 0; i < 12; i++) {
  await wait(320);
  frames.push(await page.evaluate(() => {
    const g = window.__game;
    return { t: +g.phase.toFixed(2), st: g.state };
  }));
}
console.log('起床阶段采样:', frames.map((f) => f.t + '/' + f.st).join(' '));
await page.screenshot({ path: OUT + 'W-after-wake.png' });

/* ---- 2. 楼梯：能不能走上去 ---- */
await page.evaluate(() => { window.__goto('stair', 'fromCorr2'); });
await wait(1200);
const z0 = await page.evaluate(() => ({ x: +window.__game.player.x.toFixed(2), y: +window.__game.player.y.toFixed(2), z: +(window.__game.player.z || 0).toFixed(2) }));
// 站到上行梯段脚下，往 -y（屏幕左上）走
await page.evaluate(() => { window.__game.player.x = 6.9; window.__game.player.y = 3.6; });
await wait(200);
const zA = await page.evaluate(() => +(window.__game.player.z || 0).toFixed(2));
// 纯 -y 方向 = W + D（W 是 (-1,-1)，D 是 (+1,-1)）
await page.keyboard.down('w');
await page.keyboard.down('d');
await wait(300);
const zB = await page.evaluate(() => ({ y: +window.__game.player.y.toFixed(2), z: +(window.__game.player.z || 0).toFixed(2) }));
console.log('楼梯脚下 z=', zA, ' 往上走后=', JSON.stringify(zB), zB.z > zA ? '（抬升了，能走上去）' : '← 没抬升');
await page.screenshot({ path: OUT + 'W-on-stairs.png' });
await wait(900);
await page.keyboard.up('w');
await page.keyboard.up('d');
await wait(1400);
const top = await page.evaluate(() => window.__area().id);
console.log('走到梯顶后所在区域:', top, top === 'corr3' ? '（自动换层成功）' : '← 没换层');

/* ---- 3. 一层：丧尸翻越障碍并围死玩家 ---- */
await page.evaluate(() => { window.__goto('corr1', 'fromStair'); });
await wait(1200);
const t0 = Date.now();
let sawClimb = false;
let swarmMax = 0;
let deadAt = null;
while (Date.now() - t0 < 16000) {
  await wait(400);
  const s = await page.evaluate(() => {
    const g = window.__game;
    const zs = window.__horde.list.filter((z) => !z.dead);
    return {
      st: g.state,
      n: zs.length,
      onTop: zs.filter((z) => (z.z || 0) > 0.2).length,
      swarm: g.swarm || 0,
      near: window.__horde.crowdedAt(g.player.x, g.player.y, 1.15),
    };
  });
  if (s.onTop > 0) sawClimb = true;
  swarmMax = Math.max(swarmMax, s.near);
  if (s.st === 'dead' && !deadAt) {
    deadAt = ((Date.now() - t0) / 1000).toFixed(1);
    await wait(650); // 等尸潮压上来再截，黑幕是 1.2 秒后才开始
    await page.screenshot({ path: OUT + 'W-swarm.png' });
  }
  if (s.st === 'play' && deadAt) break;
}
console.log('一层：见到翻越障碍(抬高)的丧尸:', sawClimb ? '是' : '否');
console.log('一层：玩家周围最多聚集', swarmMax, '只；死亡发生在第', deadAt, '秒');
console.log('重生后区域:', await page.evaluate(() => window.__area().id));

/* ---- 4. 丧尸朝向与速度 ---- */
await page.evaluate(() => {
  window.__goto('corr2', 'fromLab');
});
await wait(1200);
const facing = await page.evaluate(async () => {
  const g = window.__game;
  g.player.x = 8; g.player.y = 2.5;
  window.__horde.clear();
  window.__horde.spawnOne(14, 2.5);   // 在玩家右边 -> 应朝左走，脸朝左
  window.__horde.spawnOne(8, 0.8);    // 在玩家上方 -> 应朝下走
  await new Promise((r) => setTimeout(r, 600));
  return window.__horde.list.map((z) => ({
    pos: `${z.x.toFixed(1)},${z.y.toFixed(1)}`,
    faceX: +z.face.x.toFixed(2),
    faceY: +z.face.y.toFixed(2),
    spd: +z.spd.toFixed(2),
  }));
});
console.log('丧尸朝向/速度:', JSON.stringify(facing));
console.log(errs.length ? 'ERR: ' + errs.join(';') : '无报错');
await browser.close();
