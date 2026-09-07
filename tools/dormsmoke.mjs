/**
 * 冒烟：宿舍帐篷这一整条链路（v2.2.0）。
 *
 * 只做"能不能跑通 + 有没有报错 + 有没有摆穿模"这三件事，
 * 手感与画面好不好看由用户自己看（见 .cursor/rules/lab7.mdc 的分工）。
 *
 *   node tools/dormsmoke.mjs          跑全部检查，截图进 shots/
 *   node tools/dormsmoke.mjs geom     只跑几何自检（快）
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { CHROME } from './chrome.mjs';

const OUT = 'shots/';
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[2] || '';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}dorm-${name}.png` });
  console.log('  shot', name);
};
let bad = 0;
const check = (ok, label, extra) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) bad++;
};

// ?touch=0 强制键鼠：headless 会被当成粗指针设备，摇杆层会盖住半个截图
await page.goto('http://localhost:5173/?touch=0', { waitUntil: 'load' });
await wait(900);

/* ---------------- 1. 几何自检：谁跟谁摆重叠了 ---------------- */
console.log('\n[几何] 营地碰撞盒 / NPC 站位');
await page.evaluate(() => window.__toCamp());
await wait(1500);

const geom = await page.evaluate(() => {
  const a = window.__area();
  const cols = a.colliders;
  /* 有几类重叠是设计如此，不算问题：
     围栏段首尾相接、沙袋压着围栏；打饭棚下面就是灶和桶；水塔跟灯杆共杆。
     NPC 那边同理 —— 长凳、行军床、饭桌、洗衣池、犬舍这些本来就是
     "人趴在上面 / 站在跟前"用的，只有站进帐篷、塔、机房才算摆错了。 */
  const fence = (id) => /^fx\d+$/.test(id) || /Bags\d*$/.test(id);
  const okPair = (p, q) => {
    const s = [p, q].sort().join('|');
    return [
      'lamp1|wtower', 'cookfire|mess', 'cookfire|messBarrel',
    ].includes(s);
  };
  const seat = (id) => /^(bench|cot|kennel|mtable|mess|wash|latrine|shower|well|tank)/.test(id);
  const overlaps = [];
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const p = cols[i];
      const q = cols[j];
      if (fence(p.id) && fence(q.id)) continue;
      if (okPair(p.id, q.id)) continue;
      const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
      const oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
      if (ox > 0.02 && oy > 0.02) overlaps.push(`${p.id} × ${q.id} (${ox.toFixed(2)}×${oy.toFixed(2)})`);
    }
  }
  const inside = [];
  for (const n of a.npcList || []) {
    for (const c of cols) {
      if (seat(c.id)) continue;
      if (n.x > c.x0 && n.x < c.x1 && n.y > c.y0 && n.y < c.y1) {
        inside.push(`${n.kind}@${n.x.toFixed(1)},${n.y.toFixed(1)} 在 ${c.id} 里`);
        break;
      }
    }
  }
  // 每顶帐篷门口的进门点必须站得住人
  const g = window.__game;
  const blocked = [];
  for (const lk of a.links) {
    if (!lk.dorm) continue;
    const hit = cols.some((c) => lk.x + 0.3 > c.x0 && lk.x - 0.3 < c.x1 && lk.y + 0.3 > c.y0 && lk.y - 0.3 < c.y1);
    if (hit) blocked.push(lk.dorm);
  }
  return {
    props: a.props.length,
    cols: cols.length,
    npcs: (a.npcList || []).length,
    dormLinks: a.links.filter((l) => l.dorm).length,
    plates: a.props.filter((pp) => pp.plate).length,
    overlaps,
    inside,
    blocked,
    home: g.homeTent,
  };
});
console.log(`  道具 ${geom.props} / 碰撞盒 ${geom.cols} / NPC ${geom.npcs} / 帐篷入口 ${geom.dormLinks}`);
check(geom.overlaps.length === 0, '道具碰撞盒互不重叠', geom.overlaps.slice(0, 8).join(' | '));
check(geom.inside.length === 0, 'NPC 没有站在碰撞盒里', geom.inside.slice(0, 8).join(' | '));
check(geom.blocked.length === 0, '每顶帐篷门口都进得去', geom.blocked.join(','));
const dormCount = await page.evaluate(async () => (await import('/src/campareas.js')).DORMS.length);
check(geom.dormLinks === dormCount, '每顶宿舍帐篷都有入口', `${geom.dormLinks}/${dormCount}`);
check(geom.plates === dormCount, '每顶宿舍帐篷都有门牌', `${geom.plates}/${dormCount}`);

