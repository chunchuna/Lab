const EPS = 0.00035;

function castRay(ox, oy, dx, dy, segments, maxDist) {
  let best = maxDist;
  let bseg = null;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const ex = s.x2 - s.x1;
    const ey = s.y2 - s.y1;
    const det = ex * dy - dx * ey;
    if (det > -1e-9 && det < 1e-9) continue;
    const wx = s.x1 - ox;
    const wy = s.y1 - oy;
    const t = (-wx * ey + ex * wy) / det;
    if (t <= 1e-6 || t >= best) continue;
    const u = (dx * wy - wx * dy) / det;
    if (u < 0 || u > 1) continue;
    best = t;
    bseg = s;
  }
  return { t: best, seg: bseg };
}

/** 360° 可见多边形。返回按角度排序的命中点数组 */
export function computeVisibility(ox, oy, segments, maxDist = 48) {
  const angles = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    let a = Math.atan2(s.y1 - oy, s.x1 - ox);
    angles.push(a - EPS, a, a + EPS);
    a = Math.atan2(s.y2 - oy, s.x2 - ox);
    angles.push(a - EPS, a, a + EPS);
  }
  angles.sort((p, q) => p - q);
  const hits = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const r = castRay(ox, oy, dx, dy, segments, maxDist);
    hits.push({ x: ox + dx * r.t, y: oy + dy * r.t, seg: r.seg });
  }
  return hits;
}

const angDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** 锥形可见多边形（手电筒）。返回 { origin, hits } */
export function computeVisibilityCone(ox, oy, segments, center, half, maxDist = 48) {
  const rel = [-half + 1e-4, half - 1e-4];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    let a = Math.atan2(s.y1 - oy, s.x1 - ox);
    let d = angDiff(a, center);
    if (Math.abs(d) < half) rel.push(d - EPS, d, d + EPS);
    a = Math.atan2(s.y2 - oy, s.x2 - ox);
    d = angDiff(a, center);
    if (Math.abs(d) < half) rel.push(d - EPS, d, d + EPS);
  }
  // 补充若干均匀采样，保证远处圆弧平滑
  const N = 16;
  for (let i = 0; i <= N; i++) rel.push(-half + (i / N) * half * 2);
  rel.sort((p, q) => p - q);

  const hits = [];
  for (let i = 0; i < rel.length; i++) {
    const d = rel[i];
    if (d < -half || d > half) continue;
    const a = center + d;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const r = castRay(ox, oy, dx, dy, segments, maxDist);
    hits.push({ x: ox + dx * r.t, y: oy + dy * r.t, seg: r.seg });
  }
  return { origin: { x: ox, y: oy }, hits };
}

/** 射线与场景求交（子弹） */
export function raycast(ox, oy, dx, dy, segments, maxDist = 48) {
  const r = castRay(ox, oy, dx, dy, segments, maxDist);
  return { x: ox + dx * r.t, y: oy + dy * r.t, dist: r.t, seg: r.seg };
}

/** 两点之间是否通视 */
export function lineOfSight(ax, ay, bx, by, segments) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const r = castRay(ax, ay, dx / len, dy / len, segments, len);
  return r.seg === null;
}
