/**
 * タイムラインを変更する操作。すべて (state, args) => Result<TimelineState, DomainError> の純粋関数。
 *
 * 入力の state を書き換えることは絶対にしない。
 * この不変性から、アンドゥ・リプレイ・サーバ側での解法再検証がすべて副産物として得られる。
 */
import { type Result, ok, err } from '../shared/result.ts';
import type { DomainError } from '../shared/errors.ts';
import {
  applyChanges,
  ancestorsOf,
  diffWorldStates,
  getBranchTip,
  getCommit,
  isAncestorOf,
  mergeBase,
  resolveHead,
  worldStateAt,
} from './graph.ts';
import { applyResolutions, isFullyResolved, threeWayMerge } from './merge.ts';
import type { MergeAnalysis } from './merge.ts';
import type {
  BranchName,
  ChangeSet,
  Commit,
  CommitId,
  ConflictResolution,
  FactKey,
  ReflogEntry,
  TimelineState,
  WorldState,
} from './types.ts';

const commitIdFor = (sequence: number): CommitId => `c${sequence}`;

const withReflog = (
  state: TimelineState,
  entry: Omit<ReflogEntry, 'sequence'>,
): readonly ReflogEntry[] => [
  ...state.reflog,
  { ...entry, sequence: state.reflog.length + 1 },
];

/**
 * 新しいコミットを積んだ後の branches / head を求める。
 * HEAD がブランチ上にあればブランチを進め、detached ならその場に留まる。
 */
const advanceHead = (
  state: TimelineState,
  newCommitId: CommitId,
): { branches: Record<BranchName, CommitId>; head: TimelineState['head'] } => {
  const branches = { ...state.branches };
  if (state.head.type === 'branch') {
    branches[state.head.branch] = newCommitId;
    return { branches, head: state.head };
  }
  return { branches, head: { type: 'detached', commitId: newCommitId } };
};

// --- 生成 -------------------------------------------------------------------

export interface CreateTimelineInput {
  /** 世界の初期状態。 */
  readonly initialFacts: WorldState;
  readonly rootMessage: string;
  readonly rootNarrative?: string;
  /** 最初のブランチ名。既定は main。 */
  readonly initialBranch?: BranchName;
}

export const createTimeline = (input: CreateTimelineInput): TimelineState => {
  const branch = input.initialBranch ?? 'main';
  const id = commitIdFor(1);
  const root: Commit = {
    id,
    parents: [],
    message: input.rootMessage,
    snapshot: { ...input.initialFacts },
    changes: { ...input.initialFacts },
    narrative: input.rootNarrative,
    sequence: 1,
  };
  return {
    commits: { [id]: root },
    branches: { [branch]: id },
    head: { type: 'branch', branch },
    reflog: [{ sequence: 1, operation: 'init', before: null, after: id }],
    nextSequence: 2,
  };
};

// --- commit -----------------------------------------------------------------

export interface CommitInput {
  readonly message: string;
  readonly changes: ChangeSet;
  readonly narrative?: string;
}

export const commit = (
  state: TimelineState,
  input: CommitInput,
): Result<TimelineState, DomainError> => {
  const head = resolveHead(state);
  if (!head.ok) return head;

  const parentState = worldStateAt(state, head.value);
  if (!parentState.ok) return parentState;

  const snapshot = applyChanges(parentState.value, input.changes);
  const effective = diffWorldStates(parentState.value, snapshot);
  if (Object.keys(effective).length === 0) {
    return err({ type: 'NothingToCommit' });
  }

  const sequence = state.nextSequence;
  const id = commitIdFor(sequence);
  const newCommit: Commit = {
    id,
    parents: [head.value],
    message: input.message,
    snapshot,
    changes: effective,
    narrative: input.narrative,
    sequence,
  };

  const moved = advanceHead(state, id);
  return ok({
    commits: { ...state.commits, [id]: newCommit },
    branches: moved.branches,
    head: moved.head,
    reflog: withReflog(state, {
      operation: 'commit',
      before: head.value,
      after: id,
      note: input.message,
    }),
    nextSequence: sequence + 1,
  });
};

// --- branch / checkout ------------------------------------------------------

