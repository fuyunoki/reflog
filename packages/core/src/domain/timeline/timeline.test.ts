import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { unwrap } from '../shared/result.ts';
import { expectErr } from '../../testing.ts';
import {
  ancestorsOf,
  currentWorldState,
  isAncestorOf,
  mergeBase,
  orphanedCommits,
  worldStateAt,
} from './graph.ts';
import { threeWayMerge } from './merge.ts';
import {
  checkout,
  cherryPick,
  commit,
  createTag,
  deleteTag,
  createBranch,
  createTimeline,
  merge,
  previewCherryPick,
  previewMerge,
  rebase,
  recoverableCommits,
  reset,
  revert,
} from './operations.ts';
import type { TimelineState } from './types.ts';

/** 「英雄が生きている世界」から始まる基本のタイムライン。 */
const baseTimeline = (): TimelineState =>
  createTimeline({
    initialFacts: { 'hero.alive': 'true', 'lab.status': 'operating' },
    rootMessage: '観測開始',
  });

describe('createTimeline', () => {
  it('ルートコミットと初期ブランチを持つ', () => {
    const state = baseTimeline();
    assert.equal(Object.keys(state.commits).length, 1);
    assert.deepEqual(state.head, { type: 'branch', branch: 'main' });
    assert.equal(state.branches.main, 'c1');
    assert.deepEqual(unwrap(currentWorldState(state)), {
      'hero.alive': 'true',
      'lab.status': 'operating',
    });
  });

  it('ルートコミットは親を持たない', () => {
    const state = baseTimeline();
    assert.deepEqual(state.commits.c1?.parents, []);
  });
});

describe('commit', () => {
  it('世界状態を更新し、ブランチを進める', () => {
    const state = unwrap(
      commit(baseTimeline(), {
        message: '事故が起きる',
        changes: { 'lab.status': 'destroyed' },
      }),
    );
    assert.equal(state.branches.main, 'c2');
    assert.deepEqual(unwrap(currentWorldState(state)), {
      'hero.alive': 'true',
      'lab.status': 'destroyed',
    });
  });

  it('null を指定すると事実が消滅する', () => {
    const state = unwrap(
      commit(baseTimeline(), {
        message: '研究所が消える',
        changes: { 'lab.status': null },
      }),
    );
    const world = unwrap(currentWorldState(state));
    assert.equal('lab.status' in world, false);
    assert.equal(world['hero.alive'], 'true');
  });

  it('実質的な変更がなければ NothingToCommit', () => {
    const result = commit(baseTimeline(), {
      message: '何も起きない',
      changes: { 'hero.alive': 'true' },
    });
    expectErr(result, 'NothingToCommit');
  });

  it('元の状態を書き換えない（不変性）', () => {
    const before = baseTimeline();
    const snapshot = JSON.stringify(before);
    unwrap(commit(before, { message: 'x', changes: { k: 'v' } }));
    assert.equal(JSON.stringify(before), snapshot);
  });
});

/**
 * 分岐したタイムラインを作る。
 *
 *   c1 ── c2 (main)
 *    └──── c3 (alt)
 */
const divergent = (
  oursChanges: Record<string, string | null>,
  theirsChanges: Record<string, string | null>,
): TimelineState => {
  let state = baseTimeline();
  state = unwrap(createBranch(state, 'alt'));
  state = unwrap(commit(state, { message: 'ours', changes: oursChanges }));
  state = unwrap(checkout(state, { type: 'branch', branch: 'alt' }));
  state = unwrap(commit(state, { message: 'theirs', changes: theirsChanges }));
  return unwrap(checkout(state, { type: 'branch', branch: 'main' }));
};

