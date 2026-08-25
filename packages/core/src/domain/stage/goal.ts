/**
 * ステージの達成条件。
 *
 * 「A が生存しており、かつ B の発明が存在する世界を成立させよ。ただし戦争は起きていないこと」
 * のような要求を、宣言的な述語として表現する。
 *
 * 重要なのは historyPreserved で、これがあると reset による力技が封じられる。
 * 「歴史を消さずに目的を達成せよ」という制約が、revert と reset の違いを体で覚えさせる。
 */
import type { CommitId, TimelineState } from '../timeline/types.ts';
import { ancestorsOf, currentWorldState } from '../timeline/graph.ts';
import type { BranchName, FactKey, FactValue } from '../timeline/types.ts';

export type GoalPredicate =
  /** 現在の世界で、ある事実が特定の値であること。 */
  | { readonly type: 'factEquals'; readonly key: FactKey; readonly value: FactValue }
  /** 現在の世界に、ある事実が存在すること。 */
  | { readonly type: 'factExists'; readonly key: FactKey }
  /** 現在の世界に、ある事実が存在しないこと。 */
  | { readonly type: 'factAbsent'; readonly key: FactKey }
  /** 指定のブランチが存在すること。 */
  | { readonly type: 'branchExists'; readonly branch: BranchName }
  /** HEAD が指定のブランチ上にあること。 */
  | { readonly type: 'headOn'; readonly branch: BranchName }
  /** 指定のコミットが、どこかのブランチから到達可能なままであること（歴史の保存）。 */
  | { readonly type: 'historyPreserved'; readonly commitId: CommitId }
  /** 到達可能なコミット数の上限。歴史を膨らませすぎない制約。 */
  | { readonly type: 'commitCountAtMost'; readonly count: number }
  | { readonly type: 'and'; readonly all: readonly GoalPredicate[] }
  | { readonly type: 'or'; readonly any: readonly GoalPredicate[] }
  | { readonly type: 'not'; readonly of: GoalPredicate };

const reachableCommits = (state: TimelineState): ReadonlySet<CommitId> => {
  const reachable = new Set<CommitId>();
  for (const tip of Object.values(state.branches)) {
    for (const id of ancestorsOf(state, tip)) reachable.add(id);
  }
  if (state.head.type === 'detached') {
    for (const id of ancestorsOf(state, state.head.commitId)) reachable.add(id);
  }
  return reachable;
};

export const evaluatePredicate = (
  state: TimelineState,
  predicate: GoalPredicate,
): boolean => {
  switch (predicate.type) {
    case 'factEquals': {
      const world = currentWorldState(state);
      return world.ok && world.value[predicate.key] === predicate.value;
    }
    case 'factExists': {
      const world = currentWorldState(state);
      return world.ok && predicate.key in world.value;
    }
    case 'factAbsent': {
      const world = currentWorldState(state);
      return world.ok && !(predicate.key in world.value);
    }
    case 'branchExists':
      return predicate.branch in state.branches;
    case 'headOn':
      return state.head.type === 'branch' && state.head.branch === predicate.branch;
    case 'historyPreserved':
      return reachableCommits(state).has(predicate.commitId);
    case 'commitCountAtMost':
      return reachableCommits(state).size <= predicate.count;
    case 'and':
      return predicate.all.every((p) => evaluatePredicate(state, p));
    case 'or':
      return predicate.any.some((p) => evaluatePredicate(state, p));
    case 'not':
      return !evaluatePredicate(state, predicate.of);
  }
};

/** UI にチェックリストとして出すための 1 項目。 */
export interface Goal {
  readonly id: string;
  /** プレイヤーに提示する文言。ゲーム語彙で書いてよい。 */
  readonly label: string;
  readonly predicate: GoalPredicate;
  /**
   * 任意条件。満たさなくてもクリアできるが、達成すると評価が上がる。
   * 「歴史を一切消さずにクリアした」のような称号に使う。
   */
  readonly optional?: boolean;
}

export interface GoalStatus {
  readonly id: string;
  readonly label: string;
  readonly satisfied: boolean;
  readonly optional: boolean;
}

export interface GoalReport {
  /** 必須条件をすべて満たしているか。 */
  readonly cleared: boolean;
  /** 任意条件も含めてすべて満たしているか。 */
  readonly perfect: boolean;
  readonly statuses: readonly GoalStatus[];
}

export const evaluateGoals = (
  state: TimelineState,
  goals: readonly Goal[],
): GoalReport => {
  const statuses = goals.map((goal) => ({
    id: goal.id,
    label: goal.label,
    satisfied: evaluatePredicate(state, goal.predicate),
    optional: goal.optional ?? false,
  }));

  return {
    cleared: statuses.filter((s) => !s.optional).every((s) => s.satisfied),
    perfect: statuses.every((s) => s.satisfied),
    statuses,
  };
};