export const createBranch = (
  state: TimelineState,
  name: BranchName,
  at?: CommitId,
): Result<TimelineState, DomainError> => {
  if (name in state.branches) {
    return err({ type: 'BranchAlreadyExists', branch: name });
  }

  let tip: CommitId;
  if (at === undefined) {
    const head = resolveHead(state);
    if (!head.ok) return head;
    tip = head.value;
  } else {
    const found = getCommit(state, at);
    if (!found.ok) return found;
    tip = at;
  }

  return ok({
    ...state,
    branches: { ...state.branches, [name]: tip },
    reflog: withReflog(state, {
      operation: 'branch',
      before: tip,
      after: tip,
      note: name,
    }),
  });
};

export const deleteBranch = (
  state: TimelineState,
  name: BranchName,
): Result<TimelineState, DomainError> => {
  if (!(name in state.branches)) {
    return err({ type: 'BranchNotFound', branch: name });
  }
  if (state.head.type === 'branch' && state.head.branch === name) {
    return err({ type: 'CannotDeleteCurrentBranch', branch: name });
  }
  const branches = { ...state.branches };
  const removed = branches[name] as CommitId;
  delete branches[name];

  return ok({
    ...state,
    branches,
    reflog: withReflog(state, {
      operation: 'branch-delete',
      before: removed,
      after: null,
      note: name,
    }),
  });
};

export type CheckoutTarget =
  | { readonly type: 'branch'; readonly branch: BranchName }
  | { readonly type: 'commit'; readonly commitId: CommitId };

export const checkout = (
  state: TimelineState,
  target: CheckoutTarget,
): Result<TimelineState, DomainError> => {
  const before = resolveHead(state);

  if (target.type === 'branch') {
    const tip = getBranchTip(state, target.branch);
    if (!tip.ok) return tip;
    return ok({
      ...state,
      head: { type: 'branch', branch: target.branch },
      reflog: withReflog(state, {
        operation: 'checkout',
        before: before.ok ? before.value : null,
        after: tip.value,
        note: target.branch,
      }),
    });
  }

  const found = getCommit(state, target.commitId);
  if (!found.ok) return found;
  return ok({
    ...state,
    head: { type: 'detached', commitId: target.commitId },
    reflog: withReflog(state, {
      operation: 'checkout',
      before: before.ok ? before.value : null,
      after: target.commitId,
      note: target.commitId,
    }),
  });
};

// --- merge ------------------------------------------------------------------

export interface MergeInput {
  /** 取り込む側のブランチ（theirs）。 */
  readonly from: BranchName;
  readonly message?: string;
  readonly narrative?: string;
  /** conflict に対する決断。未解決の conflict が残るとエラーになる。 */
  readonly resolutions?: Readonly<Record<FactKey, ConflictResolution>>;
}

export interface MergePreview {
  readonly kind: 'up-to-date' | 'fast-forward' | 'three-way';
  readonly analysis?: MergeAnalysis;
  readonly base?: CommitId;
  readonly ours: CommitId;
  readonly theirs: CommitId;
}

/**
 * merge の結果を、実行せずに調べる。conflict 解決 UI を出すために使う。
 */
export const previewMerge = (
  state: TimelineState,
  from: BranchName,
): Result<MergePreview, DomainError> => {
  const ours = resolveHead(state);
  if (!ours.ok) return ours;
  const theirs = getBranchTip(state, from);
  if (!theirs.ok) return theirs;

  if (isAncestorOf(state, theirs.value, ours.value)) {
    return ok({ kind: 'up-to-date', ours: ours.value, theirs: theirs.value });
  }
  if (isAncestorOf(state, ours.value, theirs.value)) {
    return ok({ kind: 'fast-forward', ours: ours.value, theirs: theirs.value });
  }

  const base = mergeBase(state, ours.value, theirs.value);
  if (!base.ok) return base;

  const baseState = worldStateAt(state, base.value);
  if (!baseState.ok) return baseState;
  const oursState = worldStateAt(state, ours.value);
  if (!oursState.ok) return oursState;
  const theirsState = worldStateAt(state, theirs.value);
  if (!theirsState.ok) return theirsState;

  return ok({
    kind: 'three-way',
    analysis: threeWayMerge(baseState.value, oursState.value, theirsState.value),
    base: base.value,
    ours: ours.value,
    theirs: theirs.value,
  });
};

