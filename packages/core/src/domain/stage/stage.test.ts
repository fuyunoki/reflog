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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { unwrap } from '../shared/result.ts';
import { expectErr, expectOk } from '../../testing.ts';
import { currentWorldState, orphanedCommits } from '../timeline/graph.ts';
import { previewMerge } from '../timeline/operations.ts';
import { playAbility, replay, startStage } from '../../application/usecases/stageSession.ts';
import type { StageSpec } from './spec.ts';
import type { AbilityCommand } from '../ability/types.ts';

const stagePath = fileURLToPath(
  new URL('../../../../../content/stages/ch1-01.json', import.meta.url),
);
const spec = JSON.parse(readFileSync(stagePath, 'utf-8')) as StageSpec;

const ch102 = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../../content/stages/ch1-02.json', import.meta.url)),
    'utf-8',
  ),
) as StageSpec;

const ch103 = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../../content/stages/ch1-03.json', import.meta.url)),
    'utf-8',
  ),
) as StageSpec;

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

/**
 * 解が一本道だと、覚えた手順をなぞるだけの作業になる。
 * このステージは「打ち消す」と「巻き戻す」の二通りで解けるようにしてあり、
 * どちらを選ぶかに意味が出ることを確かめる。
 */
describe('ch1-02 改竄された観測記録', () => {
  const byRevert: AbilityCommand[] = [
    { kind: 'revert', targetId: 'c4' },
    { kind: 'revert', targetId: 'c3' },
    { kind: 'revert', targetId: 'c2' },
  ];
  const byReset: AbilityCommand[] = [{ kind: 'reset', targetId: 'c1' }];

  it('打ち消して戻す解法が成立し、完全達成になる', () => {
    const session = expectOk(replay(ch102, byRevert));
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true, '記録を残したまま戻せている');
  });

  it('巻き戻す解法でもクリアできるが、完全達成にはならない', () => {
    const session = expectOk(replay(ch102, byReset));
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, false, '改竄の記録まで消えている');

    const kept = session.report.statuses.find((s) => s.id === 'history-preserved');
    assert.equal(kept?.satisfied, false);
  });

  it('二つの解法は手数と負荷が食い違う —— これがトレードオフになる', () => {
    const revertRun = expectOk(replay(ch102, byRevert));
    const resetRun = expectOk(replay(ch102, byReset));

    assert.ok(resetRun.movesUsed < revertRun.movesUsed, '巻き戻す方が手数は少ない');
    assert.ok(resetRun.causalLoad < revertRun.causalLoad, '巻き戻す方が負荷も低い');
    // それでも完全達成は打ち消す側にしかない
    assert.equal(revertRun.report.perfect, true);
    assert.equal(resetRun.report.perfect, false);
  });

  it('どちらの解法も制限に収まっている', () => {
    for (const [name, solution] of [['revert', byRevert], ['reset', byReset]] as const) {
      const session = expectOk(replay(ch102, solution));
      assert.ok(
        session.movesUsed <= (ch102.moveLimit ?? Infinity),
        `${name}: 手数が上限を超える`,
      );
      assert.ok(
        session.causalLoad <= (ch102.causalLoadLimit ?? Infinity),
        `${name}: 負荷が上限を超える`,
      );
    }
  });

  it('打ち消す順序は問わない', () => {
    const reversed = expectOk(
      replay(ch102, [
        { kind: 'revert', targetId: 'c2' },
        { kind: 'revert', targetId: 'c3' },
        { kind: 'revert', targetId: 'c4' },
      ]),
    );
    assert.equal(reversed.status, 'cleared');
  });
});

/**
 * merge と cherry-pick の違いを、遊びながら区別させるためのステージ。
 * 「世界線ごと取り込む」と「出来事をひとつだけ移す」が別物だと分かる作りになっているか確かめる。
 */
