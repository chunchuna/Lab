// 单独验证：子弹能不能打中丧尸、能不能打死、丧尸能不能咬到玩家
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

await wait(400);
await page.evaluate(() => {
  window.__skipIntro();
  window.__inv.addItem('pistol');
  window.__inv.addItem('mag', 20);
  window.__inv.quickEquip('pistol');
  window.__goto('corr2', 'fromLab');
});
await wait(700);

// 手动放一只丧尸在玩家正右方（世界 +x），并锁住弹药
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 10;
  g.player.y = 2.5;
  window.__horde.clear();
  window.__horde.spawnOne(13, 2.5);
  window.__horde.list[0].hp = 3;
  window.__horde.list[0].spd = 0; // 站着不动，便于测试命中
  g.gun.mag = 6;
});
await wait(200);

async function aimAt(x, y) {
  const c = await page.evaluate((w) => {
    const a = window.__area();
    const s = document.getElementById('stage').getBoundingClientRect();
    const sc = s.width / 640;
    return { x: s.x + (a.cam.x + (w.x - w.y) * 18) * sc, y: s.y + (a.cam.y + (w.x + w.y) * 9) * sc };
  }, { x, y });
  await page.mouse.move(c.x, c.y);
}
const zst = () => page.evaluate(() => {
  const z = window.__horde.list[0];
  return z ? { hp: z.hp, dead: z.dead > 0, hurt: +z.hurt.toFixed(2) } : null;
});

await aimAt(13, 2.5);
await wait(200);
console.log('开枪前     ', JSON.stringify(await zst()));
for (let i = 1; i <= 3; i++) {
  await page.evaluate(() => { window.__game.gun.mag = 6; window.__game.gun.cool = 0; });
  await page.mouse.down(); await wait(140); await page.mouse.up();
  await wait(350);
  console.log('第 ' + i + ' 枚命中后', JSON.stringify(await zst()));
}
await page.screenshot({ path: OUT + 'Z-hit.png' });

// 咬人：把一只丧尸贴到玩家身上
await page.evaluate(() => {
  window.__horde.clear();
  window.__horde.spawnOne(10.4, 2.5);
  window.__game.player.invuln = 0;
});
const hp0 = await page.evaluate(() => window.__game.player.hp);
await wait(2600);
const hp1 = await page.evaluate(() => window.__game.player.hp);
console.log('被咬：hp', hp0, '->', hp1, hp1 < hp0 ? '（会掉血）' : '← 没掉血，有问题');
await page.screenshot({ path: OUT + 'Z-bite.png' });
console.log(errs.length ? 'ERR: ' + errs.join(';') : '无报错');
await browser.close();
