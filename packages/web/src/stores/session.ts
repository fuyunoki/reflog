/**
 * プレイ中のステージの状態。
 *
 * ViewModel と Controller を兼ねる（クリーンアーキテクチャの Presenter を
 * 厳密に分けると Vue の reactivity と噛み合わないため、ここは意図的に妥協している）。
 * ゲームのルールは一切持たず、判断はすべて core のユースケースに委ねる。
 *
 * 操作はボタンとコンソールの二通りあるが、どちらも同じ AbilityCommand に落ちる。
 * 入口が違うだけで、その先は完全に共通の経路を通る。
 */
import { computed, shallowRef, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  AbilityCommand,
  AbilityKind,
  BranchName,
  CommitId,
  ConflictResolution,
  DomainError,
  FactKey,
  MergeAnalysis,
  CommitOffer,
  StageSession,
  StageSpec,
} from '@reflog/core';
import {
  canUndo as canUndoSession,
  parseCommand,
  resolveGuide,
  playAbility,
  previewCherryPick,
  previewMerge,
  previewRebase,
  resolveHead,
  startStage,
  undo as undoSession,
} from '@reflog/core';
import { errorMessage, factLabel, valueLabel } from '@/presentation/labels';
import { parseErrorMessage, renderDiff, renderQuery } from '@/presentation/consoleOutput';

/**
 * 決断待ちの矛盾。
 * merge でも cherry-pick でも起こりうるので、どちらから来たかを持たせる。
 */
export interface PendingConflict {
  readonly kind: 'merge' | 'cherry-pick' | 'rebase';
  /** merge なら統合元の世界線、cherry-pick なら持ち込む時点。 */
  readonly source: string;
  readonly analysis: MergeAnalysis;
}

export type Notice = { readonly text: string; readonly tone: 'info' | 'error' };

export type ConsoleLineKind = 'input' | 'output' | 'error' | 'note';

export interface ConsoleLine {
  readonly id: number;
  readonly kind: ConsoleLineKind;
  readonly text: string;
}

/** 操作の入口。プレイヤーがいつでも切り替えられる。 */
export type InputMode = 'panel' | 'console';

const MODE_STORAGE_KEY = 'reflog:input-mode';

const readStoredMode = (): InputMode => {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'console' ? 'console' : 'panel';
  } catch {
    return 'panel';
  }
};

