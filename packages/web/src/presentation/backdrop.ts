/**
 * 場所ごとの地紋。
 *
 * 全ステージが同じ見た目で、1998年の研究所も1969年の市街も区別が付かない、
 * という指摘への対応。情景を描くものではなく「別の場所に来た」ことが分かる程度の手掛かり。
 *
 * 画像を持たないのは意図的で、権利も容量も増やさずに済み、
 * 自動生成される観測任務にも同じ仕組みがそのまま効く。
 */
import { createRng, seedFrom } from '@reflog/core';
import type { StageSpec } from '@reflog/core';

type Pattern = 'grid' | 'contour' | 'wave' | 'section';

/**
 * 場所の書き方から模様を決める。
 * docs/world.md の対応表がここの唯一の根拠。
 */
const patternOf = (place: string): Pattern => {
  if (/水路|海|港|river|湾|沼/.test(place)) return 'wave';
  if (/書庫|保管|地下|坑/.test(place)) return 'section';
  if (/研究所|観測所|中継所|施設|棟|室/.test(place)) return 'grid';
  return 'contour';
};

const line = (x1: number, y1: number, x2: number, y2: number): string =>
  `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;

const SIZE = 240;

const draw = (pattern: Pattern, rand: () => number): string => {
  const paths: string[] = [];

  switch (pattern) {
    // 施設 —— 図面の割付。間隔だけが揺れる
    case 'grid': {
      const step = 24 + Math.floor(rand() * 16);
      for (let x = 0; x <= SIZE; x += step) paths.push(line(x, 0, x, SIZE));
      for (let y = 0; y <= SIZE; y += step) paths.push(line(0, y, SIZE, y));
      break;
    }
    // 屋外 —— 等高線。うねりの位相を場所ごとに変える
    case 'contour': {
      const phase = rand() * Math.PI * 2;
      for (let i = 0; i < 7; i += 1) {
        const base = (i + 1) * (SIZE / 8);
        const amp = 6 + rand() * 10;
        let d = `M0 ${(base + Math.sin(phase) * amp).toFixed(1)}`;
        for (let x = 12; x <= SIZE; x += 12) {
          const y = base + Math.sin(phase + x / 26 + i) * amp;
          d += `L${x} ${y.toFixed(1)}`;
        }
        paths.push(d);
      }
      break;
    }
    // 水 —— 波形。等高線より周期が短く、振れ幅が揃っている
    case 'wave': {
      const phase = rand() * Math.PI * 2;
      for (let i = 0; i < 10; i += 1) {
        const base = i * (SIZE / 10) + 6;
        let d = `M0 ${base.toFixed(1)}`;
        for (let x = 8; x <= SIZE; x += 8) {
          const y = base + Math.sin(phase + x / 14) * 4;
          d += `L${x} ${y.toFixed(1)}`;
        }
        paths.push(d);
      }
      break;
    }
    // 地下 —— 断面のハッチング
    case 'section': {
      const step = 12 + Math.floor(rand() * 8);
      for (let i = -SIZE; i <= SIZE; i += step) {
        paths.push(line(i, 0, i + SIZE, SIZE));
      }
      for (let y = 0; y <= SIZE; y += SIZE / 4) paths.push(line(0, y, SIZE, y));
      break;
    }
  }

  return paths.map((d) => `<path d="${d}"/>`).join('');
};

/**
 * 背景に敷く data URI を返す。
 *
 * 色は currentColor ではなく固定の低不透明度にしてある。
 * 明暗どちらの下地でも同じ濃さに見えるほうが、地紋としては安定する。
 */
export const backdropOf = (spec: StageSpec): string => {
  const place =
    spec.briefing?.find((line) => line.label === '場所')?.value ??
    spec.briefing?.find((line) => line.label === '主題')?.value ??
    spec.id;

  const rng = createRng(seedFrom(`${spec.id}:${place}`));
  const body = draw(patternOf(place), () => rng.next());

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<g fill="none" stroke="rgb(160,150,140)" stroke-opacity="0.16" stroke-width="1">${body}</g>` +
    `</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
