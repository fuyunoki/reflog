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
    tags: {},
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
    tags: state.tags,
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
    tags: state.tags,
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

// --- cherry-pick ------------------------------------------------------------

export interface CherryPickInput {
  readonly targetId: CommitId;
  readonly message?: string;
  readonly narrative?: string;
  readonly resolutions?: Readonly<Record<FactKey, ConflictResolution>>;
}

/**
 * cherry-pick の結果を、実行せずに調べる。
 * merge と同じく矛盾が起こりうるので、決断を仰ぐ UI を出すために使う。
 */
export const previewCherryPick = (
  state: TimelineState,
  targetId: CommitId,
): Result<MergeAnalysis, DomainError> => {
  const target = getCommit(state, targetId);
  if (!target.ok) return target;

  const head = resolveHead(state);
  if (!head.ok) return head;

  if (isAncestorOf(state, targetId, head.value)) {
    return err({ type: 'AlreadyApplied', commitId: targetId });
  }

  // その出来事が「加えた変更」だけを持ち込む。
  // base はその直前、theirs はその直後の世界。
  const parent = target.value.parents[0];
  const base: WorldState = parent ? (state.commits[parent]?.snapshot ?? {}) : {};
  const ours = worldStateAt(state, head.value);
  if (!ours.ok) return ours;

  return ok(threeWayMerge(base, ours.value, target.value.snapshot));
};

/**
 * 別の世界線の出来事を 1 つだけ、いまの世界線に持ち込む。
 *
 * merge との決定的な違いは、親を 1 つしか持たないこと。
 * 履歴は繋がらず、その出来事だけが移植される。
 * 「あの世界の彼女の発明だけを、この世界へ」という操作にあたる。
 */
