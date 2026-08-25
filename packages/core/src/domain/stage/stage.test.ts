/**
 * ステージが「パズルとして成立しているか」の検証。
 *
 * 単なる実装テストではなく、ゲームデザインの検証を兼ねている。
 * - 想定解で解けること
 * - 手抜きの解法では解けないこと
 * - 誤答ルートがプレイヤーに何かを教えること
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { unwrap } from '../shared/result.ts';
import { expectErr } from '../../testing.ts';
import { currentWorldState } from '../timeline/graph.ts';
import { previewMerge } from '../timeline/operations.ts';
import { playAbility, replay, startStage } from '../../application/usecases/stageSession.ts';
import type { StageSpec } from './spec.ts';
import type { AbilityCommand } from '../ability/types.ts';

const stagePath = fileURLToPath(
  new URL('../../../../../content/stages/ch1-01.json', import.meta.url),
);
const spec = JSON.parse(readFileSync(stagePath, 'utf-8')) as StageSpec;

describe('ch1-01 白鷺研究所の火災', () => {
  it('初期盤面が意図通りに組み上がる', () => {
    const session = unwrap(startStage(spec));

    // main は火災後、observation は装置完成の世界線
    assert.equal(session.timeline.branches.main, 'c2');
    assert.equal(session.timeline.branches.observation, 'c3');
    assert.deepEqual(session.timeline.head, { type: 'branch', branch: 'main' });

    assert.deepEqual(unwrap(currentWorldState(session.timeline)), {
      'kirishima.alive': 'false',
      'lab.device': 'sealed',
      'lab.status': 'closed',
    });

    assert.equal(session.status, 'playing');
    assert.equal(session.report.cleared, false);
  });

  it('想定解（revert してから merge）でクリアできる', () => {
    const solution: AbilityCommand[] = [
      { kind: 'revert', targetId: 'c2' },
      { kind: 'merge', from: 'observation' },
    ];

    const session = unwrap(replay(spec, solution));

    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true, '任意条件も含めて達成できる');
    assert.equal(session.movesUsed, 2);
    assert.ok(session.causalLoad <= (spec.causalLoadLimit ?? Infinity));

    assert.deepEqual(unwrap(currentWorldState(session.timeline)), {
      'kirishima.alive': 'true',
      'lab.device': 'complete',
      'lab.status': 'operating',
    });
  });

  it('順序を誤ると conflict が起きる —— これがプレイヤーへの教示になる', () => {
    const session = unwrap(startStage(spec));

    // revert せずにいきなり merge すると、装置の状態が食い違う
    const preview = unwrap(previewMerge(session.timeline, 'observation'));
    assert.equal(preview.kind, 'three-way');
    assert.deepEqual(
      preview.analysis?.conflicts.map((c) => c.key),
      ['lab.device'],
    );

    const result = playAbility(session, { kind: 'merge', from: 'observation' });
    expectErr(result, 'MergeConflict');
  });

  it('conflict を解決しても、それだけではクリアできない', () => {
    // 「装置は完成した」を選んでも、霧島の生死は火災のまま覆らない。
    // conflict の解決は万能ではない、と気づかせるための経路。
    const session = unwrap(
      replay(spec, [
        {
          kind: 'merge',
          from: 'observation',
          resolutions: { 'lab.device': { type: 'theirs' } },
        },
      ]),
    );

    assert.equal(session.status, 'playing');
    assert.equal(unwrap(currentWorldState(session.timeline))['lab.device'], 'complete');
    assert.equal(unwrap(currentWorldState(session.timeline))['kirishima.alive'], 'false');

    const statuses = Object.fromEntries(
      session.report.statuses.map((s) => [s.id, s.satisfied]),
    );
    assert.equal(statuses['device-complete'], true);
    assert.equal(statuses['kirishima-alive'], false);
  });

  it('reset による力技は封じられている', () => {
    const session = unwrap(startStage(spec));
    const result = playAbility(session, { kind: 'reset', targetId: 'c1' });
    expectErr(result, 'AbilityNotAvailable');
  });

  it('手数制限を超えると弾かれる', () => {
    const limited: StageSpec = { ...spec, moveLimit: 1 };
    const session = unwrap(startStage(limited));
    const first = unwrap(playAbility(session, { kind: 'revert', targetId: 'c2' }));
    const second = playAbility(first, { kind: 'merge', from: 'observation' });

    expectErr(second, 'MoveLimitExceeded');
  });

  it('アンドゥで直前の状態に戻れる', () => {
    const session = unwrap(startStage(spec));
    const after = unwrap(playAbility(session, { kind: 'revert', targetId: 'c2' }));

    assert.equal(after.movesUsed, 1);
    assert.notEqual(
      JSON.stringify(after.timeline),
      JSON.stringify(session.timeline),
    );

    // 進行状態を戻しても、盤面は開始時と一致する
    const rolledBack = after.past[after.past.length - 1];
    assert.equal(
      JSON.stringify(rolledBack?.timeline),
      JSON.stringify(session.timeline),
    );
  });
});