describe('graph', () => {
  it('祖先集合は自分自身を含む', () => {
    const state = baseTimeline();
    assert.deepEqual([...ancestorsOf(state, 'c1')], ['c1']);
  });

  it('分岐した枝は互いに祖先ではない', () => {
    const state = divergent({ a: '1' }, { b: '1' });
    const mainTip = state.branches.main as string;
    const altTip = state.branches.alt as string;
    assert.equal(isAncestorOf(state, mainTip, altTip), false);
    assert.equal(isAncestorOf(state, altTip, mainTip), false);
    assert.equal(isAncestorOf(state, 'c1', mainTip), true);
  });

  it('merge base は分岐点になる', () => {
    const state = divergent({ a: '1' }, { b: '1' });
    const found = unwrap(
      mergeBase(state, state.branches.main as string, state.branches.alt as string),
    );
    assert.equal(found, 'c1');
  });
});

describe('threeWayMerge', () => {
  it('片方だけが変更したキーは自動で採用される', () => {
    const analysis = threeWayMerge({ k: 'base' }, { k: 'base' }, { k: 'theirs' });
    assert.deepEqual(analysis.conflicts, []);
    assert.equal(analysis.merged.k, 'theirs');
  });

  it('双方が同じ結論に達したなら conflict にならない', () => {
    const analysis = threeWayMerge({ k: 'base' }, { k: 'same' }, { k: 'same' });
    assert.deepEqual(analysis.conflicts, []);
    assert.equal(analysis.merged.k, 'same');
  });

  it('双方が別々に変更すると conflict', () => {
    const analysis = threeWayMerge({ k: 'base' }, { k: 'ours' }, { k: 'theirs' });
    assert.equal(analysis.conflicts.length, 1);
    assert.deepEqual(analysis.conflicts[0], {
      key: 'k',
      base: 'base',
      ours: 'ours',
      theirs: 'theirs',
    });
  });

  it('片方が削除し片方が変更した場合も conflict', () => {
    const analysis = threeWayMerge({ k: 'base' }, {}, { k: 'theirs' });
    assert.equal(analysis.conflicts.length, 1);
    assert.equal(analysis.conflicts[0]?.ours, null);
  });
});

describe('merge', () => {
  it('取り込む側が祖先なら up-to-date', () => {
    let state = baseTimeline();
    state = unwrap(createBranch(state, 'alt'));
    state = unwrap(commit(state, { message: 'ours', changes: { a: '1' } }));
    const result = merge(state, { from: 'alt' });
    expectErr(result, 'AlreadyUpToDate');
  });

  it('fast-forward ではマージコミットを作らない', () => {
    let state = baseTimeline();
    state = unwrap(createBranch(state, 'alt'));
    state = unwrap(checkout(state, { type: 'branch', branch: 'alt' }));
    state = unwrap(commit(state, { message: 'theirs', changes: { a: '1' } }));
    state = unwrap(checkout(state, { type: 'branch', branch: 'main' }));

    const preview = unwrap(previewMerge(state, 'alt'));
    assert.equal(preview.kind, 'fast-forward');

    const before = Object.keys(state.commits).length;
    const merged = unwrap(merge(state, { from: 'alt' }));
    assert.equal(Object.keys(merged.commits).length, before);
    assert.equal(merged.branches.main, merged.branches.alt);
  });

  it('衝突しない変更は自動でマージされ、親を 2 つ持つ', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });
    const merged = unwrap(merge(state, { from: 'alt' }));
    const tip = merged.commits[merged.branches.main as string];
    assert.equal(tip?.parents.length, 2);
    assert.deepEqual(unwrap(currentWorldState(merged)), {
      'hero.alive': 'false',
      'lab.status': 'sealed',
    });
  });

  it('未解決の conflict があると失敗する', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'hero.alive': 'ascended' });
    const result = merge(state, { from: 'alt' });
    expectErr(result, 'MergeConflict');
    assert.deepEqual(expectErr(result, 'MergeConflict').conflicts, ['hero.alive']);
  });

  it('決断を与えれば conflict を越えてマージできる', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'hero.alive': 'ascended' });
    const merged = unwrap(
      merge(state, {
        from: 'alt',
        resolutions: { 'hero.alive': { type: 'theirs' } },
      }),
    );
    assert.equal(unwrap(currentWorldState(merged))['hero.alive'], 'ascended');
  });

  it('custom な決断で第三の現実を選べる', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'hero.alive': 'ascended' });
    const merged = unwrap(
      merge(state, {
        from: 'alt',
        resolutions: {
          'hero.alive': { type: 'custom', value: 'unknown' },
        },
      }),
    );
    assert.equal(unwrap(currentWorldState(merged))['hero.alive'], 'unknown');
  });
});