/* ---------------- 2. 名册：人人有名字有床位 ---------------- */
console.log('\n[名册] 名字与床位');
const roster = await page.evaluate(async () => {
  const R = await import('/src/roster.js');
  const noName = R.PEOPLE.filter((p) => !p.player && !p.name).length;
  const beds = new Set(R.PEOPLE.map((p) => p.tent + p.bunk + p.level));
  const names = new Set(R.PEOPLE.filter((p) => p.name).map((p) => p.name));
  const a = window.__area();
  const outIds = (a.npcList || []).filter((n) => n.person).map((n) => n.person.id);
  const dup = outIds.filter((v, i) => outIds.indexOf(v) !== i);
  return {
    total: R.PEOPLE.length,
    noName,
    uniqBeds: beds.size,
    uniqNames: names.size,
    named: R.PEOPLE.filter((p) => p.name).length,
    dup,
    b3: R.residentsOf('B3').map((p) => `${p.name || '(玩家)'}/${p.bunk}${p.level}/${p.where}/${p.pose || '-'}`),
  };
});
console.log('  ' + roster.b3.join('  '));
check(roster.noName === 0, '每个人都有名字', `无名 ${roster.noName}`);
check(roster.uniqBeds === roster.total, '床位一人一个不重复', `${roster.uniqBeds}/${roster.total}`);
check(roster.uniqNames === roster.named, '名字不重样', `${roster.uniqNames}/${roster.named}`);
check(roster.dup.length === 0, '同一个人没有同时出现在两处', roster.dup.join(','));

if (ONLY === 'geom') {
  console.log('\n控制台：', logs.length ? logs.join('\n') : '(clean)');
  await browser.close();
  process.exit(bad ? 1 : 0);
}

/* ---------------- 3. 营地画面 ---------------- */
console.log('\n[画面] 营地与帐篷排');
const pix = async (label) => page.evaluate(() => {
  // 采样画布中心一小片，判断"是不是整屏黑"
  const c = document.getElementById('game');
  const g = c.getContext('2d');
  const d = g.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 60, 40).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return Math.round(sum / (d.length / 4) / 3);
});
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 21;
  g.player.y = 24;
});
await wait(1200);
check((await pix()) > 20, '营地不是黑屏', 'brightness ' + (await pix()));
await shot('camp-rows');

/* ---------------- 4. 领去认床位的整段过场 ---------------- */
console.log('\n[过场] 士兵领去认床位');
await page.evaluate(() => window.__toHome());
await wait(1000);
const ph = async () => page.evaluate(() => (window.__game.home ? window.__game.home.phase : window.__game.homeDone ? 'done' : 'none'));
check((await ph()) === 'meet', '出登记帐篷就有兵在等', await ph());
await shot('escort-meet');
// 等它自己走完（走全程约 20 秒，留足余量）
for (let i = 0; i < 60; i++) {
  await wait(1000);
  const p = await ph();
  if (p === 'point') await shot('escort-point');
  if (p === 'done') break;
}
const after = await page.evaluate(() => {
  const g = window.__game;
  return { phase: g.home ? g.home.phase : 'done', done: g.homeDone, area: window.__area().id, dorm: window.__area().dormId, state: g.state, tent: g.homeTent };
});
console.log('  ', JSON.stringify(after));
check(after.done === true, '护送走完了', after.phase);
check(after.area === 'campDorm', '人在宿舍帐篷内景里', after.area);
check(after.dorm === 'B3', '进的是自己那顶 B3', String(after.dorm));
check(after.state === 'play', '恢复自由活动', after.state);
await shot('dorm-inside');

