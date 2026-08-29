/**
 * コマンド解釈の検証。
 *
 * ここで覚えた構文がそのまま実務の git で通じることが重要なので、
 * 本物の git に寄せた書き方を受け付けられているかを確かめる。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { expectErr, expectOk } from '../../testing.ts';
import { parseCommand } from './parse.ts';

describe('parseCommand', () => {
  it('git revert を解釈する', () => {
    const action = expectOk(parseCommand('git revert c2'));
    assert.deepEqual(action, {
      kind: 'ability',
      command: { kind: 'revert', targetId: 'c2' },
    });
  });

  it('コミット ID は大文字でも受ける', () => {
    const action = expectOk(parseCommand('git revert C2'));
    assert.deepEqual(action, {
      kind: 'ability',
      command: { kind: 'revert', targetId: 'c2' },
    });
  });

  it('先頭の git は省略できる', () => {
    const withGit = expectOk(parseCommand('git revert c2'));
    const without = expectOk(parseCommand('revert c2'));
    assert.deepEqual(without, withGit);
  });

  it('余分な空白を無視する', () => {
    const action = expectOk(parseCommand('   git   revert    c2   '));
    assert.deepEqual(action, {
      kind: 'ability',
      command: { kind: 'revert', targetId: 'c2' },
    });
  });

  it('git cherry-pick を解釈する', () => {
    assert.deepEqual(expectOk(parseCommand('git cherry-pick c3')), {
      kind: 'ability',
      command: { kind: 'cherry-pick', targetId: 'c3' },
    });
  });

  it('git merge は決着方法を保留したまま返す', () => {
    const action = expectOk(parseCommand('git merge observation'));
    assert.deepEqual(action, { kind: 'merge', from: 'observation', strategy: 'ask' });
  });

  it('--theirs / --ours で決着方法を指定できる', () => {
    assert.equal(expectOk(parseCommand('git merge alt --theirs')).kind, 'merge');
    const theirs = expectOk(parseCommand('git merge alt --theirs'));
    const ours = expectOk(parseCommand('git merge alt --ours'));
    assert.equal(theirs.kind === 'merge' && theirs.strategy, 'theirs');
    assert.equal(ours.kind === 'merge' && ours.strategy, 'ours');
  });

  it('checkout はブランチとコミットを見分ける', () => {
    const branch = expectOk(parseCommand('git checkout main'));
    assert.deepEqual(branch, {
      kind: 'ability',
      command: { kind: 'checkout', target: { type: 'branch', branch: 'main' } },
    });

    const commit = expectOk(parseCommand('git checkout c3'));
    assert.deepEqual(commit, {
      kind: 'ability',
      command: { kind: 'checkout', target: { type: 'commit', commitId: 'c3' } },
    });
  });

  it('switch も checkout と同じ扱いにする', () => {
    assert.deepEqual(
      expectOk(parseCommand('git switch main')),
      expectOk(parseCommand('git checkout main')),
    );
  });

  it('git branch は一覧、引数付きは作成', () => {
    assert.deepEqual(expectOk(parseCommand('git branch')), {
      kind: 'query',
      query: 'branch',
    });

    assert.deepEqual(expectOk(parseCommand('git branch alt')), {
      kind: 'ability',
      command: { kind: 'branch', name: 'alt' },
    });

    assert.deepEqual(expectOk(parseCommand('git branch alt c1')), {
      kind: 'ability',
      command: { kind: 'branch', name: 'alt', at: 'c1' },
    });
  });

  it('git branch -d は削除', () => {
    assert.deepEqual(expectOk(parseCommand('git branch -d alt')), {
      kind: 'ability',
      command: { kind: 'delete-branch', name: 'alt' },
    });
  });

  it('git reset は --hard の有無に関わらず巻き戻す', () => {
    const plain = expectOk(parseCommand('git reset c1'));
    const hard = expectOk(parseCommand('git reset --hard c1'));
    assert.deepEqual(plain, {
      kind: 'ability',
      command: { kind: 'reset', targetId: 'c1' },
    });
    assert.deepEqual(hard, plain);
  });

  it('git rebase は決着方法を保留したまま返す', () => {
    assert.deepEqual(expectOk(parseCommand('git rebase main')), {
      kind: 'rebase',
      onto: 'main',
      strategy: 'ask',
    });
    const theirs = expectOk(parseCommand('git rebase main --theirs'));
    assert.equal(theirs.kind === 'rebase' && theirs.strategy, 'theirs');
  });

  it('git tag は付ける・消す・一覧を見分ける', () => {
    assert.deepEqual(expectOk(parseCommand('git tag')), { kind: 'query', query: 'tag' });
    assert.deepEqual(expectOk(parseCommand('git tag baseline')), {
      kind: 'ability',
      command: { kind: 'tag', name: 'baseline' },
    });
    assert.deepEqual(expectOk(parseCommand('git tag baseline c2')), {
      kind: 'ability',
      command: { kind: 'tag', name: 'baseline', at: 'c2' },
    });
    assert.deepEqual(expectOk(parseCommand('git tag -d baseline')), {
      kind: 'ability',
      command: { kind: 'delete-tag', name: 'baseline' },
    });
  });

  it('git diff は引数の数で比べ方が変わる', () => {
    assert.deepEqual(expectOk(parseCommand('git diff')), { kind: 'diff' });
    assert.deepEqual(expectOk(parseCommand('git diff c2')), { kind: 'diff', from: 'c2' });
    assert.deepEqual(expectOk(parseCommand('git diff c1 c3')), {
      kind: 'diff',
      from: 'c1',
      to: 'c3',
    });
  });

  it('問い合わせ系はそのまま返す', () => {
    for (const [input, query] of [
      ['git log', 'log'],
      ['git status', 'status'],
      ['git reflog', 'reflog'],
      ['help', 'help'],
    ] as const) {
      assert.deepEqual(expectOk(parseCommand(input)), { kind: 'query', query });
    }
  });
});

describe('parseCommand のエラー', () => {
  it('空入力', () => {
    expectErr(parseCommand('   '), 'Empty');
  });

  it('知らないコマンド', () => {
    // rebase は実装済みなので、まだ無いものを使う
    const error = expectErr(parseCommand('git stash'), 'UnknownCommand');
    assert.equal(error.command, 'stash');
  });

  it('git ですらない入力', () => {
    expectErr(parseCommand('ls -la'), 'NotGit');
  });

  it('引数が足りない', () => {
    const error = expectErr(parseCommand('git revert'), 'MissingArgument');
    assert.equal(error.command, 'revert');
    assert.equal(error.expected, '<commit>');
  });

  it('知らないオプション', () => {
    const error = expectErr(parseCommand('git merge alt --squash'), 'UnknownOption');
    assert.equal(error.option, '--squash');
  });

  it('引数が多すぎる', () => {
    expectErr(parseCommand('git revert c1 c2'), 'TooManyArguments');
  });
});