describe('revert', () => {
  it('変更を打ち消すが、歴史は残る', () => {
    let state = baseTimeline();
    state = unwrap(
      commit(state, { message: '事故', changes: { 'lab.status': 'destroyed' } }),
    );
    const before = Object.keys(state.commits).length;

    state = unwrap(revert(state, 'c2'));

    // 世界の状態は元に戻る
    assert.equal(unwrap(currentWorldState(state))['lab.status'], 'operating');
    // しかしコミットは増えている（起きた事実は消えない）
    assert.equal(Object.keys(state.commits).length, before + 1);
    assert.ok(state.commits.c2, '打ち消された出来事の記録は残る');
  });

  it('追加された事実の revert は削除になる', () => {
    let state = baseTimeline();
    state = unwrap(
      commit(state, { message: '発明', changes: { 'lab.invention': 'engine' } }),
    );
    state = unwrap(revert(state, 'c2'));
    const world = unwrap(currentWorldState(state));
    assert.equal('lab.invention' in world, false);
  });
});

describe('reset', () => {
  it('ブランチを巻き戻し、コミットを到達不能にする', () => {
    let state = baseTimeline();
    state = unwrap(commit(state, { message: '事故', changes: { x: '1' } }));
    state = unwrap(commit(state, { message: '崩壊', changes: { y: '1' } }));

    state = unwrap(reset(state, 'c1'));

    assert.equal(state.branches.main, 'c1');
    assert.deepEqual(unwrap(currentWorldState(state)), {
      'hero.alive': 'true',
      'lab.status': 'operating',
    });
    assert.deepEqual([...orphanedCommits(state)].sort(), ['c2', 'c3']);
  });

  it('切り離されたコミットは reflog から回収できる', () => {
    let state = baseTimeline();
    state = unwrap(commit(state, { message: '事故', changes: { x: '1' } }));
    const lost = state.branches.main as string;
    state = unwrap(reset(state, 'c1'));

    assert.ok(recoverableCommits(state).includes(lost));
    // 実データも保持されている
    assert.equal(unwrap(worldStateAt(state, lost)).x, '1');
  });

  it('detached HEAD では実行できない', () => {
    let state = baseTimeline();
    state = unwrap(commit(state, { message: 'x', changes: { x: '1' } }));
    state = unwrap(checkout(state, { type: 'commit', commitId: 'c1' }));
    const result = reset(state, 'c1');
    expectErr(result, 'DetachedHeadNotAllowed');
  });
});

describe('branch', () => {
  it('同名のブランチは作れない', () => {
    const result = createBranch(baseTimeline(), 'main');
    expectErr(result, 'BranchAlreadyExists');
  });

  it('存在しないブランチへの checkout は失敗する', () => {
    const result = checkout(baseTimeline(), { type: 'branch', branch: 'ghost' });
    expectErr(result, 'BranchNotFound');
  });
});

