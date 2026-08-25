/**
 * 難易度。
 *
 * 本編では、プレイヤーが選んだ難易度に応じて制限が変わる。
 * 観測任務（自動生成）では、直近の成績から自動的に上下する。
 *
 * 数値はすべて生成器へのパラメータであり、ステージ定義そのものは
 * 手作りでも生成でも同じ StageSpec になる。
 */
import type { AbilityKind } from '../ability/types.ts';

export type DifficultyLevel = 'quiet' | 'standard' | 'severe' | 'critical';

export interface DifficultyProfile {
  readonly level: DifficultyLevel;
  /** プレイヤーに見せる呼称。観測局の警戒度という体裁にしてある。 */
  readonly label: string;
  /** 分岐する世界線の数（main を除く）。 */
  readonly branches: readonly [number, number];
  /** 異常が発生するまでの歴史の深さ。 */
  readonly depth: readonly [number, number];
  /** 発生させる矛盾の数。 */
  readonly conflicts: readonly [number, number];
  /** 想定解の手数の目安。 */
  readonly solutionLength: readonly [number, number];
  /** 手数上限の余裕。0 なら想定解ぴったりしか許されない。 */
  readonly moveSlack: number;
  /** 因果負荷の余裕。 */
  readonly loadSlack: number;
  readonly abilities: readonly AbilityKind[];
  /** 助言を求められるか。 */
  readonly hints: boolean;
  /** 歴史の保存を必須にするか（reset による力技を封じる）。 */
  readonly requireHistory: boolean;
}

const BASE_ABILITIES: readonly AbilityKind[] = ['checkout', 'revert', 'merge'];

export const DIFFICULTIES: Readonly<Record<DifficultyLevel, DifficultyProfile>> = {
  quiet: {
    level: 'quiet',
    label: '警戒度 低',
    branches: [1, 1],
    depth: [1, 2],
    conflicts: [0, 1],
    solutionLength: [2, 3],
    moveSlack: 3,
    loadSlack: 6,
    abilities: BASE_ABILITIES,
    hints: true,
    requireHistory: true,
  },
  standard: {
    level: 'standard',
    label: '警戒度 中',
    branches: [1, 2],
    depth: [2, 3],
    conflicts: [1, 2],
    solutionLength: [3, 4],
    moveSlack: 2,
    loadSlack: 4,
    abilities: [...BASE_ABILITIES, 'branch'],
    hints: true,
    requireHistory: true,
  },
  severe: {
    level: 'severe',
    label: '警戒度 高',
    branches: [2, 3],
    depth: [3, 4],
    conflicts: [2, 3],
    solutionLength: [4, 6],
    moveSlack: 1,
    loadSlack: 2,
    abilities: [...BASE_ABILITIES, 'branch'],
    hints: false,
    requireHistory: true,
  },
  critical: {
    level: 'critical',
    label: '警戒度 特級',
    branches: [3, 4],
    depth: [4, 5],
    conflicts: [3, 4],
    solutionLength: [5, 8],
    moveSlack: 0,
    loadSlack: 1,
    abilities: [...BASE_ABILITIES, 'branch', 'delete-branch'],
    hints: false,
    requireHistory: true,
  },
};

export const LEVEL_ORDER: readonly DifficultyLevel[] = [
  'quiet',
  'standard',
  'severe',
  'critical',
];

/** 直近の任務の成績。適応的難易度の入力になる。 */
export interface MissionOutcome {
  readonly cleared: boolean;
  /** 想定解に対して何手余分にかかったか。負なら想定解より短い。 */
  readonly moveOverhead: number;
  /** 助言を使ったか。 */
  readonly usedHint: boolean;
  /** やり直した回数。 */
  readonly retries: number;
}

const shift = (level: DifficultyLevel, delta: number): DifficultyLevel => {
  const index = LEVEL_ORDER.indexOf(level);
  const next = Math.min(LEVEL_ORDER.length - 1, Math.max(0, index + delta));
  return LEVEL_ORDER[next] as DifficultyLevel;
};

/**
 * 直近の成績から次の難易度を決める。
 *
 * 上げるのは慎重に、下げるのは素早く。
 * 「難しすぎて詰まった」体験のほうが「簡単すぎた」より離脱に直結するため。
 */
export const adaptDifficulty = (
  current: DifficultyLevel,
  recent: readonly MissionOutcome[],
): DifficultyLevel => {
  if (recent.length === 0) return current;

  const window = recent.slice(-3);
  const failures = window.filter((o) => !o.cleared).length;
  if (failures >= 2) return shift(current, -1);

  const struggled = window.filter(
    (o) => !o.cleared || o.usedHint || o.retries > 0 || o.moveOverhead > 2,
  ).length;
  if (struggled >= 2) return current;

  // 直近 3 件すべてを、ヒントもやり直しもなく、ほぼ最短で解けている場合のみ上げる。
  const mastered =
    window.length >= 3 &&
    window.every((o) => o.cleared && !o.usedHint && o.retries === 0 && o.moveOverhead <= 1);

  return mastered ? shift(current, 1) : current;
};
