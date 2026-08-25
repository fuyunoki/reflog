import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveGuide, type GuideInput, type GuideStep } from './guide.ts';
import type { GoalReport } from './goal.ts';

const report = (statuses: { id: string; satisfied: boolean }[]): GoalReport => ({
  cleared: statuses.every((s) => s.satisfied),
  perfect: statuses.every((s) => s.satisfied),
  statuses: statuses.map((s) => ({ ...s, label: s.id, optional: false })),
});

const input = (over: Partial<GuideInput> = {}): GuideInput => ({
  selected: null,
  commands: [],
  report: report([{ id: 'g1', satisfied: false }]),
  cleared: false,
  acknowledged: 0,
  ...over,
});

const steps: GuideStep[] = [
  { text: '読む段', until: { type: 'acknowledged' } },
  { text: '時点を選ぶ', until: { type: 'commitSelected', commitId: 'c2' } },
  { text: 'revert する', until: { type: 'abilityUsed', ability: 'revert' } },
  { text: 'クリアする', until: { type: 'cleared' } },
];

describe('resolveGuide', () => {
  it('手引きが無ければ最初から終わっている', () => {
    const state = resolveGuide(undefined, input());
    assert.equal(state.current, null);
    assert.equal(state.finished, true);
  });

  it('満たしていない最初の段を返す', () => {
    const state = resolveGuide(steps, input());
    assert.equal(state.current?.text, '読む段');
    assert.equal(state.index, 0);
    assert.equal(state.total, 4);
  });

  it('読んだら次へ進む', () => {
    const state = resolveGuide(steps, input({ acknowledged: 1 }));
    assert.equal(state.current?.text, '時点を選ぶ');
  });

  it('指定した時点を選ぶまで進まない', () => {
    const other = resolveGuide(steps, input({ acknowledged: 1, selected: 'c9' }));
    assert.equal(other.current?.text, '時点を選ぶ');

    const right = resolveGuide(steps, input({ acknowledged: 1, selected: 'c2' }));
    assert.equal(right.current?.text, 'revert する');
  });

  it('能力を使うと進む', () => {
    const state = resolveGuide(
      steps,
      input({
        acknowledged: 1,
        selected: 'c2',
        commands: [{ kind: 'revert', targetId: 'c2' }],
      }),
    );
    assert.equal(state.current?.text, 'クリアする');
  });

  it('クリアするとすべて終わる', () => {
    const state = resolveGuide(
      steps,
      input({
        acknowledged: 1,
        selected: 'c2',
        commands: [{ kind: 'revert', targetId: 'c2' }],
        cleared: true,
      }),
    );
    assert.equal(state.current, null);
    assert.equal(state.finished, true);
  });

  it('達成条件でも進められる', () => {
    const goalSteps: GuideStep[] = [
      { text: '条件を満たす', until: { type: 'goalSatisfied', goalId: 'g1' } },
    ];
    assert.equal(resolveGuide(goalSteps, input()).current?.text, '条件を満たす');
    assert.equal(
      resolveGuide(goalSteps, input({ report: report([{ id: 'g1', satisfied: true }]) }))
        .finished,
      true,
    );
  });

  it('巻き戻せば手引きも戻る（状態を別に持たないため）', () => {
    const advanced = resolveGuide(
      steps,
      input({ acknowledged: 1, selected: 'c2', commands: [{ kind: 'revert', targetId: 'c2' }] }),
    );
    assert.equal(advanced.current?.text, 'クリアする');

    // アンドゥでコマンドが消えた状態
    const rolledBack = resolveGuide(steps, input({ acknowledged: 1, selected: 'c2' }));
    assert.equal(rolledBack.current?.text, 'revert する');
  });
});
