/**
 * 3-way merge。git の意味論をそのまま実装する。
 *
 * ゲーム上は「2 つの世界線を統合したとき、両立しない現実が生じるか」の判定であり、
 * ここで生じた conflict がそのまま物語上の選択になる。
 */
import type {
  Conflict,
  ConflictResolution,
  FactKey,
  FactValue,
  WorldState,
} from './types.ts';

export interface MergeAnalysis {
  /** 自動的に決着した部分の世界状態。conflict のキーは ours を暫定値として含む。 */
  readonly merged: WorldState;
  /** プレイヤーの決断を要する矛盾。空なら自動マージが成立する。 */
  readonly conflicts: readonly Conflict[];
}

const valueAt = (state: WorldState, key: FactKey): FactValue | null =>
  key in state ? (state[key] as FactValue) : null;

/**
 * base を基準に ours と theirs を統合する。
 *
 * 判定規則:
 * - ours と theirs が同じ  -> その値（両者が同じ結論に達した）
 * - ours が base のまま     -> theirs（相手だけが変更した）
 * - theirs が base のまま   -> ours（自分だけが変更した）
 * - それ以外                -> conflict（双方が別々に変更した）
 */
export const threeWayMerge = (
  base: WorldState,
  ours: WorldState,
  theirs: WorldState,
): MergeAnalysis => {
  const keys = new Set<FactKey>([
    ...Object.keys(base),
    ...Object.keys(ours),
    ...Object.keys(theirs),
  ]);

  const merged: Record<FactKey, FactValue> = {};
  const conflicts: Conflict[] = [];

  for (const key of keys) {
    const b = valueAt(base, key);
    const o = valueAt(ours, key);
    const t = valueAt(theirs, key);

    let resolved: FactValue | null;
    if (o === t) {
      resolved = o;
    } else if (o === b) {
      resolved = t;
    } else if (t === b) {
      resolved = o;
    } else {
      conflicts.push({ key, base: b, ours: o, theirs: t });
      resolved = o; // 解決されるまでの暫定値
    }

    if (resolved !== null) merged[key] = resolved;
  }

  return { merged, conflicts };
};

/** プレイヤーの決断を適用して、conflict を含む統合結果を確定させる。 */
export const applyResolutions = (
  analysis: MergeAnalysis,
  resolutions: Readonly<Record<FactKey, ConflictResolution>>,
): WorldState => {
  const next: Record<FactKey, FactValue> = { ...analysis.merged };

  for (const conflict of analysis.conflicts) {
    const resolution = resolutions[conflict.key];
    if (!resolution) continue;

    const value =
      resolution.type === 'ours'
        ? conflict.ours
        : resolution.type === 'theirs'
          ? conflict.theirs
          : resolution.value;

    if (value === null) {
      delete next[conflict.key];
    } else {
      next[conflict.key] = value;
    }
  }

  return next;
};

/** すべての conflict に決断が与えられているか。 */
export const isFullyResolved = (
  analysis: MergeAnalysis,
  resolutions: Readonly<Record<FactKey, ConflictResolution>>,
): boolean => analysis.conflicts.every((c) => c.key in resolutions);