describe('cherryPick', () => {
  it('別の世界線の出来事だけを持ち込める', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });
    const altTip = state.branches.alt as string;

    const picked = unwrap(cherryPick(state, { targetId: altTip }));

    // 出来事の効果は反映される
    assert.equal(unwrap(currentWorldState(picked))['lab.status'], 'sealed');
    // こちらの世界線で起きたことは消えない
    assert.equal(unwrap(currentWorldState(picked))['hero.alive'], 'false');
  });

  it('親を 1 つしか持たない —— merge と違い履歴は繋がらない', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });
    const altTip = state.branches.alt as string;

    const picked = unwrap(cherryPick(state, { targetId: altTip }));
    const tip = picked.commits[picked.branches.main as string];

    assert.equal(tip?.parents.length, 1, 'cherry-pick は親を 1 つだけ持つ');
    assert.equal(
      isAncestorOf(picked, altTip, picked.branches.main as string),
      false,
      '取り込み元は祖先にならない',
    );
  });

  it('取り込んだ後も、元の世界線はそのまま残る', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });
    const altTip = state.branches.alt as string;
    const picked = unwrap(cherryPick(state, { targetId: altTip }));

    assert.equal(picked.branches.alt, altTip, 'alt は動かない');
  });

  it('同じ事実を書き換えていれば矛盾になる', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'hero.alive': 'ascended' });
    const altTip = state.branches.alt as string;

    const analysis = unwrap(previewCherryPick(state, altTip));
    assert.deepEqual(analysis.conflicts.map((c) => c.key), ['hero.alive']);

    expectErr(cherryPick(state, { targetId: altTip }), 'MergeConflict');

    const resolved = unwrap(
      cherryPick(state, {
        targetId: altTip,
        resolutions: { 'hero.alive': { type: 'theirs' } },
      }),
    );
    assert.equal(unwrap(currentWorldState(resolved))['hero.alive'], 'ascended');
  });

  it('すでに含まれている出来事は持ち込めない', () => {
    let state = baseTimeline();
    state = unwrap(commit(state, { message: 'x', changes: { a: '1' } }));
    expectErr(cherryPick(state, { targetId: 'c2' }), 'AlreadyApplied');
  });

  it('世界が変わらないなら積まない', () => {
    // 双方が同じ結論に達している場合、持ち込んでも何も起きない
    const state = divergent({ k: 'same' }, { k: 'same' });
    const altTip = state.branches.alt as string;
    expectErr(cherryPick(state, { targetId: altTip }), 'NothingToCommit');
  });
});

describe('tag', () => {
  it('時点に名前を付けられる', () => {
    const state = unwrap(createTag(baseTimeline(), 'baseline'));
    assert.equal(state.tags.baseline, 'c1');
  });

  it('ブランチと違って動かない —— これが tag の本質', () => {
    let state = unwrap(createTag(baseTimeline(), 'baseline'));
    state = unwrap(commit(state, { message: '次の出来事', changes: { k: 'v' } }));

    assert.equal(state.branches.main, 'c2', 'ブランチは先へ進む');
    assert.equal(state.tags.baseline, 'c1', 'タグはその時点に留まる');
  });

  it('同じ名前は二度付けられない', () => {
    const state = unwrap(createTag(baseTimeline(), 'baseline'));
    expectErr(createTag(state, 'baseline'), 'TagAlreadyExists');
  });

  it('時点を指定して付けられる', () => {
    let state = unwrap(commit(baseTimeline(), { message: 'x', changes: { k: 'v' } }));
    state = unwrap(createTag(state, 'origin', 'c1'));
    assert.equal(state.tags.origin, 'c1');
  });

  it('外せる', () => {
    let state = unwrap(createTag(baseTimeline(), 'baseline'));
    state = unwrap(deleteTag(state, 'baseline'));
    assert.equal('baseline' in state.tags, false);
    expectErr(deleteTag(state, 'baseline'), 'TagNotFound');
  });

  it('印を付けても世界は変わらない', () => {
    const before = baseTimeline();
    const after = unwrap(createTag(before, 'baseline'));
    assert.deepEqual(unwrap(currentWorldState(after)), unwrap(currentWorldState(before)));
  });
});