export const cherryPick = (
  state: TimelineState,
  input: CherryPickInput,
): Result<TimelineState, DomainError> => {
  const analysis = previewCherryPick(state, input.targetId);
  if (!analysis.ok) return analysis;

  const resolutions = input.resolutions ?? {};
  if (!isFullyResolved(analysis.value, resolutions)) {
    return err({
      type: 'MergeConflict',
      conflicts: analysis.value.conflicts
        .filter((c) => !(c.key in resolutions))
        .map((c) => c.key),
    });
  }

  const target = getCommit(state, input.targetId);
  if (!target.ok) return target;

  const head = resolveHead(state);
  if (!head.ok) return head;
  const ours = worldStateAt(state, head.value);
  if (!ours.ok) return ours;

  const snapshot = applyResolutions(analysis.value, resolutions);
  const changes = diffWorldStates(ours.value, snapshot);
  if (Object.keys(changes).length === 0) {
    return err({ type: 'NothingToCommit' });
  }

  const sequence = state.nextSequence;
  const id = commitIdFor(sequence);
  const picked: Commit = {
    id,
    // 親は 1 つ。取り込み元とは繋がらない。
    parents: [head.value],
    message: input.message ?? target.value.message,
    snapshot,
    changes,
    narrative: input.narrative ?? target.value.narrative,
    sequence,
  };

  const moved = advanceHead(state, id);
  return ok({
    commits: { ...state.commits, [id]: picked },
    branches: moved.branches,
    tags: state.tags,
    head: moved.head,
    reflog: withReflog(state, {
      operation: 'cherry-pick',
      before: head.value,
      after: id,
      note: input.targetId,
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

// --- tag --------------------------------------------------------------------

/**
 * 時点に名前を付ける。
 *
 * ブランチとの違いは、この印が動かないこと。
 * ブランチは新しい出来事を刻むたびに先へ進むが、タグはその時点に留まる。
 */
export const createTag = (
  state: TimelineState,
  name: string,
  at?: CommitId,
): Result<TimelineState, DomainError> => {
  if (name in state.tags) {
    return err({ type: 'TagAlreadyExists', tag: name });
  }

  let target: CommitId;
  if (at === undefined) {
    const head = resolveHead(state);
    if (!head.ok) return head;
    target = head.value;
  } else {
    const found = getCommit(state, at);
    if (!found.ok) return found;
    target = at;
  }

  return ok({
    ...state,
    tags: { ...state.tags, [name]: target },
    reflog: withReflog(state, {
      operation: 'tag',
      before: target,
      after: target,
      note: name,
    }),
  });
};

export const deleteTag = (
  state: TimelineState,
  name: string,
): Result<TimelineState, DomainError> => {
  if (!(name in state.tags)) {
    return err({ type: 'TagNotFound', tag: name });
  }
  const tags = { ...state.tags };
  const removed = tags[name] as CommitId;
  delete tags[name];

  return ok({
    ...state,
    tags,
    reflog: withReflog(state, {
      operation: 'tag-delete',
      before: removed,
      after: null,
      note: name,
    }),
  });
};

/** その時点に付いているタグ。グラフの表示に使う。 */
export const tagsAt = (state: TimelineState, id: CommitId): readonly string[] =>
  Object.entries(state.tags)
    .filter(([, target]) => target === id)
    .map(([name]) => name);

// --- rebase -----------------------------------------------------------------

export interface RebaseInput {
  /** 付け替え先の世界線。 */
  readonly onto: BranchName;
  readonly resolutions?: Readonly<Record<FactKey, ConflictResolution>>;
}

export interface RebasePreview {
  readonly kind: 'up-to-date' | 'replay';
  /** 付け替えられる時点。古い順。 */
  readonly moving: readonly CommitId[];
  /** 最初に矛盾が出た段階の分析。無ければそのまま通る。 */
  readonly analysis?: MergeAnalysis;
  readonly onto: CommitId;
}

/**
 * 分岐点から現在地までを、第一親だけを辿って並べる。
 * 途中にマージがあると平坦化できないので、そのときは扱わない。
 */
const firstParentChain = (
  state: TimelineState,
  from: CommitId,
  base: CommitId,
): Result<readonly CommitId[], DomainError> => {
  const chain: CommitId[] = [];
  let cursor: CommitId | undefined = from;

  while (cursor && cursor !== base) {
    // cursor と互いに型を参照し合うため、明示的に注釈を付けて推論の循環を断つ
    const node: Commit | undefined = state.commits[cursor];
    if (!node) return err({ type: 'CommitNotFound', commitId: cursor });
    if (node.parents.length > 1) {
      return err({ type: 'CannotRebaseMerge', commitId: cursor });
    }
    chain.unshift(cursor);
    cursor = node.parents[0];
  }

  return ok(chain);
};

/**
 * 1 つの時点を、別の土台の上に載せ直したときの結果を求める。
 *
 * 注意: ここでの ours / theirs は merge と逆になる。
 * 載せ替える先（onto）が ours、移動してくる側が theirs。
 * 本物の git の rebase も同じ向きで、混乱の元として知られているが、
 * 教材である以上ここを変えるわけにはいかない。
 */
const replayOnto = (
  state: TimelineState,
  original: Commit,
  ontoSnapshot: WorldState,
): MergeAnalysis => {
  const parent = original.parents[0];
  const base: WorldState = parent ? (state.commits[parent]?.snapshot ?? {}) : {};
  return threeWayMerge(base, ontoSnapshot, original.snapshot);
};

export const previewRebase = (
  state: TimelineState,
  onto: BranchName,
): Result<RebasePreview, DomainError> => {
  if (state.head.type !== 'branch') {
    return err({ type: 'DetachedHeadNotAllowed' });
  }

  const head = resolveHead(state);
  if (!head.ok) return head;
  const target = getBranchTip(state, onto);
  if (!target.ok) return target;

  // すでに相手の上に載っているなら、やることがない
  if (isAncestorOf(state, target.value, head.value)) {
    return ok({ kind: 'up-to-date', moving: [], onto: target.value });
  }

  const base = mergeBase(state, head.value, target.value);
  if (!base.ok) return base;

  const chain = firstParentChain(state, head.value, base.value);
  if (!chain.ok) return chain;

  // 土台の上に順に載せ直して、最初に生じる矛盾を探す
  let snapshot = state.commits[target.value]?.snapshot ?? {};
  let firstConflict: MergeAnalysis | undefined;

  for (const id of chain.value) {
    // 変数名を commit にすると、同名の関数と衝突する
    const step = state.commits[id];
    if (!step) return err({ type: 'CommitNotFound', commitId: id });
    const analysis = replayOnto(state, step, snapshot);
    if (analysis.conflicts.length > 0 && !firstConflict) firstConflict = analysis;
    snapshot = analysis.merged;
  }

  return ok({
    kind: 'replay',
    moving: chain.value,
    ...(firstConflict ? { analysis: firstConflict } : {}),
    onto: target.value,
  });
};

/**
 * いまの世界線を、別の世界線の上に載せ直す。
 *
 * merge との違いは、履歴が分岐したまま残らないこと。
 * 出来事は同じ順で並び直されるが、元の時点とは別物になる。
 * 元の時点は参照を失うだけで消えはしないので、reflog から辿れる。
 */
export const rebase = (
  state: TimelineState,
  input: RebaseInput,
): Result<TimelineState, DomainError> => {
  const preview = previewRebase(state, input.onto);
  if (!preview.ok) return preview;

  if (preview.value.kind === 'up-to-date') {
    return err({ type: 'AlreadyUpToDate', branch: input.onto });
  }
  if (state.head.type !== 'branch') {
    return err({ type: 'DetachedHeadNotAllowed' });
  }

  const resolutions = input.resolutions ?? {};
  if (preview.value.analysis && !isFullyResolved(preview.value.analysis, resolutions)) {
    return err({
      type: 'MergeConflict',
      conflicts: preview.value.analysis.conflicts
        .filter((c) => !(c.key in resolutions))
        .map((c) => c.key),
    });
  }

  let commits = { ...state.commits };
  let sequence = state.nextSequence;
  let cursor = preview.value.onto;
  let snapshot = state.commits[preview.value.onto]?.snapshot ?? {};
  const before = resolveHead(state);
  if (!before.ok) return before;

  for (const id of preview.value.moving) {
    const original = state.commits[id];
    if (!original) return err({ type: 'CommitNotFound', commitId: id });

    const analysis = replayOnto(state, original, snapshot);
    const resolved = applyResolutions(analysis, resolutions);
    const newId = commitIdFor(sequence);

    commits = {
      ...commits,
      [newId]: {
        id: newId,
        // 直前に載せた時点の上に、一列に並べ直す
        parents: [cursor],
        message: original.message,
        snapshot: resolved,
        changes: diffWorldStates(snapshot, resolved),
        ...(original.narrative === undefined ? {} : { narrative: original.narrative }),
        sequence,
      },
    };

    cursor = newId;
    snapshot = resolved;
    sequence += 1;
  }

  return ok({
    commits,
    branches: { ...state.branches, [state.head.branch]: cursor },
    tags: state.tags,
    head: state.head,
    reflog: withReflog(state, {
      operation: 'rebase',
      before: before.value,
      after: cursor,
      note: input.onto,
    }),
    nextSequence: sequence,
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
