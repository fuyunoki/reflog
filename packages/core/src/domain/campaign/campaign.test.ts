/**
 * 物語の分岐と、記録の積み上げの検証。
 *
 * 「プレイヤーの決断が後の章を変える」がこのゲームの縦軸なので、
 * その仕組みが実際に効いていることを確かめる。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { expectOk } from '../../testing.ts';
import { replay } from '../../application/usecases/stageSession.ts';
import {
  emptyProgress,
  extractChoices,
  mergeProgress,
  recordClearance,
  recordMission,
  toWorldHistory,
} from '../../application/usecases/progress.ts';
import {
  campaignProgress,
  evaluateCondition,
  nextStage,
  resolveEpisode,
  unlockedChapters,
} from './condition.ts';
import type { CampaignSpec, WorldHistory } from './types.ts';
import type { StageSpec } from '../stage/spec.ts';

// --- 分岐を含む最小のステージ ------------------------------------------------

const forkStage: StageSpec = {
  id: 'test-fork',
  title: '分岐の検証',
  chapter: { number: 1, title: 'テスト' },
  intro: [],
  initialFacts: { 'subject.alive': 'true' },
  rootMessage: 'root',
  setup: [
    { kind: 'branch', name: 'alt', at: 'c1' },
    {
      kind: 'commit',
      message: '死亡が確定する',
      changes: { 'subject.alive': 'false' },
    },
    { kind: 'checkout', target: { type: 'branch', branch: 'alt' } },
    {
      kind: 'commit',
      message: '別世界では昇華した',
      changes: { 'subject.alive': 'ascended' },
    },
    { kind: 'checkout', target: { type: 'branch', branch: 'main' } },
  ],
  goals: [
    {
      id: 'decided',
      label: 'どちらかの現実に決着させる',
      predicate: {
        type: 'or',
        any: [
          { type: 'factEquals', key: 'subject.alive', value: 'false' },
          { type: 'factEquals', key: 'subject.alive', value: 'ascended' },
        ],
      },
    },
  ],
  abilities: ['checkout', 'merge', 'revert'],
};

const clearWith = (side: 'ours' | 'theirs') =>
  expectOk(
    replay(forkStage, [
      { kind: 'merge', from: 'alt', resolutions: { 'subject.alive': { type: side } } },
    ]),
  );

describe('決断の記録', () => {
  it('conflict の決断が、採用された値とともに残る', () => {
    const session = clearWith('theirs');
    const choices = extractChoices('test-fork', session, '2026-01-01T00:00:00.000Z');

    assert.equal(choices.length, 1);
    assert.deepEqual(choices[0], {
      stageId: 'test-fork',
      key: 'subject.alive',
      side: 'theirs',
      value: 'ascended',
      at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('ours を選べば別の値が記録される', () => {
    const choices = extractChoices('test-fork', clearWith('ours'));
    assert.equal(choices[0]?.side, 'ours');
    assert.equal(choices[0]?.value, 'false');
  });

  it('クリアすると記録と決断の両方が積まれる', () => {
    const progress = recordClearance(
      emptyProgress('p1'),
      'test-fork',
      clearWith('theirs'),
    );
    assert.equal(progress.records['test-fork']?.cleared, true);
    assert.equal(progress.choices.length, 1);
  });

  it('より良い結果でなければ記録は更新されない', () => {
    let progress = recordClearance(emptyProgress('p1'), 'test-fork', clearWith('ours'));
    const firstAt = progress.records['test-fork']?.clearedAt;

    // 同じ手数のもう一度のクリア（改善なし）
    progress = recordClearance(progress, 'test-fork', clearWith('theirs'));
    assert.equal(progress.records['test-fork']?.clearedAt, firstAt);
    // ただし決断そのものは積まれる
    assert.equal(progress.choices.length, 2);
  });
});

describe('分岐条件', () => {
  const history = (side: 'ours' | 'theirs'): WorldHistory =>
    toWorldHistory(recordClearance(emptyProgress('p1'), 'test-fork', clearWith(side)));

  it('どちら側を選んだかで条件が変わる', () => {
    const cond = {
      type: 'choseSide' as const,
      stageId: 'test-fork',
      key: 'subject.alive',
      side: 'theirs' as const,
    };
    assert.equal(evaluateCondition(history('theirs'), cond), true);
    assert.equal(evaluateCondition(history('ours'), cond), false);
  });

  it('採用された値でも条件を書ける', () => {
    const cond = {
      type: 'choseValue' as const,
      stageId: 'test-fork',
      key: 'subject.alive',
      value: 'ascended',
    };
    assert.equal(evaluateCondition(history('theirs'), cond), true);
    assert.equal(evaluateCondition(history('ours'), cond), false);
  });

  it('and / or / not が組める', () => {
    const h = history('theirs');
    assert.equal(
      evaluateCondition(h, {
        type: 'and',
        all: [
          { type: 'stageCleared', stageId: 'test-fork' },
          { type: 'not', of: { type: 'stageCleared', stageId: 'other' } },
        ],
      }),
      true,
    );
    assert.equal(evaluateCondition(h, { type: 'always' }), true);
  });
});

describe('章の進行', () => {
  const campaign: CampaignSpec = {
    chapters: [
      { number: 1, title: '世界線という概念', stages: ['test-fork'] },
      {
        number: 2,
        title: '消したものの行方',
        stages: ['ch2-01'],
        unlockedBy: { type: 'stageCleared', stageId: 'test-fork' },
      },
      {
        number: 3,
        title: '昇華した者',
        stages: ['ch3-alt'],
        unlockedBy: {
          type: 'choseValue',
          stageId: 'test-fork',
          key: 'subject.alive',
          value: 'ascended',
        },
      },
    ],
  };

  const historyOf = (side: 'ours' | 'theirs'): WorldHistory =>
    toWorldHistory(recordClearance(emptyProgress('p1'), 'test-fork', clearWith(side)));

  it('未クリアなら第 1 章しか開いていない', () => {
    const open = unlockedChapters(toWorldHistory(emptyProgress('p1')), campaign);
    assert.deepEqual(open.map((c) => c.number), [1]);
  });

  it('決断によって開く章が変わる', () => {
    assert.deepEqual(
      unlockedChapters(historyOf('theirs'), campaign).map((c) => c.number),
      [1, 2, 3],
      'ascended を選ぶと第 3 章が開く',
    );
    assert.deepEqual(
      unlockedChapters(historyOf('ours'), campaign).map((c) => c.number),
      [1, 2],
      '別の決断では第 3 章は開かない',
    );
  });

  it('次に挑むステージを提示できる', () => {
    assert.equal(nextStage(toWorldHistory(emptyProgress('p1')), campaign), 'test-fork');
    assert.equal(nextStage(historyOf('ours'), campaign), 'ch2-01');
  });

  it('到達率を計算できる', () => {
    assert.equal(campaignProgress(toWorldHistory(emptyProgress('p1')), campaign), 0);
    assert.ok(campaignProgress(historyOf('ours'), campaign) > 0);
  });

  it('分岐エピソードは条件に合う最初の候補を配信する', () => {
    const episode = {
      slot: 'ch2-mid',
      candidates: [
        {
          stageId: 'ch2-mid-ascended',
          when: {
            type: 'choseValue' as const,
            stageId: 'test-fork',
            key: 'subject.alive',
            value: 'ascended',
          },
        },
        { stageId: 'ch2-mid-default', when: { type: 'always' as const } },
      ],
    };
    assert.equal(resolveEpisode(historyOf('theirs'), episode), 'ch2-mid-ascended');
    assert.equal(resolveEpisode(historyOf('ours'), episode), 'ch2-mid-default');
  });
});

describe('記録の統合（未ログイン分の引き継ぎ）', () => {
  it('ステージごとに良い方の記録が残る', () => {
    const local = recordClearance(emptyProgress('local'), 'test-fork', clearWith('ours'));
    const remote = {
      ...emptyProgress('p1'),
      records: {
        'test-fork': {
          stageId: 'test-fork',
          cleared: true,
          perfect: false,
          bestMoves: 9,
          bestCausalLoad: 20,
          bestSolution: [],
          clearedAt: '2020-01-01T00:00:00.000Z',
        },
      },
    };

    const merged = mergeProgress(local, remote);
    assert.equal(merged.playerId, 'p1', 'アカウント側の ID を採る');
    assert.equal(merged.records['test-fork']?.bestMoves, 1, '手数の少ない方が残る');
  });

  it('決断はどちらも失われず、時系列で束ねられる', () => {
    const a = recordClearance(
      emptyProgress('local'), 'test-fork', clearWith('ours'), '2026-01-02T00:00:00.000Z',
    );
    const b = recordClearance(
      emptyProgress('p1'), 'test-fork', clearWith('theirs'), '2026-01-01T00:00:00.000Z',
    );

    const merged = mergeProgress(a, b);
    assert.equal(merged.choices.length, 2);
    assert.equal(merged.choices[0]?.side, 'theirs', '古い決断が先に来る');
    assert.equal(merged.choices[1]?.side, 'ours');
  });

  it('同じ決断が二重に積まれない', () => {
    const one = recordClearance(
      emptyProgress('p1'), 'test-fork', clearWith('ours'), '2026-01-01T00:00:00.000Z',
    );
    const merged = mergeProgress(one, one);
    assert.equal(merged.choices.length, 1);
  });
});

describe('観測任務の記録', () => {
  const good = { cleared: true, moveOverhead: 0, usedHint: false, retries: 0 };

  it('任務番号が進む', () => {
    const p = recordMission(emptyProgress('p1'), good);
    assert.equal(p.nextMissionNumber, 2);
    assert.equal(p.missionLog.length, 1);
  });

  it('好成績が続くと警戒度が上がる', () => {
    let p = emptyProgress('p1');
    assert.equal(p.currentDifficulty, 'quiet');
    for (let i = 0; i < 3; i += 1) p = recordMission(p, good);
    assert.equal(p.currentDifficulty, 'standard');
  });

  it('記録は無限には伸びない', () => {
    let p = emptyProgress('p1');
    for (let i = 0; i < 40; i += 1) p = recordMission(p, good);
    assert.ok(p.missionLog.length <= 20);
    assert.equal(p.nextMissionNumber, 41);
  });
});