describe('rebase', () => {
  it('出来事が相手の世界線の上に並び直る', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });
    const rebased = unwrap(rebase(state, { onto: 'alt' }));

    // 両方の変更が乗った状態になる
    assert.deepEqual(unwrap(currentWorldState(rebased)), {
      'hero.alive': 'false',
      'lab.status': 'sealed',
    });
  });

  it('履歴が一列になる —— merge との決定的な違い', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });

    const merged = unwrap(merge(state, { from: 'alt' }));
    const mergeTip = merged.commits[merged.branches.main as string];
    assert.equal(mergeTip?.parents.length, 2, 'merge は分岐を残したまま束ねる');

    const rebased = unwrap(rebase(state, { onto: 'alt' }));
    const rebaseTip = rebased.commits[rebased.branches.main as string];
    assert.equal(rebaseTip?.parents.length, 1, 'rebase は一列に並べ直す');
    assert.equal(
      isAncestorOf(rebased, rebased.branches.alt as string, rebased.branches.main as string),
      true,
      '相手の世界線が自分の祖先になる',
    );
  });

  it('元の時点は参照を失うが、消えはしない', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'lab.status': 'sealed' });
    const original = state.branches.main as string;
    const rebased = unwrap(rebase(state, { onto: 'alt' }));

    assert.notEqual(rebased.branches.main, original, '先端は作り直された別物になる');
    assert.ok(rebased.commits[original], '元の記録は残っている');
    assert.ok(
      orphanedCommits(rebased).includes(original),
      '参照は外れる（reflog から辿れる）',
    );
  });

  it('相手が自分の祖先ならやることがない', () => {
    let state = baseTimeline();
    state = unwrap(createBranch(state, 'alt'));
    state = unwrap(commit(state, { message: 'ours', changes: { a: '1' } }));
    expectErr(rebase(state, { onto: 'alt' }), 'AlreadyUpToDate');
  });

  it('同じ事実を書き換えていれば矛盾になる', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'hero.alive': 'ascended' });
    expectErr(rebase(state, { onto: 'alt' }), 'MergeConflict');
  });

  it('ours と theirs が merge と逆になる —— 本物の git と同じ向き', () => {
    const state = divergent({ 'hero.alive': 'false' }, { 'hero.alive': 'ascended' });

    // rebase では ours が「載せ替える先」、theirs が「移動してくる側」
    const ours = unwrap(
      rebase(state, { onto: 'alt', resolutions: { 'hero.alive': { type: 'ours' } } }),
    );
    assert.equal(
      unwrap(currentWorldState(ours))['hero.alive'],
      'ascended',
      'ours は載せ替え先（alt）の値',
    );

    const theirs = unwrap(
      rebase(state, { onto: 'alt', resolutions: { 'hero.alive': { type: 'theirs' } } }),
    );
    assert.equal(
      unwrap(currentWorldState(theirs))['hero.alive'],
      'false',
      'theirs は移動してくる側（main）の値',
    );

    // merge では向きが逆であることも押さえておく
    const merged = unwrap(
      merge(state, { from: 'alt', resolutions: { 'hero.alive': { type: 'ours' } } }),
    );
    assert.equal(
      unwrap(currentWorldState(merged))['hero.alive'],
      'false',
      'merge の ours は自分（main）の値',
    );
  });

  it('統合済みの時点を含む列は並べ直せない', () => {
    let state = divergent({ a: '1' }, { b: '1' });
    state = unwrap(merge(state, { from: 'alt' }));

    // main とは別に分岐した世界線を用意する（祖先だと「やることがない」になる）
    state = unwrap(createBranch(state, 'third', 'c1'));
    state = unwrap(checkout(state, { type: 'branch', branch: 'third' }));
    state = unwrap(commit(state, { message: 'third', changes: { c: '1' } }));
    state = unwrap(checkout(state, { type: 'branch', branch: 'main' }));

    expectErr(rebase(state, { onto: 'third' }), 'CannotRebaseMerge');
  });
});
