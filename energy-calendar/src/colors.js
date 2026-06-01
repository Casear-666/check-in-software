/**
 * 动态渐变重叠着色系统
 * 根据重叠数量 N，在绿→黄→橙→红色谱上连续插值
 */

// HSL 色阶关键点
const STOPS = [
  { n: 1, h: 120, s: 55, l: 43 },  // 绿色 — 低压力
  { n: 2, h: 48,  s: 80, l: 48 },  // 琥珀色
  { n: 3, h: 28,  s: 85, l: 48 },  // 橙色
  { n: 5, h: 8,   s: 80, l: 44 },  // 深橙
  { n: 8, h: 2,   s: 78, l: 38 },  // 深红 — 高压力
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 色相走最短圆弧 */
function lerpHue(h1, h2, t) {
  let d = h2 - h1;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return ((h1 + d * t) % 360 + 360) % 360;
}

/**
 * @param {number} n — 重叠数 (≥ 1)
 * @returns {{ bg: string, text: string, h: number, s: number, l: number }}
 */
export function colorForOverlap(n) {
  if (n <= 1) {
    const s = STOPS[0];
    return { bg: `hsl(${s.h},${s.s}%,${s.l}%)`, text: '#fff', h: s.h, s: s.s, l: s.l };
  }

  let lower = STOPS[0];
  let upper = STOPS[STOPS.length - 1];

  for (let i = 0; i < STOPS.length - 1; i++) {
    if (n >= STOPS[i].n && n <= STOPS[i + 1].n) {
      lower = STOPS[i];
      upper = STOPS[i + 1];
      break;
    }
  }

  if (n >= upper.n) {
    return { bg: `hsl(${upper.h},${upper.s}%,${upper.l}%)`, text: '#fff', h: upper.h, s: upper.s, l: upper.l };
  }

  const t = (n - lower.n) / (upper.n - lower.n);
  const h = Math.round(lerpHue(lower.h, upper.h, t));
  const s = Math.round(lerp(lower.s, upper.s, t));
  const l = Math.round(lerp(lower.l, upper.l, t));

  // 亮黄色段用深色字
  const textColor = (h > 38 && h < 70 && l > 44) ? '#1a1a1a' : '#fff';

  return { bg: `hsl(${h},${s}%,${l}%)`, text: textColor, h, s, l };
}

/**
 * 生成事件条上的微渐变（同色深浅过渡，提升质感）
 * @param {{ h: number, s: number, l: number }} c — colorForOverlap 的返回值
 * @returns {string} CSS linear-gradient
 */
export function eventGradient(c) {
  const top = `hsl(${c.h},${c.s}%,${c.l}%)`;
  const bottom = `hsl(${c.h},${c.s}%,${Math.max(0, c.l - 8)}%)`;
  return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
}