/* ---------------- 5. 上下铺互动 ---------------- */
console.log('\n[互动] 爬梯上床 / 下床');
const bunkState = await page.evaluate(async () => {
  const g = window.__game;
  const C = await import('/src/campareas.js');
  const b = C.DORM_IN.bunks.find((q) => q.no === C.PLAYER_BED.bunk);
  g.player.x = b.x;
  g.player.y = b.y + C.DORM_IN.ladder.stand;
  return { x: g.player.x, y: g.player.y };
});
await wait(600);
const prompt = await page.evaluate(() => {
  const el = document.getElementById('prompt');
  return el.classList.contains('hidden') ? '' : document.getElementById('prompt-text').textContent;
});
check(/上/.test(prompt), '梯子脚下能看到上床提示', JSON.stringify(prompt) + ' @' + JSON.stringify(bunkState));
await page.keyboard.press('e');
await wait(700);
check((await page.evaluate(() => (window.__game.bunk || {}).phase)) === 'climb', '正在爬梯', await page.evaluate(() => JSON.stringify(window.__game.bunk)));
await shot('bunk-climb');
await wait(1800);
const lying = await page.evaluate(() => {
  const g = window.__game;
  return { phase: (g.bunk || {}).phase, z: +g.player.z.toFixed(2), rot: +(g.bunk ? g.bunk.rot : 0).toFixed(2) };
});
check(lying.phase === 'lie', '躺到上铺了', JSON.stringify(lying));
check(lying.z > 1.2, '人在上铺高度', 'z=' + lying.z);
await shot('bunk-lie');
await page.keyboard.press('e');
await wait(2200);
const off = await page.evaluate(() => ({ bunk: window.__game.bunk, z: +window.__game.player.z.toFixed(2) }));
check(off.bunk === null, '下床了', JSON.stringify(off));
check(off.z < 0.05, '回到地面', 'z=' + off.z);

/* ---------------- 6. 出帐篷回营地 + HUD 指引 ---------------- */
console.log('\n[指引] 出帐篷回营地');
await page.evaluate(async () => {
  const C = await import('/src/campareas.js');
  const g = window.__game;
  g.player.x = C.DORM_IN.door.x;
  g.player.y = C.DORM_IN.door.y + 0.4;
});
await wait(500);
await page.keyboard.press('e');
await wait(1500);
const back = await page.evaluate(() => {
  const g = window.__game;
  const el = document.getElementById('guide');
  return {
    area: window.__area().id,
    px: +g.player.x.toFixed(1),
    py: +g.player.y.toFixed(1),
    guide: !el.classList.contains('hidden'),
    edge: el.classList.contains('edge'),
    tag: document.getElementById('guide-tag').textContent,
  };
});
console.log('  ', JSON.stringify(back));
check(back.area === 'camp', '回到营地', back.area);
check(back.guide === true, '回家指引出现了', JSON.stringify(back));
check(back.tag === 'B3', '指引指的是自己那顶', back.tag);
check(back.edge === false, '帐篷就在眼前时不画箭头', String(back.edge));
await shot('guide-near');

// 走远：指引应该贴到屏幕边缘变成箭头
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = 52;
  g.player.y = 8;
});
await wait(1400);
const far = await page.evaluate(() => {
  const el = document.getElementById('guide');
  return { shown: !el.classList.contains('hidden'), edge: el.classList.contains('edge'), tr: el.style.transform, a: el.style.getPropertyValue('--a') };
});
console.log('  ', JSON.stringify(far));
check(far.edge === true, '帐篷出屏后指引贴边并带箭头', JSON.stringify(far));
await shot('guide-edge');

/* ---------------- 7. 别人的帐篷也能进 ---------------- */
console.log('\n[其它帐篷] 平民 C5 与军属 M2');
for (const [id, want] of [['C5', 'campDorm'], ['M2', 'campDormMil']]) {
  await page.evaluate((t) => window.__toDorm(t), id);
  await wait(1200);
  const r = await page.evaluate(() => {
    const a = window.__area();
    return { area: a.id, dorm: a.dormId, npcs: (a.npcList || []).length, name: a.name };
  });
  check(r.area === want && r.dorm === id, `${id} 进得去（${r.name}）`, JSON.stringify(r));
  await shot('dorm-' + id);
}

console.log('\n控制台：', logs.length ? logs.join('\n') : '(clean)');
console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
await browser.close();
process.exit(bad ? 1 : 0);