export const merge = (
  state: TimelineState,
  input: MergeInput,
): Result<TimelineState, DomainError> => {
  const preview = previewMerge(state, input.from);
  if (!preview.ok) return preview;

  if (preview.value.kind === 'up-to-date') {
    return err({ type: 'AlreadyUpToDate', branch: input.from });
  }

  // fast-forward: 新しいコミットは作らず、ブランチを進めるだけ。
  if (preview.value.kind === 'fast-forward') {
    if (state.head.type !== 'branch') {
      return err({ type: 'DetachedHeadNotAllowed' });
    }
    const target = preview.value.theirs;
    return ok({
      ...state,
      branches: { ...state.branches, [state.head.branch]: target },
      reflog: withReflog(state, {
        operation: 'merge:fast-forward',
        before: preview.value.ours,
        after: target,
        note: input.from,
      }),
    });
  }

  const analysis = preview.value.analysis as MergeAnalysis;
  const resolutions = input.resolutions ?? {};
  if (!isFullyResolved(analysis, resolutions)) {
    return err({
      type: 'MergeConflict',
      conflicts: analysis.conflicts
        .filter((c) => !(c.key in resolutions))
        .map((c) => c.key),
    });
  }

  const snapshot = applyResolutions(analysis, resolutions);
  const oursState = worldStateAt(state, preview.value.ours);
  if (!oursState.ok) return oursState;

  const sequence = state.nextSequence;
  const id = commitIdFor(sequence);
  const mergeCommit: Commit = {
    id,
    parents: [preview.value.ours, preview.value.theirs],
    message: input.message ?? `Merge branch ${input.from}`,
    snapshot,
    changes: diffWorldStates(oursState.value, snapshot),
    narrative: input.narrative,
    sequence,
  };

  const moved = advanceHead(state, id);
  return ok({
    commits: { ...state.commits, [id]: mergeCommit },
    branches: moved.branches,
    head: moved.head,
    reflog: withReflog(state, {
      operation: 'merge',
      before: preview.value.ours,
      after: id,
      note: input.from,
    }),
    nextSequence: sequence + 1,
  });
};

// --- revert -----------------------------------------------------------------

/**
 * 対象コミットが加えた変更を打ち消す新しいコミットを積む。
 * 歴史は消えない —— これが reset との決定的な違いであり、物語上の重みの差になる。
 */
export const revert = (
  state: TimelineState,
  targetId: CommitId,
  narrative?: string,
): Result<TimelineState, DomainError> => {
  const target = getCommit(state, targetId);
  if (!target.ok) return target;

  const firstParent = target.value.parents[0];
  const beforeState: Result<WorldState, DomainError> = firstParent
    ? worldStateAt(state, firstParent)
    : ok({});
  if (!beforeState.ok) return beforeState;

  // 対象コミットが触れたキーだけを、その直前の値へ戻す。
  const undo: Record<FactKey, string | null> = {};
  for (const key of Object.keys(target.value.changes)) {
    const previous = beforeState.value[key];
    undo[key] = previous === undefined ? null : previous;
  }

  return commit(state, {
    message: `Revert: ${target.value.message}`,
    changes: undo,
    narrative,
  });
};

// --- reset ------------------------------------------------------------------

/**
 * 現在のブランチを指定コミットまで巻き戻す。
 *
 * 切り離されたコミットは commits から削除しない。
 * git が GC 前まで到達不能なオブジェクトを保持するのと同じ挙動であり、
 * これが reflog（消えた世界線の回収）を成立させる根拠になる。
 */
export const reset = (
  state: TimelineState,
  targetId: CommitId,
): Result<TimelineState, DomainError> => {
  if (state.head.type !== 'branch') {
    return err({ type: 'DetachedHeadNotAllowed' });
  }
  const target = getCommit(state, targetId);
  if (!target.ok) return target;

  const before = resolveHead(state);
  if (!before.ok) return before;

  return ok({
    ...state,
    branches: { ...state.branches, [state.head.branch]: targetId },
    reflog: withReflog(state, {
      operation: 'reset',
      before: before.value,
      after: targetId,
      note: state.head.branch,
    }),
  });
};

/** reflog に記録が残っており、かつ現在どのブランチからも到達できないコミット。 */
export const recoverableCommits = (
  state: TimelineState,
): readonly CommitId[] => {
  const reachable = new Set<CommitId>();
  for (const tip of Object.values(state.branches)) {
    for (const id of ancestorsOf(state, tip)) reachable.add(id);
  }
  const seen = new Set<CommitId>();
  const result: CommitId[] = [];
  for (const entry of state.reflog) {
    for (const candidate of [entry.before, entry.after]) {
      if (!candidate || reachable.has(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
};
