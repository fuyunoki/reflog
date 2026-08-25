/**
 * コミットグラフに対する問い合わせ。状態を変更する操作は operations.ts にある。
 */
import { type Result, ok, err } from '../shared/result.ts';
import type { DomainError } from '../shared/errors.ts';
import type {
  BranchName,
  ChangeSet,
  Commit,
  CommitId,
  FactKey,
  TimelineState,
  WorldState,
} from './types.ts';

export const getCommit = (
  state: TimelineState,
  id: CommitId,
): Result<Commit, DomainError> => {
  const commit = state.commits[id];
  return commit ? ok(commit) : err({ type: 'CommitNotFound', commitId: id });
};

export const getBranchTip = (
  state: TimelineState,
  branch: BranchName,
): Result<CommitId, DomainError> => {
  const tip = state.branches[branch];
  return tip ? ok(tip) : err({ type: 'BranchNotFound', branch });
};

/** HEAD が現在指しているコミット。 */
export const resolveHead = (state: TimelineState): Result<CommitId, DomainError> =>
  state.head.type === 'detached'
    ? ok(state.head.commitId)
    : getBranchTip(state, state.head.branch);

/**
 * 対象コミット自身を含む祖先すべて。
 * 幅優先で辿る。訪問済みを持つのでマージによる合流があっても重複しない。
 */
export const ancestorsOf = (
  state: TimelineState,
  id: CommitId,
): ReadonlySet<CommitId> => {
  const seen = new Set<CommitId>();
  const queue: CommitId[] = [id];
  while (queue.length > 0) {
    const current = queue.shift() as CommitId;
    if (seen.has(current)) continue;
    const commit = state.commits[current];
    if (!commit) continue;
    seen.add(current);
    queue.push(...commit.parents);
  }
  return seen;
};

/** a が b の祖先か（a === b でも true）。fast-forward の判定に使う。 */
export const isAncestorOf = (
  state: TimelineState,
  a: CommitId,
  b: CommitId,
): boolean => ancestorsOf(state, b).has(a);

/**
 * merge base（最も近い共通祖先）を求める。
 *
 * 共通祖先のうち、他のどの共通祖先の祖先にもなっていないものを選ぶ。
 * 制約: いわゆる criss-cross merge では共通祖先が複数残りうる。
 * git は recursive merge で仮想的な base を合成するが、本エンジンでは
 * sequence が最大のもの（= 最も新しいもの）を採用する。
 * 教材としてこの状況を扱わない前提であり、ステージ設計側で criss-cross を作らないこと。
 */
export const mergeBase = (
  state: TimelineState,
  a: CommitId,
  b: CommitId,
): Result<CommitId, DomainError> => {
  const ancestorsA = ancestorsOf(state, a);
  const ancestorsB = ancestorsOf(state, b);
  const common = [...ancestorsA].filter((id) => ancestorsB.has(id));
  if (common.length === 0) {
    return err({ type: 'NoMergeBase', a, b });
  }

  const commonSet = new Set(common);
  // 他の共通祖先から到達できてしまうものは「より遠い」ので候補から外す。
  const nearest = common.filter((candidate) =>
    !common.some(
      (other) =>
        other !== candidate && ancestorsOf(state, other).has(candidate),
    ),
  );

  const pool = nearest.length > 0 ? nearest : [...commonSet];
  const best = pool.reduce((acc, id) => {
    const current = state.commits[id];
    const chosen = state.commits[acc];
    if (!current) return acc;
    if (!chosen) return id;
    return current.sequence > chosen.sequence ? id : acc;
  }, pool[0] as CommitId);

  return ok(best);
};

/** 指定コミット時点の世界の状態。スナップショットを保持しているので走査は不要。 */
export const worldStateAt = (
  state: TimelineState,
  id: CommitId,
): Result<WorldState, DomainError> => {
  const commit = getCommit(state, id);
  return commit.ok ? ok(commit.value.snapshot) : commit;
};

/** HEAD 時点の世界の状態。目標判定はこれを見る。 */
export const currentWorldState = (
  state: TimelineState,
): Result<WorldState, DomainError> => {
  const head = resolveHead(state);
  return head.ok ? worldStateAt(state, head.value) : head;
};

/** 世界状態に変更を適用する。null は事実の消滅を意味するのでキーごと削除する。 */
export const applyChanges = (base: WorldState, changes: ChangeSet): WorldState => {
  const next: Record<FactKey, string> = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
};

/** 2 つの世界状態の差分。表示用の changes を導出するのに使う。 */
export const diffWorldStates = (from: WorldState, to: WorldState): ChangeSet => {
  const changes: Record<FactKey, string | null> = {};
  for (const [key, value] of Object.entries(to)) {
    if (from[key] !== value) changes[key] = value;
  }
  for (const key of Object.keys(from)) {
    if (!(key in to)) changes[key] = null;
  }
  return changes;
};

/** そのコミットを指しているブランチ名の一覧。グラフ描画のラベルに使う。 */
export const branchesAt = (
  state: TimelineState,
  id: CommitId,
): readonly BranchName[] =>
  Object.entries(state.branches)
    .filter(([, tip]) => tip === id)
    .map(([name]) => name);

/** 到達不能になったコミット。reset で切り離された「消えた世界線」。 */
export const orphanedCommits = (state: TimelineState): readonly CommitId[] => {
  const reachable = new Set<CommitId>();
  for (const tip of Object.values(state.branches)) {
    for (const id of ancestorsOf(state, tip)) reachable.add(id);
  }
  if (state.head.type === 'detached') {
    for (const id of ancestorsOf(state, state.head.commitId)) reachable.add(id);
  }
  return Object.keys(state.commits).filter((id) => !reachable.has(id));
};

/** 生成順にコミットを並べる。描画のレイアウト計算に使う。 */
export const listCommits = (state: TimelineState): readonly Commit[] =>
  Object.values(state.commits).sort((a, b) => a.sequence - b.sequence);