describe('ch1-03 抱き合わせの記録', () => {
  it('世界線ごと取り込むと、要らない出来事までついてくる', () => {
    const session = expectOk(replay(ch103, [{ kind: 'merge', from: 'salvage' }]));

    const world = unwrap(currentWorldState(session.timeline));
    assert.equal(world['device.state'], 'complete', '欲しかったものは手に入る');
    assert.equal(world['city.state'], 'burned', 'しかし市街まで焼けてしまう');
    assert.equal(session.status, 'playing', 'クリアにはならない');
  });

  it('出来事をひとつだけ持ち込めばクリアできる', () => {
    const session = expectOk(replay(ch103, [{ kind: 'cherry-pick', targetId: 'c2' }]));

    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.deepEqual(unwrap(currentWorldState(session.timeline)), {
      'device.state': 'complete',
      'city.state': 'intact',
    });
  });

  it('持ち込んでも、回収元の世界線は動かない', () => {
    const before = expectOk(startStage(ch103));
    const after = expectOk(replay(ch103, [{ kind: 'cherry-pick', targetId: 'c2' }]));

    assert.equal(
      after.timeline.branches.salvage,
      before.timeline.branches.salvage,
      'salvage の先端は変わらない',
    );
  });

  it('持ち込んだ時点は、取り込み元と履歴が繋がらない', () => {
    const session = expectOk(replay(ch103, [{ kind: 'cherry-pick', targetId: 'c2' }]));
    const tip = session.timeline.commits[session.timeline.branches.main as string];

    assert.equal(tip?.parents.length, 1, '親はひとつだけ');
    assert.equal(tip?.parents[0], 'c1', 'main の続きとして積まれる');
  });

  it('想定解は制限に収まっている', () => {
    const session = expectOk(replay(ch103, [{ kind: 'cherry-pick', targetId: 'c2' }]));
    assert.ok(session.movesUsed <= (ch103.moveLimit ?? Infinity));
    assert.ok(session.causalLoad <= (ch103.causalLoadLimit ?? Infinity));
  });
});

// --- ステージ全体の健全性 ---------------------------------------------------

const stagesDir = fileURLToPath(
  new URL('../../../../../content/stages/', import.meta.url),
);
const allStages: StageSpec[] = readdirSync(stagesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(stagesDir + name, 'utf-8')) as StageSpec);

describe('ステージの解放', () => {
  it('解放条件は実在するステージを指している', () => {
    const ids = new Set(allStages.map((s) => s.id));
    for (const stage of allStages) {
      const condition = stage.unlockedBy;
      if (!condition || condition.type !== 'stageCleared') continue;
      assert.ok(
        ids.has(condition.stageId),
        `${stage.id}: 存在しない ${condition.stageId} を前提にしている`,
      );
    }
  });

  it('最初から開いているステージがある', () => {
    const open = allStages.filter((s) => s.unlockedBy === undefined);
    assert.ok(open.length > 0, '入口がどこにもない');
  });

  it('順に辿ればすべてのステージへ到達できる', () => {
    // クリア済みを増やしながら、開くものが無くなるまで進める
    const cleared = new Set<string>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const stage of allStages) {
        if (cleared.has(stage.id)) continue;
        const condition = stage.unlockedBy;
        const unlocked =
          !condition ||
          (condition.type === 'stageCleared' && cleared.has(condition.stageId));
        if (unlocked) {
          cleared.add(stage.id);
          progressed = true;
        }
      }
    }

    const unreachable = allStages.filter((s) => !cleared.has(s.id)).map((s) => s.id);
    assert.deepEqual(unreachable, [], '到達できないステージがある');
  });

  it('新しい能力は訓練で必ず先に渡される', () => {
    const introducedInTraining = new Set<string>();
    for (const stage of trainingStages()) {
      for (const ability of stage.abilities) introducedInTraining.add(ability);
    }

    for (const stage of allStages.filter((s) => s.chapter.kind === 'story')) {
      for (const ability of stage.abilities) {
        assert.ok(
          introducedInTraining.has(ability),
          `${stage.id}: ${ability} が訓練を経ずに本編で初めて出てくる`,
        );
      }
    }
  });

  it('訓練は 1 回につき 1 つだけ新しい術式を渡す', () => {
    /*
     * 作る操作と捨てる操作は対で覚えるほうが自然なので、そこだけ一緒に渡してよい。
     * それ以外は 1 回 1 つに限る。
     */
    const paired: Record<string, string> = {
      branch: 'delete-branch',
      tag: 'delete-tag',
    };

    const seen = new Set<string>();
    for (const stage of trainingStages()) {
      const fresh = stage.abilities.filter((ability) => !seen.has(ability));
      const allowed = new Set(
        [stage.teaches, stage.teaches ? paired[stage.teaches] : undefined].filter(
          (a): a is string => Boolean(a),
        ),
      );
      const unexpected = fresh.filter((ability) => !allowed.has(ability));

      assert.deepEqual(
        unexpected,
        [],
        `${stage.id}: 渡す予定にない術式が混ざっている`,
      );
      if (stage.teaches) {
        assert.ok(
          fresh.includes(stage.teaches),
          `${stage.id}: ${stage.teaches} を渡す回なのに使えない`,
        );
      }
      for (const ability of stage.abilities) seen.add(ability);
    }
  });
});

