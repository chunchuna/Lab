/**
 * 本地记录与设置。
 *
 * 只用 localStorage：这游戏发行在 itch.io 的 iframe 里，没有后端，也不该
 * 依赖顶层窗口。读写全部包一层 try —— 隐私模式下 localStorage 会直接抛错，
 * 抛出来会把主菜单一起带崩。
 */

const SAVE_KEY = 'lab7.save.v1';
const SETTINGS_KEY = 'lab7.settings.v1';

function read(key) {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------- 进度记录 ---------------- */

/**
 * 记录只在"安全点"写：换区域的那一刻。序章是线性的，区域 + 几个剧情开关
 * 就足以还原，不需要把整个 game 对象序列化。
 */
export function writeSave(data) {
  return write(SAVE_KEY, { v: 1, time: Date.now(), ...data });
}

export function readSave() {
  const s = read(SAVE_KEY);
  if (!s || s.v !== 1 || !s.area) return null;
  return s;
}

export function hasSave() {
  return !!readSave();
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* 忽略 */
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 菜单上那行小字：「312 宿舍 · 08-26 14:03」 */
export function saveLabel(s) {
  if (!s) return '';
  const d = new Date(s.time || Date.now());
  const when = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${s.areaName || '未知位置'} · ${when}`;
}

/* ---------------- 设置 ---------------- */

export const DEFAULT_SETTINGS = {
  volume: 0.55, // 主音量 0..1
  los: false, // 真实视线遮挡（V 键同款开关）
};

export function readSettings() {
  const s = read(SETTINGS_KEY);
  if (!s) return { ...DEFAULT_SETTINGS };
  return {
    volume: typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : DEFAULT_SETTINGS.volume,
    los: !!s.los,
  };
}

export function writeSettings(s) {
  return write(SETTINGS_KEY, { volume: s.volume, los: !!s.los });
}
