/**
 * 全营名册（v2.2.0）
 *
 * 营地里每一个人都有名字，也都有自己帐篷里的床位 —— 这份表是唯一真源：
 * 室外那些 NPC（npc.js）、帐篷里的住户、以及玩家自己的铺位，全部从这里取。
 * 同一个人不会既站在净水塔排队又躺在自己床上：住户按帐篷分成"留在帐篷里"
 * 与"在营地各处"两拨，室外名册只从后一拨里领人。
 *
 * 名字目前只存不显示（玩家还不认识任何人）。等到需要显示的时候，
 * 直接读 person.name 即可，不用再补一层映射。
 */

import { DORMS, PLAYER_DORM, PLAYER_BED } from './campareas.js';
import { mulberry32 } from './util.js';
import { HAIR_STYLES, HAIR_COLORS, SKIN_TONES } from './art.js';

const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周', '徐', '孙', '马', '朱', '胡',
  '郭', '何', '高', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '肖', '田', '董', '袁', '潘', '蒋', '蔡', '余', '杜', '叶', '程', '苏', '魏',
  '吕', '丁', '任', '沈', '姚', '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金', '石',
];
/** 单字名与双字名各来一批：营地里什么年纪的人都有 */
const GIVEN_1 = [
  '军', '强', '磊', '敏', '静', '丽', '杰', '涛', '明', '超', '霞', '平', '刚', '芳', '鹏',
  '华', '飞', '文', '峰', '燕', '波', '辉', '婷', '亮', '凯', '玲', '荣', '勇', '艳', '娟',
];
const GIVEN_2 = [
  '建国', '秀英', '志强', '桂英', '国强', '秀兰', '建华', '玉兰', '桂兰', '秀珍', '小红',
  '建军', '立国', '春梅', '秀梅', '宝强', '大勇', '红兵', '卫东', '爱国', '兰英', '树林',
  '有福', '来喜', '招娣', '冬梅', '铁柱', '满仓', '秋菊', '德全', '长顺', '桂香', '三妹',
  '小军', '石头', '翠花', '水生', '金花', '根生', '巧珍',
];

/** 一顶帐篷的四个铺位：1 号床下铺 / 上铺、2 号床下铺 / 上铺 */
const BED_SLOTS = [
  { bunk: 1, level: 'low' },
  { bunk: 1, level: 'high' },
  { bunk: 2, level: 'low' },
  { bunk: 2, level: 'high' },
];

/** 帐篷编号 -> 一个稳定的整数种子：同一顶帐篷每次开局住的人都一样 */
function tentSeed(id) {
  let h = 0x9e37;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function buildRoster() {
  const rand = mulberry32(0x7a1105);
  const used = new Set();
  const pickName = () => {
    for (let tries = 0; tries < 60; tries++) {
      const s = SURNAMES[(rand() * SURNAMES.length) | 0];
      const g = rand() < 0.45
        ? GIVEN_1[(rand() * GIVEN_1.length) | 0]
        : GIVEN_2[(rand() * GIVEN_2.length) | 0];
      const n = s + g;
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    // 名字池撞满了才走到这：补一个序号，保证名册里不出现两个同名的人
    const n = SURNAMES[(rand() * SURNAMES.length) | 0] + GIVEN_1[(rand() * GIVEN_1.length) | 0] + used.size;
    used.add(n);
    return n;
  };
  const lookFor = () => ({
    skin: SKIN_TONES[(rand() * SKIN_TONES.length) | 0],
    hair: HAIR_STYLES[(rand() * HAIR_STYLES.length) | 0],
    hairCol: HAIR_COLORS[(rand() * HAIR_COLORS.length) | 0],
  });

  const all = [];
  const byTent = new Map();
  for (const d of DORMS) {
    const slots = BED_SLOTS.map((s) => {
      const player = d.id === PLAYER_DORM && s.bunk === PLAYER_BED.bunk && s.level === PLAYER_BED.level;
      const p = {
        id: `${d.id}-${s.bunk}${s.level === 'high' ? 'U' : 'D'}`,
        name: player ? '' : pickName(),
        tent: d.id,
        mil: !!d.mil,
        bunk: s.bunk,
        level: s.level,
        player,
        /** 'tent' 待在自己帐篷里；'camp' 在营地某处（室外名册从这拨里领人） */
        where: 'camp',
        /** 在帐篷里时的姿态：sleep / read / sit / squat */
        pose: null,
        look: player ? null : lookFor(),
      };
      all.push(p);
      return p;
    });
    byTent.set(d.id, slots);
  }

  /* 谁留在帐篷里。每顶留一个，玩家那顶留两个 —— 用户点名要的那两位室友：
     一个在自己铺上睡，一个站在柜子边看书。其余的人都在营地各处活动，
     室外名册（npc.js）按顺序领他们，同一个人不会同时出现在两个地方。 */
  for (const d of DORMS) {
    const slots = byTent.get(d.id).filter((p) => !p.player);
    if (d.id === PLAYER_DORM) {
      const sleeper = slots.find((p) => p.bunk === 1 && p.level === 'low') || slots[0];
      sleeper.where = 'tent';
      sleeper.pose = 'sleep';
      const reader = slots.find((p) => p !== sleeper && p.bunk === 2) || slots.find((p) => p !== sleeper);
      reader.where = 'tent';
      reader.pose = 'read';
      continue;
    }
    const r = mulberry32(tentSeed(d.id));
    const stay = slots[(r() * slots.length) | 0];
    stay.where = 'tent';
    // 军属白天多半在岗上，留守的那个通常是刚下夜班在睡觉
    stay.pose = d.mil
      ? (r() < 0.7 ? 'sleep' : 'sit')
      : ['sleep', 'read', 'sit', 'squat'][(r() * 4) | 0];
  }

  return { all, byTent };
}

const ROSTER = buildRoster();

/** 全营名册（含玩家那个占位铺位） */
export const PEOPLE = ROSTER.all;

/** 某顶帐篷的四个铺位（按 1 下、1 上、2 下、2 上 的顺序） */
export function residentsOf(tentId) {
  return ROSTER.byTent.get(tentId) || [];
}

/** 此刻待在这顶帐篷里的住户 */
export function indoorOf(tentId) {
  return residentsOf(tentId).filter((p) => p.where === 'tent');
}

/* 在营地各处活动的人。有固定岗位的那几位先挑出来 —— 登记官、他门口的
   卫兵、带新人去帐篷的那个兵不能再被巡逻名册领走一次。 */
const soldierPool = PEOPLE.filter((p) => p.mil && p.where === 'camp');

/** 有固定戏份的角色，各自也住在军属帐篷里 */
export const STAFF = {
  regOfficer: soldierPool.pop(),
  regGuard: soldierPool.pop(),
  escort: soldierPool.pop(),
};

/** 在营地各处活动的人：室外名册按这个顺序领人 */
export const OUT_REFUGEES = PEOPLE.filter((p) => !p.mil && !p.player && p.where === 'camp');
export const OUT_SOLDIERS = soldierPool;

/** 顺序发牌器：npc.js 建名册时一个个领，领空了就从头再来（不该发生，见冒烟检查） */
export function dealer(pool) {
  let i = 0;
  return () => pool[i++ % pool.length];
}

/** 玩家自己的铺位 */
export const PLAYER_SLOT = { tent: PLAYER_DORM, ...PLAYER_BED };

/** 「2 号床 · 上铺」这种说法，过场台词与互动提示都用它 */
export function bedLabel(bunk, level) {
  return `${bunk} 号床 · ${level === 'high' ? '上铺' : '下铺'}`;
}