const stageById = (id: string): StageSpec =>
  allStages.find((s) => s.id === id) as StageSpec;

/** 訓練を、実際に遊ぶ順（段階 → 章内の並び）で返す。 */
const trainingStages = (): StageSpec[] =>
  allStages
    .filter((s) => s.chapter.kind === 'training')
    .sort(
      (a, b) =>
        a.chapter.number - b.chapter.number || (a.order ?? 0) - (b.order ?? 0),
    );

describe('訓練ステージが解けること', () => {
  it('ch0-03: 二本を、それぞれ別の側で決着させる', () => {
    const session = expectOk(
      replay(stageById('ch0-03'), [
        { kind: 'merge', from: 'relay', resolutions: { 'signal.state': { type: 'theirs' } } },
        { kind: 'merge', from: 'desk', resolutions: { 'gauge.value': { type: 'ours' } } },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 2, '一手では終わらない');
  });

  it('ch0-03: どちらか一本だけでは条件が埋まらない', () => {
    const onlyRelay = expectOk(
      replay(stageById('ch0-03'), [
        { kind: 'merge', from: 'relay', resolutions: { 'signal.state': { type: 'theirs' } } },
      ]),
    );
    assert.equal(onlyRelay.status, 'playing', '観測者の名前が入らない');

    const onlyDesk = expectOk(
      replay(stageById('ch0-03'), [
        { kind: 'merge', from: 'desk', resolutions: { 'gauge.value': { type: 'ours' } } },
      ]),
    );
    assert.equal(onlyDesk.status, 'playing', '信号が赤のまま決着してしまう');
  });

  it('ch0-03: 二本とも同じ側に寄せると解けない', () => {
    for (const side of ['ours', 'theirs'] as const) {
      const session = expectOk(
        replay(stageById('ch0-03'), [
          { kind: 'merge', from: 'relay', resolutions: { 'signal.state': { type: side } } },
          { kind: 'merge', from: 'desk', resolutions: { 'gauge.value': { type: side } } },
        ]),
      );
      assert.equal(session.status, 'playing', `${side} に揃えるだけでは足りない`);
    }
  });

  it('ch0-04: 打ち消す解法と、戻す先を選んだ巻き戻しの両方が通る', () => {
    const spec = stageById('ch0-04');

    const byRevert = expectOk(
      replay(spec, [
        { kind: 'revert', targetId: 'c4' },
        { kind: 'revert', targetId: 'c3' },
      ]),
    );
    assert.equal(byRevert.status, 'cleared');
    assert.equal(byRevert.report.perfect, true);

    // 巻き戻すなら c2。正規の手続きを残したまま異常だけを落とせる唯一の位置
    const byReset = expectOk(replay(spec, [{ kind: 'reset', targetId: 'c2' }]));
    assert.equal(byReset.status, 'cleared');
    assert.equal(byReset.report.perfect, false, '巻き戻すと記録が残らない');
    assert.ok(byReset.movesUsed < byRevert.movesUsed, '巻き戻す方が手数は少ない');
  });

  it('ch0-04: 根元まで巻き戻すと、正規の手続きまで消えてクリアできない', () => {
    const session = expectOk(
      replay(stageById('ch0-04'), [{ kind: 'reset', targetId: 'c1' }]),
    );
    assert.equal(session.status, 'playing', '当直の巡回記録まで巻き添えになる');
  });

  it('ch0-04: 異常を片方だけ打ち消しても足りない', () => {
    for (const target of ['c3', 'c4']) {
      const session = expectOk(
        replay(stageById('ch0-04'), [{ kind: 'revert', targetId: target }]),
      );
      assert.equal(session.status, 'playing');
    }
  });

  it('ch0-05: 二本から、欲しい出来事だけを抜き出す', () => {
    const spec = stageById('ch0-05');

    const picked = expectOk(
      replay(spec, [
        { kind: 'cherry-pick', targetId: 'c2' },
        { kind: 'cherry-pick', targetId: 'c4' },
      ]),
    );
    assert.equal(picked.status, 'cleared');
    assert.equal(picked.report.perfect, true);
    assert.equal(picked.movesUsed, 2, '一手では終わらない');
  });

  it('ch0-05: 世界線ごと取り込むと、観測室まで巻き添えになる', () => {
    for (const [from, ruined] of [['spare', 'flooded'], ['relief', 'closed']] as const) {
      const session = expectOk(replay(stageById('ch0-05'), [{ kind: 'merge', from }]));
      const world = unwrap(currentWorldState(session.timeline));
      assert.equal(world['room.state'], ruined, `${from}: 要らない出来事までついてくる`);
      assert.equal(session.status, 'playing');
    }
  });

  it('ch0-05: 片方だけ抜いても条件が埋まらない', () => {
    for (const targetId of ['c2', 'c4']) {
      const session = expectOk(
        replay(stageById('ch0-05'), [{ kind: 'cherry-pick', targetId }]),
      );
      assert.equal(session.status, 'playing');
    }
  });

  it('ch0-05: 抜き出しても、持ち出し元の世界線は動かない', () => {
    const before = expectOk(startStage(stageById('ch0-05')));
    const after = expectOk(
      replay(stageById('ch0-05'), [
        { kind: 'cherry-pick', targetId: 'c2' },
        { kind: 'cherry-pick', targetId: 'c4' },
      ]),
    );
    for (const branch of ['spare', 'relief']) {
      assert.equal(
        after.timeline.branches[branch],
        before.timeline.branches[branch],
        `${branch} の先端は変わらない`,
      );
    }
  });
});

describe('訓練の追加分', () => {
  it('ch0-06: 拾うべき列だけを拾い直せる', () => {
    const spec = stageById('ch0-06');
    const start = expectOk(startStage(spec));

    // 二度の RESET で、四つの時点が行き場を失っている
    assert.deepEqual([...orphanedCommits(start.timeline)].sort(), ['c2', 'c3', 'c4', 'c5']);

    const session = expectOk(
      replay(spec, [
        { kind: 'branch', name: 'rescue', at: 'c3' },
        { kind: 'merge', from: 'rescue' },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.deepEqual(
      [...orphanedCommits(session.timeline)].sort(),
      ['c4', 'c5'],
      '仮設標識の列は浮いたまま',
    );
  });

  it('ch0-06: 巻き戻して拾う手もあるが、負荷が高くつく', () => {
    const spec = stageById('ch0-06');
    const byBranch = expectOk(
      replay(spec, [
        { kind: 'branch', name: 'rescue', at: 'c3' },
        { kind: 'merge', from: 'rescue' },
      ]),
    );
    const byReset = expectOk(replay(spec, [{ kind: 'reset', targetId: 'c3' }]));

    assert.equal(byReset.status, 'cleared');
    assert.ok(byReset.movesUsed < byBranch.movesUsed, '巻き戻す方が手数は少ない');
    assert.ok(byReset.causalLoad > byBranch.causalLoad, '巻き戻す方が負荷は高い');
  });

  it('ch0-06: 仮設標識の列を拾うと条件を満たさない', () => {
    const session = expectOk(
      replay(stageById('ch0-06'), [
        { kind: 'branch', name: 'rescue', at: 'c5' },
        { kind: 'merge', from: 'rescue' },
      ]),
    );
    assert.equal(session.status, 'playing', '要らない列まで生き返らせている');
  });

  it('ch0-06: 手前の時点だけ拾っても、その先は戻らない', () => {
    const session = expectOk(
      replay(stageById('ch0-06'), [
        { kind: 'branch', name: 'half', at: 'c2' },
        { kind: 'merge', from: 'half' },
      ]),
    );
    assert.equal(session.status, 'playing', '基準点の登録が戻らない');
  });

  it('ch0-07: 先に印を付けてから巻き戻せば、記録は残る', () => {
    const session = expectOk(
      replay(stageById('ch0-07'), [
        { kind: 'branch', name: 'keep', at: 'c3' },
        { kind: 'reset', targetId: 'c1' },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
  });

  it('ch0-07: 印を付けずに巻き戻すと記録を失う', () => {
    const session = expectOk(
      replay(stageById('ch0-07'), [{ kind: 'reset', targetId: 'c1' }]),
    );
    assert.equal(session.status, 'playing', '世界は戻るが、記録の条件を満たさない');
  });

  it('ch0-08: 矛盾ごとに別の側を選び、決着に見合う処置まで刻む', () => {
    const spec = stageById('ch0-08');
    const alert = spec.offers?.find((o) => o.id === 'raise-alert');
    assert.ok(alert);

    const session = expectOk(
      replay(spec, [
        {
          kind: 'merge',
          from: 'second',
          resolutions: {
            'water.level': { type: 'ours' },
            'pressure.value': { type: 'theirs' },
          },
        },
        { kind: 'commit', message: alert.message, changes: alert.changes },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 2, '決着させただけでは終わらない');
  });

  it('ch0-08: 決着させただけでは終わらない', () => {
    const session = expectOk(
      replay(stageById('ch0-08'), [
        {
          kind: 'merge',
          from: 'second',
          resolutions: {
            'water.level': { type: 'ours' },
            'pressure.value': { type: 'theirs' },
          },
        },
      ]),
    );
    assert.equal(session.status, 'playing', '危険域と決めたなら警戒を出す義務がある');
  });

  it('ch0-08: 見合わない処置を刻んでもクリアできない', () => {
    const spec = stageById('ch0-08');
    const stand = spec.offers?.find((o) => o.id === 'stand-down');
    assert.ok(stand);

    const session = expectOk(
      replay(spec, [
        {
          kind: 'merge',
          from: 'second',
          resolutions: {
            'water.level': { type: 'ours' },
            'pressure.value': { type: 'theirs' },
          },
        },
        { kind: 'commit', message: stand.message, changes: stand.changes },
      ]),
    );
    assert.equal(session.status, 'playing');
  });

  it('ch0-08: まとめて片側に寄せると解けない', () => {
    for (const side of ['ours', 'theirs'] as const) {
      const session = expectOk(
        replay(stageById('ch0-08'), [
          {
            kind: 'merge',
            from: 'second',
            resolutions: {
              'water.level': { type: side },
              'pressure.value': { type: side },
            },
          },
        ]),
      );
      assert.equal(session.status, 'playing', `${side} に寄せるだけでは足りない`);
    }
  });
});

describe('ch0-09 起こす', () => {
  const offerOf = (id: string) => {
    const offer = stageById('ch0-09').offers?.find((o) => o.id === id);
    assert.ok(offer, `候補 ${id} がない`);
    return offer;
  };

  const commitOf = (id: string): AbilityCommand => {
    const offer = offerOf(id);
    return { kind: 'commit', message: offer.message, changes: offer.changes };
  };

  const intended = ['notify-guard', 'open-gate', 'write-log'];

  it('候補が用意されている', () => {
    assert.equal(stageById('ch0-09').offers?.length, 4);
  });

  it('必要な出来事を三つ刻めばクリアできる', () => {
    const session = expectOk(replay(stageById('ch0-09'), intended.map(commitOf)));
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 3, '一手では終わらない');
  });

  it('刻む順序は問わない', () => {
    const session = expectOk(
      replay(stageById('ch0-09'), [...intended].reverse().map(commitOf)),
    );
    assert.equal(session.status, 'cleared');
  });

  it('ひとつ欠けるとクリアできない', () => {
    for (const omitted of intended) {
      const session = expectOk(
        replay(stageById('ch0-09'), intended.filter((id) => id !== omitted).map(commitOf)),
      );
      assert.equal(session.status, 'playing', `${omitted} を抜くと条件が埋まらない`);
    }
  });

  it('刻んではいけない候補を刻むとクリアできない', () => {
    const session = expectOk(
      replay(stageById('ch0-09'), [...intended, 'sound-alarm'].map(commitOf)),
    );
    assert.equal(session.status, 'playing', '警報を鳴らすと人々が散ってしまう');
  });

  it('刻み違えても打ち消してやり直せる', () => {
    const spec = stageById('ch0-09');
    const session = expectOk(
      replay(spec, [
        commitOf('sound-alarm'),
        { kind: 'revert', targetId: 'c2' },
        ...intended.map(commitOf),
      ]),
    );
    assert.equal(session.status, 'cleared', '間違えても取り返しがつく');
    assert.ok(session.movesUsed <= (spec.moveLimit ?? Infinity));
    assert.ok(session.causalLoad <= (spec.causalLoadLimit ?? Infinity));
  });

  it('やり直せるのは一度まで —— 二度刻み違えると手が足りなくなる', () => {
    const spec = stageById('ch0-09');
    const twice = replay(spec, [
      commitOf('sound-alarm'),
      { kind: 'revert', targetId: 'c2' },
      commitOf('sound-alarm'),
      { kind: 'revert', targetId: 'c4' },
      ...intended.map(commitOf),
    ]);
    assert.equal(twice.ok, false, '二度も刻み違えると、直すだけの余裕が残らない');
  });
});

describe('ch0-12 観測点を移す', () => {
  const goNorth: AbilityCommand = {
    kind: 'checkout',
    target: { type: 'branch', branch: 'north' },
  };

  it('三本の記録が並んでいる', () => {
    const session = expectOk(startStage(stageById('ch0-12')));
    for (const branch of ['main', 'north', 'south']) {
      assert.ok(session.timeline.branches[branch], `${branch} がない`);
    }
    assert.deepEqual(session.timeline.head, { type: 'branch', branch: 'main' });
  });

  it('異常のある世界線へ移って打ち消せばクリアできる', () => {
    const session = expectOk(
      replay(stageById('ch0-12'), [goNorth, { kind: 'revert', targetId: 'c4' }]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
  });

  it('移動は手数を使わない —— 全部見て回ってから直せる', () => {
    const session = expectOk(
      replay(stageById('ch0-12'), [
        { kind: 'checkout', target: { type: 'branch', branch: 'south' } },
        goNorth,
        { kind: 'checkout', target: { type: 'branch', branch: 'main' } },
        goNorth,
        { kind: 'revert', targetId: 'c4' },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.movesUsed, 1, '移動は手数に数えない');
  });

  it('移っただけではクリアにならない', () => {
    for (const branch of ['north', 'south']) {
      const session = expectOk(
        replay(stageById('ch0-12'), [
          { kind: 'checkout', target: { type: 'branch', branch } },
        ]),
      );
      assert.equal(session.status, 'playing');
    }
  });

  it('立つ場所を間違えたまま打ち消しても、何も起きない', () => {
    for (const branch of ['main', 'south']) {
      const session = expectOk(
        replay(stageById('ch0-12'), [
          { kind: 'checkout', target: { type: 'branch', branch } },
        ]),
      );
      // その世界線では封は破られていない。打ち消す相手がいないので記録は動かない
      expectErr(
        playAbility(session, { kind: 'revert', targetId: 'c4' }),
        'NothingToCommit',
      );
      assert.equal(session.status, 'playing', `${branch} では観測値が違う`);
    }
  });
});

describe('ch0-02 二本目の記録', () => {
  it('必要な二本を取り込めばクリアできる', () => {
    const session = expectOk(
      replay(stageById('ch0-02'), [
        { kind: 'merge', from: 'observation' },
        { kind: 'merge', from: 'calibration' },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 2, '一手では終わらない');
  });

  it('片方だけではクリアできない', () => {
    for (const from of ['observation', 'calibration']) {
      const session = expectOk(replay(stageById('ch0-02'), [{ kind: 'merge', from }]));
      assert.equal(session.status, 'playing');
    }
  });

  it('見捨てられた世界線まで取り込むとクリアできない', () => {
    const session = expectOk(
      replay(stageById('ch0-02'), [
        { kind: 'merge', from: 'observation' },
        { kind: 'merge', from: 'salvage' },
      ]),
    );
    assert.equal(session.status, 'playing', '観測小屋まで取り壊されてしまう');
  });

  it('三本すべて束ねる余裕はない', () => {
    const session = expectOk(
      replay(stageById('ch0-02'), [
        { kind: 'merge', from: 'observation' },
        { kind: 'merge', from: 'calibration' },
      ]),
    );
    expectErr(
      playAbility(session, { kind: 'merge', from: 'salvage' }),
      'CausalLoadExceeded',
    );
  });
});

describe('ch0-10 動かない印', () => {
  const finalize = (): AbilityCommand => {
    const offer = stageById('ch0-10').offers?.[0];
    assert.ok(offer);
    return { kind: 'commit', message: offer.message, changes: offer.changes };
  };

  const solution: AbilityCommand[] = [
    { kind: 'delete-tag', name: 'baseline' },
    { kind: 'tag', name: 'baseline', at: 'c2' },
    finalize(),
  ];

  it('前任者の印が、間違った時点に付いた状態から始まる', () => {
    const session = expectOk(startStage(stageById('ch0-10')));
    assert.equal(session.timeline.tags.baseline, 'c1');
    assert.equal(session.status, 'playing');
  });

  it('印を打ち直してから確定させればクリアできる', () => {
    const session = expectOk(replay(stageById('ch0-10'), solution));
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 3);
  });

  it('外さずに同じ名前を付け直すことはできない', () => {
    const session = expectOk(startStage(stageById('ch0-10')));
    const result = playAbility(session, { kind: 'tag', name: 'baseline', at: 'c2' });
    assert.equal(result.ok, false, '同じ名前の印は二つ置けない');
  });

  it('印を直さずに確定させてもクリアできない', () => {
    const session = expectOk(replay(stageById('ch0-10'), [finalize()]));
    assert.equal(session.status, 'playing');
  });

  it('印は動かない —— 確定させても打った時点に留まる', () => {
    const session = expectOk(replay(stageById('ch0-10'), solution));
    assert.equal(session.timeline.tags.baseline, 'c2', '印は動かない');
    assert.notEqual(session.timeline.branches.main, 'c2', '世界線の方は先へ進む');
  });

  it('印の付け外しは負荷を使わない', () => {
    const session = expectOk(replay(stageById('ch0-10'), solution));
    assert.equal(session.causalLoad, 1, '負荷を使ったのは COMMIT の分だけ');
  });
});

describe('訓練で全能力が渡されること', () => {
  it('実装済みの能力は、すべてどこかの訓練で扱われる', () => {
    const introduced = new Set<string>();
    for (const stage of trainingStages()) {
      for (const ability of stage.abilities) introduced.add(ability);
    }

    // ゲーム内で行使できる能力の全種類
    const all = [
      'commit', 'branch', 'delete-branch', 'checkout',
      'merge', 'revert', 'reset', 'cherry-pick', 'tag', 'delete-tag', 'rebase',
    ];
    const missing = all.filter((ability) => !introduced.has(ability));
    assert.deepEqual(missing, [], '訓練で渡されない能力がある');
  });
});

describe('ch0-11 並べ直す', () => {
  const solution: AbilityCommand[] = [
    { kind: 'branch', name: 'original', at: 'c2' },
    { kind: 'rebase', onto: 'upstream' },
  ];

  it('先に印を付けてから並べ直せばクリアできる', () => {
    const session = expectOk(replay(stageById('ch0-11'), solution));
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 2, '一手では終わらない');
  });

  it('いきなり並べ直すと、元の時点を失う', () => {
    const session = expectOk(
      replay(stageById('ch0-11'), [{ kind: 'rebase', onto: 'upstream' }]),
    );

    // 世界の状態そのものは揃うが、元の時点がどこからも辿れなくなる
    const world = unwrap(currentWorldState(session.timeline));
    assert.equal(world['standard.version'], 'new');
    assert.equal(world['reading.state'], 'corrected');
    assert.ok(orphanedCommits(session.timeline).includes('c2'), '元の時点が浮いている');
    assert.equal(session.status, 'playing', '記録を失った分、条件を満たさない');
  });

  it('履歴が一列になる —— 分岐が残らない', () => {
    const session = expectOk(replay(stageById('ch0-11'), solution));
    const tip = session.timeline.commits[session.timeline.branches.main as string];
    assert.equal(tip?.parents.length, 1);
    assert.equal(tip?.parents[0], session.timeline.branches.upstream, '本流の上に載っている');
  });

  it('統合は渡していないので、並べ直すしかない', () => {
    const spec = stageById('ch0-11');
    assert.equal(spec.abilities.includes('merge'), false);

    const session = expectOk(startStage(spec));
    const result = playAbility(session, { kind: 'merge', from: 'upstream' });
    expectErr(result, 'AbilityNotAvailable');
  });
});

describe('ch0-01 着任（判断を伴う打ち消し）', () => {
  it('異常だけを打ち消せばクリアできる', () => {
    const session = expectOk(
      replay(stageById('ch0-01'), [
        { kind: 'revert', targetId: 'c4' },
        { kind: 'revert', targetId: 'c2' },
      ]),
    );
    assert.equal(session.status, 'cleared');
    assert.equal(session.report.perfect, true);
    assert.equal(session.movesUsed, 2, '一手では終わらない');
  });

  it('正規の手順まで打ち消すとクリアできない', () => {
    const session = expectOk(
      replay(stageById('ch0-01'), [
        { kind: 'revert', targetId: 'c4' },
        { kind: 'revert', targetId: 'c3' },
        { kind: 'revert', targetId: 'c2' },
      ]),
    );
    assert.equal(session.status, 'playing', '扉を開けてしまうと条件を満たさない');
  });

  it('片方だけではクリアできない', () => {
    for (const target of ['c2', 'c4']) {
      const session = expectOk(
        replay(stageById('ch0-01'), [{ kind: 'revert', targetId: target }]),
      );
      assert.equal(session.status, 'playing');
    }
  });
});