export const useSessionStore = defineStore('session', () => {
  const session = shallowRef<StageSession | null>(null);
  const selected = ref<CommitId | null>(null);
  const hintsRevealed = ref(0);
  const retries = ref(0);
  const notice = ref<Notice | null>(null);
  const introOpen = ref(false);
  const outroOpen = ref(false);
  /** 手引きのうち、読むだけの段をいくつ読み終えたか。 */
  const guideRead = ref(0);
  const lastError = shallowRef<DomainError | null>(null);

  /** 直前に start へ渡された習得済み術式。やり直しで引き継ぐ。 */
  let learnedAbilities: readonly AbilityKind[] = [];

  const inputMode = ref<InputMode>(readStoredMode());
  const consoleLines = ref<ConsoleLine[]>([]);
  const commandHistory = ref<string[]>([]);
  let lineId = 0;

  /** 解決待ちの矛盾と、プレイヤーが今のところ選んでいる決断。 */
  const pendingConflict = shallowRef<PendingConflict | null>(null);
  /** 刻む出来事を選んでもらっている最中。候補が複数あるときだけ入る。 */
  const pendingOffers = shallowRef<readonly CommitOffer[] | null>(null);
  const conflictChoices = ref<Record<FactKey, ConflictResolution>>({});

  const spec = computed<StageSpec | null>(() => session.value?.spec ?? null);
  const timeline = computed(() => session.value?.timeline ?? null);
  const report = computed(() => session.value?.report ?? null);
  const cleared = computed(() => session.value?.status === 'cleared');
  const canUndo = computed(() => (session.value ? canUndoSession(session.value) : false));
  const usedHint = computed(() => hintsRevealed.value > 0);

  const headCommit = computed<CommitId | null>(() => {
    if (!session.value) return null;
    const head = resolveHead(session.value.timeline);
    return head.ok ? head.value : null;
  });

  /** 記録欄に出す時点。何も選んでいなければ現在地。 */
  const focusedCommit = computed<CommitId | null>(
    () => selected.value ?? headCommit.value,
  );

  const branches = computed<readonly BranchName[]>(() =>
    session.value ? Object.keys(session.value.timeline.branches) : [],
  );

  const mergeableBranches = computed<readonly BranchName[]>(() => {
    if (!session.value) return [];
    const head = session.value.timeline.head;
    return branches.value.filter((b) => !(head.type === 'branch' && head.branch === b));
  });

  /**
   * 手引きの現在地。セッションから毎回導出するので、
   * アンドゥしても手引きだけが先に進んだままにならない。
   */
  const guide = computed(() => {
    const current = session.value;
    if (!current) {
      return { current: null, index: 0, total: 0, finished: true };
    }
    return resolveGuide(current.spec.guide, {
      selected: selected.value,
      commands: current.commands,
      report: current.report,
      cleared: current.status === 'cleared',
      acknowledged: guideRead.value,
    });
  });

  /** 読むだけの段を読み終えたことにする。 */
  function acknowledgeGuide(): void {
    guideRead.value += 1;
  }

  const allConflictsDecided = computed(() => {
    const pending = pendingConflict.value;
    if (!pending) return false;
    return pending.analysis.conflicts.every((c) => c.key in conflictChoices.value);
  });

  // --- コンソール出力 -------------------------------------------------------

  function emit(kind: ConsoleLineKind, text: string | readonly string[]): void {
    const texts = Array.isArray(text) ? text : [text as string];
    for (const line of texts) {
      lineId += 1;
      consoleLines.value = [...consoleLines.value, { id: lineId, kind, text: line }];
    }
  }

  function setMode(mode: InputMode): void {
    inputMode.value = mode;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // 保存できなくても切り替えそのものは有効
    }
  }

  function toggleMode(): void {
    setMode(inputMode.value === 'panel' ? 'console' : 'panel');
  }

  // --- 操作 ---------------------------------------------------------------

  function notify(text: string, tone: 'info' | 'error' = 'info'): void {
    notice.value = { text, tone };
  }

  function start(next: StageSpec, learned: readonly AbilityKind[] = []): void {
    learnedAbilities = learned;
    const result = startStage(next, learned);
    if (!result.ok) {
      notify(errorMessage(result.error), 'error');
      return;
    }
    session.value = result.value;
    selected.value = null;
    hintsRevealed.value = 0;
    retries.value = 0;
    notice.value = null;
    lastError.value = null;
    pendingConflict.value = null;
    pendingOffers.value = null;
    conflictChoices.value = {};
    introOpen.value = next.intro.length > 0;
    outroOpen.value = false;
    guideRead.value = 0;
    consoleLines.value = [];
    lineId = 0;
    emit('note', `${next.title} — help と打つと使えるコマンドが出る。`);
  }

  function restart(): void {
    if (!spec.value) return;
    const current = spec.value;
    const attempts = retries.value + 1;
    start(current, learnedAbilities);
    retries.value = attempts;
  }

  /**
   * 1 手を進める。ボタンからもコンソールからもここを通る。
   * silent なときは通知を出さない（コンソールでは行に出すため）。
   */
  function play(command: AbilityCommand, options: { silent?: boolean } = {}): boolean {
    if (!session.value) return false;
    lastError.value = null;

    const result = playAbility(session.value, command);
    if (!result.ok) {
      lastError.value = result.error;
      if (!options.silent) notify(errorMessage(result.error), 'error');
      return false;
    }

    const wasCleared = session.value.status === 'cleared';
    session.value = result.value;
    if (!wasCleared && result.value.status === 'cleared') outroOpen.value = true;
    return true;
  }

  function select(id: CommitId | null): void {
    selected.value = id;
  }

  function checkout(branch: BranchName): void {
    play({ kind: 'checkout', target: { type: 'branch', branch } });
  }

  function revertSelected(): void {
    if (!selected.value) return;
    if (play({ kind: 'revert', targetId: selected.value })) {
      notify('出来事を打ち消した。記録は残っている。');
    }
  }

  /**
   * 統合を試みる。矛盾があれば実行せず、決断を仰ぐ状態に入る。
   * conflict をエラーとして弾くのではなく、物語上の選択として提示するため。
   *
   * strategy に ours / theirs が指定されていれば、その側で一括して決着させる
   * （git merge -X ours 相当。コンソールから使う）。
   */
  function attemptMerge(
    from: BranchName,
    strategy: 'ask' | 'ours' | 'theirs' = 'ask',
    options: { silent?: boolean } = {},
  ): MergeAnalysis | null {
    if (!session.value) return null;

    const preview = previewMerge(session.value.timeline, from);
    if (!preview.ok) {
      lastError.value = preview.error;
      if (!options.silent) notify(errorMessage(preview.error), 'error');
      return null;
    }

    const conflicts =
      preview.value.kind === 'three-way' ? (preview.value.analysis?.conflicts ?? []) : [];

    if (conflicts.length > 0) {
      if (strategy === 'ask') {
        pendingConflict.value = {
          kind: 'merge',
          source: from,
          analysis: preview.value.analysis as MergeAnalysis,
        };
        conflictChoices.value = {};
        return preview.value.analysis as MergeAnalysis;
      }
      const resolutions: Record<FactKey, ConflictResolution> = {};
      for (const conflict of conflicts) resolutions[conflict.key] = { type: strategy };
      if (play({ kind: 'merge', from, resolutions }, options) && !options.silent) {
        notify('二つの世界線が一つに束ねられた。');
      }
      return null;
    }

    if (play({ kind: 'merge', from }, options) && !options.silent) {
      notify('世界線を統合した。');
    }
    return null;
  }

  /**
   * 別の世界線の出来事を 1 つだけ持ち込む。
   * merge と同じく矛盾が起こりうるので、決断の扱いも共通にする。
   */
  function attemptCherryPick(
    targetId: CommitId,
    strategy: 'ask' | 'ours' | 'theirs' = 'ask',
    options: { silent?: boolean } = {},
  ): MergeAnalysis | null {
    if (!session.value) return null;

    const preview = previewCherryPick(session.value.timeline, targetId);
    if (!preview.ok) {
      lastError.value = preview.error;
      if (!options.silent) notify(errorMessage(preview.error), 'error');
      return null;
    }

    const conflicts = preview.value.conflicts;
    if (conflicts.length > 0) {
      if (strategy === 'ask') {
        pendingConflict.value = {
          kind: 'cherry-pick',
          source: targetId,
          analysis: preview.value,
        };
        conflictChoices.value = {};
        return preview.value;
      }
      const resolutions: Record<FactKey, ConflictResolution> = {};
      for (const conflict of conflicts) resolutions[conflict.key] = { type: strategy };
      if (play({ kind: 'cherry-pick', targetId, resolutions }, options) && !options.silent) {
        notify('別の世界線の出来事を持ち込んだ。');
      }
      return null;
    }

    if (play({ kind: 'cherry-pick', targetId }, options) && !options.silent) {
      notify('別の世界線の出来事を持ち込んだ。');
    }
    return null;
  }

  /** 選ばれた出来事を実際に刻む。 */
  function commitOffer(offer: CommitOffer, options: { silent?: boolean } = {}): void {
    pendingOffers.value = null;
    const command: AbilityCommand = {
      kind: 'commit',
      message: offer.message,
      changes: offer.changes,
      ...(offer.narrative === undefined ? {} : { narrative: offer.narrative }),
    };
    if (play(command, options) && !options.silent) notify('新たな出来事を刻んだ。');
  }

  /**
   * 出来事を刻む。候補が複数あれば、どれを起こすか選んでもらう。
   * 候補はステージ側が用意する（世界に対して何を起こせるかは物語が決めるため）。
   */
  function attemptCommit(
    offerId?: string,
    options: { silent?: boolean } = {},
  ): readonly CommitOffer[] | null {
    const offers = spec.value?.offers ?? [];
    if (offers.length === 0) {
      if (!options.silent) notify('いま刻める出来事はない。', 'error');
      return null;
    }

    const chosen = offerId
      ? offers.find((offer) => offer.id === offerId)
      : offers.length === 1
        ? offers[0]
        : undefined;

    if (!chosen) {
      if (offerId && !options.silent) notify('その出来事は用意されていない。', 'error');
      if (offerId) return null;
      pendingOffers.value = offers;
      return offers;
    }

    commitOffer(chosen, options);
    return null;
  }

  function cancelOffers(): void {
    pendingOffers.value = null;
  }

  /**
   * いまの世界線を、別の世界線の上に並べ直す。
   * 矛盾の扱いは merge と同じだが、ours / theirs の向きが逆になる点に注意。
   */
  function attemptRebase(
    onto: BranchName,
    strategy: 'ask' | 'ours' | 'theirs' = 'ask',
    options: { silent?: boolean } = {},
  ): MergeAnalysis | null {
    if (!session.value) return null;

    const preview = previewRebase(session.value.timeline, onto);
    if (!preview.ok) {
      lastError.value = preview.error;
      if (!options.silent) notify(errorMessage(preview.error), 'error');
      return null;
    }

    const analysis = preview.value.analysis;
    if (analysis && analysis.conflicts.length > 0) {
      if (strategy === 'ask') {
        pendingConflict.value = { kind: 'rebase', source: onto, analysis };
        conflictChoices.value = {};
        return analysis;
      }
      const resolutions: Record<FactKey, ConflictResolution> = {};
      for (const conflict of analysis.conflicts) resolutions[conflict.key] = { type: strategy };
      if (play({ kind: 'rebase', onto, resolutions }, options) && !options.silent) {
        notify('出来事を並べ直した。');
      }
      return null;
    }

    if (play({ kind: 'rebase', onto }, options) && !options.silent) {
      notify('出来事を並べ直した。元の並びは reflog から辿れる。');
    }
    return null;
  }

  function decide(key: FactKey, resolution: ConflictResolution): void {
    conflictChoices.value = { ...conflictChoices.value, [key]: resolution };
  }

  function commitConflict(): void {
    const pending = pendingConflict.value;
    if (!pending || !allConflictsDecided.value) return;

    const { kind, source } = pending;
    const resolutions = conflictChoices.value;
    pendingConflict.value = null;
    conflictChoices.value = {};

    const silent = inputMode.value === 'console';
    const command: AbilityCommand =
      kind === 'merge'
        ? { kind: 'merge', from: source, resolutions }
        : kind === 'rebase'
          ? { kind: 'rebase', onto: source, resolutions }
          : { kind: 'cherry-pick', targetId: source, resolutions };

    if (play(command, { silent })) {
      const line =
        kind === 'merge'
          ? `Merge branch ${source}`
          : kind === 'rebase'
            ? `Successfully rebased onto ${source}`
            : `[cherry-pick] ${source}`;
      if (silent) emit('output', line);
      else {
        notify(
          kind === 'merge'
            ? '二つの世界線が一つに束ねられた。'
            : kind === 'rebase'
              ? '出来事を並べ直した。元の並びは reflog から辿れる。'
              : 'その出来事だけが、この世界に移された。',
        );
      }
    }
  }

  function cancelConflict(): void {
    pendingConflict.value = null;
    conflictChoices.value = {};
    if (inputMode.value === 'console') emit('note', '決断を保留した。');
  }

  function undo(): void {
    if (!session.value || !canUndo.value) return;
    session.value = undoSession(session.value);
    outroOpen.value = false;
  }

  function revealHint(): string | null {
    const hints = spec.value?.hints;
    if (!hints || hints.length === 0) return null;
    const index = Math.min(hintsRevealed.value, hints.length - 1);
    hintsRevealed.value = index + 1;
    const hint = hints[index] as string;
    notify(hint);
    return hint;
  }

  function dismissNotice(): void {
    notice.value = null;
  }

  // --- コンソール入力 -------------------------------------------------------

  /** 実行した手の結果を、git らしい一行にする。 */
  function describeResult(command: AbilityCommand): string {
    const current = session.value;
    if (!current) return '';

    switch (command.kind) {
      case 'revert': {
        const head = resolveHead(current.timeline);
        const id = head.ok ? head.value : '';
        return `[${current.timeline.head.type === 'branch' ? current.timeline.head.branch : 'detached'} ${id}] ${current.timeline.commits[id]?.message ?? ''}`;
      }
      case 'checkout':
        return command.target.type === 'branch'
          ? `Switched to branch '${command.target.branch}'`
          : `HEAD is now at ${command.target.commitId}`;
      case 'branch':
        return `Created branch '${command.name}'`;
      case 'delete-branch':
        return `Deleted branch ${command.name}`;
      case 'reset': {
        const message = current.timeline.commits[command.targetId]?.message ?? '';
        return `HEAD is now at ${command.targetId} ${message}`;
      }
      case 'commit': {
        const head = resolveHead(current.timeline);
        const id = head.ok ? head.value : '';
        const message = current.timeline.commits[id]?.message ?? command.message;
        const branch =
          current.timeline.head.type === 'branch' ? current.timeline.head.branch : 'detached';
        return `[${branch} ${id}] ${message}`;
      }
      case 'merge':
        return 'Merge made by the three-way strategy.';
      case 'cherry-pick':
        return `[cherry-pick] ${command.targetId}`;
      case 'rebase':
        return `Successfully rebased onto ${command.onto}`;
      case 'tag':
        return `Tagged '${command.name}'`;
      case 'delete-tag':
        return `Deleted tag '${command.name}'`;
    }
  }

  function reportConflicts(
    kind: 'merge' | 'cherry-pick' | 'rebase',
    source: string,
    analysis: MergeAnalysis,
  ): void {
    const current = session.value;
    if (!current) return;

    emit('error', `CONFLICT: ${analysis.conflicts.length} 箇所で現実が食い違っている。`);
    for (const conflict of analysis.conflicts) {
      const name = factLabel(current.spec, conflict.key);
      emit(
        'output',
        `  ${name}: ours=${valueLabel(current.spec, conflict.ours)} / theirs=${valueLabel(current.spec, conflict.theirs)}`,
      );
    }
    emit(
      'note',
      kind === 'cherry-pick'
        ? '表示された選択肢から、どちらの現実を採るか決める。'
        : `決断を選ぶか、git ${kind} ${source} --ours / --theirs でまとめて決着できる。`,
    );
  }

  /** コンソールの 1 行を実行する。 */
  function runCommand(input: string): void {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;

    emit('input', trimmed);
    commandHistory.value = [...commandHistory.value, trimmed];

    if (!session.value) return;

    const parsed = parseCommand(trimmed);
    if (!parsed.ok) {
      const message = parseErrorMessage(parsed.error);
      if (message) emit('error', message);
      return;
    }

    const action = parsed.value;

    if (action.kind === 'query') {
      const lines = renderQuery(action.query, session.value);
      emit('output', lines.length > 0 ? lines : ['(なし)']);
      return;
    }

    if (action.kind === 'diff') {
      // 引数の数で「何と何を比べるか」を決める。
      // 2 つ → そのまま / 1 つ → 現在地と比べる / 0 個 → 選んでいる時点とその親
      const head = headCommit.value;
      let from = action.from;
      let to = action.to;
      if (from && !to) {
        to = from;
        from = head ?? undefined;
      }
      if (!from && !to) {
        const target = selected.value ?? head;
        const parent = target
          ? session.value.timeline.commits[target]?.parents[0]
          : undefined;
        from = parent ?? target ?? undefined;
        to = target ?? undefined;
      }
      if (!from || !to) {
        emit('error', 'diff: 比べる時点が決まらない。git diff <a> <b> のように指定する。');
        return;
      }
      emit('output', renderDiff(session.value, from, to));
      return;
    }

    if (action.kind === 'rebase') {
      const analysis = attemptRebase(action.onto, action.strategy, { silent: true });
      if (analysis) {
        reportConflicts('rebase', action.onto, analysis);
        return;
      }
      if (lastError.value) {
        emit('error', errorMessage(lastError.value));
        return;
      }
      emit('output', `Successfully rebased onto ${action.onto}`);
      return;
    }

    if (action.kind === 'merge') {
      const analysis = attemptMerge(action.from, action.strategy, { silent: true });
      if (analysis) {
        reportConflicts('merge', action.from, analysis);
        return;
      }
      if (lastError.value) {
        emit('error', errorMessage(lastError.value));
        return;
      }
      emit('output', 'Merge made by the three-way strategy.');
      return;
    }

    if (action.kind === 'commit') {
      const offers = attemptCommit(action.offerId, { silent: true });
      if (offers) {
        emit('output', '刻める出来事が複数ある。番号ではなく名前で指定する:');
        for (const offer of offers) emit('output', `  ${offer.id}  ${offer.message}`);
        emit('note', 'git commit <名前> のように指定する。');
        return;
      }
      if (lastError.value) {
        emit('error', errorMessage(lastError.value));
        return;
      }
      emit('output', describeResult({ kind: 'commit', message: '', changes: {} }));
      return;
    }

    if (action.command.kind === 'cherry-pick') {
      const targetId = action.command.targetId;
      const analysis = attemptCherryPick(targetId, 'ask', { silent: true });
      if (analysis) {
        reportConflicts('cherry-pick', targetId, analysis);
        return;
      }
      if (lastError.value) {
        emit('error', errorMessage(lastError.value));
        return;
      }
      emit('output', `[cherry-pick] ${targetId}`);
      return;
    }

    if (play(action.command, { silent: true })) {
      emit('output', describeResult(action.command));
      if (action.command.kind === 'revert') {
        emit('note', 'その出来事は打ち消された。ただし、起きたという記録は残る。');
      }
    } else if (lastError.value) {
      emit('error', errorMessage(lastError.value));
    }
  }

  return {
    // state
    session,
    selected,
    notice,
    introOpen,
    outroOpen,
    pendingConflict,
    pendingOffers,
    conflictChoices,
    hintsRevealed,
    retries,
    inputMode,
    consoleLines,
    commandHistory,
    guideRead,
    // getters
    spec,
    timeline,
    report,
    cleared,
    canUndo,
    usedHint,
    headCommit,
    focusedCommit,
    branches,
    mergeableBranches,
    allConflictsDecided,
    guide,
    // actions
    start,
    restart,
    play,
    select,
    checkout,
    revertSelected,
    attemptMerge,
    attemptCherryPick,
    attemptRebase,
    attemptCommit,
    commitOffer,
    cancelOffers,
    decide,
    commitConflict,
    cancelConflict,
    undo,
    revealHint,
    notify,
    dismissNotice,
    runCommand,
    acknowledgeGuide,
    setMode,
    toggleMode,
  };
});
