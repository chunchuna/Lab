// 诊断：1) 准星指向丧尸身体时，实际瞄准角偏了多少 2) 楼梯间出生点是否卡在碰撞体里
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
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
await wait(800);

/* ---- 1. 瞄准偏移 ---- */
console.log('=== 瞄准偏移 ===');
await page.evaluate(() => {
  window.__game.player.x = 8;
  window.__game.player.y = 2.5;
  window.__horde.clear();
  window.__horde.spawnOne(13, 2.5);
  window.__horde.list[0].spd = 0;
});
await wait(200);

for (const [label, dy] of [['指向脚底', 0], ['指向躯干(上移15px)', -15], ['指向头部(上移26px)', -26]]) {
  const c = await page.evaluate((d) => {
    const a = window.__area();
    const z = window.__horde.list[0];
    const s = document.getElementById('stage').getBoundingClientRect();
    const sc = s.width / 640;
    const gx = a.cam.x + (z.x - z.y) * 18;
    const gy = a.cam.y + (z.x + z.y) * 9 + d;
    return { cx: s.x + gx * sc, cy: s.y + gy * sc };
  }, dy);
  await page.mouse.move(c.cx, c.cy);
  await wait(120);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const z = window.__horde.list[0];
    const trueAng = Math.atan2(z.y - g.player.y, z.x - g.player.x);
    // 沿当前瞄准角射出，看落点离丧尸多远
    const dx = Math.cos(g.player.aim), dy2 = Math.sin(g.player.aim);
    const ex = z.x - g.player.x, ey = z.y - g.player.y;
    const t = ex * dx + ey * dy2;
    const perp = Math.abs(ex * dy2 - ey * dx);
    return {
      瞄准角: +g.player.aim.toFixed(3),
      正确角: +trueAng.toFixed(3),
      偏差弧度: +(g.player.aim - trueAng).toFixed(3),
      横向偏离格数: +perp.toFixed(2),
      命中阈值: 0.36,
    };
  });
  console.log(' ', label.padEnd(20), JSON.stringify(r));
}

/* ---- 2. 楼梯间出生点 ---- */
console.log('\n=== 楼梯间出生点是否卡住 ===');
const stuck = await page.evaluate(() => {
  window.__goto('stair', 'fromCorr2');
  const a = window.__area();
  const out = { colliders: a.colliders.map((c) => `${c.id}[${c.x0.toFixed(1)},${c.y0.toFixed(1)}]-[${c.x1.toFixed(1)},${c.y1.toFixed(1)}]`), spawns: {} };
  const r = 0.3;
  for (const [name, sp] of Object.entries(a.spawns)) {
    const hits = a.colliders.filter((c) => sp.x + r > c.x0 && sp.x - r < c.x1 && sp.y + r > c.y0 && sp.y - r < c.y1);
    out.spawns[name] = { pos: `${sp.x},${sp.y}`, 卡在: hits.map((h) => h.id) };
  }
  // 各 link 能否从可走区域到达
  out.links = a.links.map((l) => {
    let reachable = false;
    for (let x = 0.4; x < a.w; x += 0.25) {
      for (let y = 0.4; y < a.h; y += 0.25) {
        const bad = a.colliders.some((c) => x + r > c.x0 && x - r < c.x1 && y + r > c.y0 && y - r < c.y1);
        if (bad) continue;
        if (Math.hypot(x - l.x, y - l.y) <= l.r) { reachable = true; break; }
      }
      if (reachable) break;
    }
    return { to: l.to, 可达: reachable };
  });
  return out;
});
console.log('  碰撞体:', stuck.colliders.join('  '));
for (const [k, v] of Object.entries(stuck.spawns)) {
  console.log('  出生点', k.padEnd(12), v.pos.padEnd(10), v.卡在.length ? '卡在 ' + v.卡在.join(',') : 'OK');
}
for (const l of stuck.links) console.log('  通道 ->', l.to.padEnd(8), l.可达 ? '可达' : '不可达 ← 问题');
await browser.close();
