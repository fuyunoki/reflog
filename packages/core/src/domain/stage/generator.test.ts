/**
 * 自動生成の検証。
 *
 * 「無限に遊べる」を名乗る以上、生成されたステージが解けない事態は絶対に許されない。
 * ここでは大量に生成して、そのすべてが実際にクリアできることを確かめる。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { expectOk } from '../../testing.ts';
import { replay } from '../../application/usecases/stageSession.ts';
import { generateMission, verifySolvable } from './generator.ts';
import {
  DIFFICULTIES,
  LEVEL_ORDER,
  adaptDifficulty,
  type DifficultyLevel,
  type MissionOutcome,
} from './difficulty.ts';
import { causalLoadOf, countsAsMove } from '../ability/types.ts';
import type { AbilityCommand } from '../ability/types.ts';
import type { ConflictResolution } from '../timeline/types.ts';

const LEVELS = LEVEL_ORDER;

describe('generateMission', () => {
  it('すべての難易度で生成できる', () => {
    for (const level of LEVELS) {
      const generated = generateMission(1, level);
      assert.ok(generated.ok, `${level} の生成に失敗した`);
    }
  });

  it('生成した任務はすべて想定解でクリアできる', () => {
    let checked = 0;
    for (const level of LEVELS) {
      for (let n = 1; n <= 40; n += 1) {
        const generated = expectOk(generateMission(n, level));
        const session = expectOk(replay(generated.spec, generated.solution));

        assert.equal(
          session.status,
          'cleared',
          `任務 #${n} (${level}) が想定解で解けない`,
        );
        checked += 1;
      }
    }
    assert.equal(checked, LEVELS.length * 40);
  });

  it('想定解は手数と因果負荷の上限に収まる', () => {
    for (const level of LEVELS) {
      for (let n = 1; n <= 20; n += 1) {
        const { spec, solution } = expectOk(generateMission(n, level));
        const moves = solution.filter(countsAsMove).length;
        const load = solution.reduce((sum, c) => sum + causalLoadOf(c), 0);

        assert.ok(
          moves <= (spec.moveLimit ?? Infinity),
          `任務 #${n} (${level}): 手数 ${moves} が上限 ${spec.moveLimit} を超える`,
        );
        assert.ok(
          load <= (spec.causalLoadLimit ?? Infinity),
          `任務 #${n} (${level}): 負荷 ${load} が上限 ${spec.causalLoadLimit} を超える`,
        );
      }
    }
  });

  it('同じ seed からは同じ任務が生成される', () => {
    for (const level of LEVELS) {
      const a = expectOk(generateMission(7, level));
      const b = expectOk(generateMission(7, level));
      assert.equal(JSON.stringify(a.spec), JSON.stringify(b.spec));
      assert.equal(a.seed, b.seed);
    }
  });

  it('任務番号が違えば別の盤面になる', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 20; n += 1) {
      const { spec } = expectOk(generateMission(n, 'standard'));
      seen.add(JSON.stringify(spec.setup));
    }
    // 完全な一意までは要求しないが、大半は異なるはず。
    assert.ok(seen.size >= 15, `盤面の多様性が足りない: ${seen.size}/20`);
  });

  it('難易度が上がるほど盤面が重くなる', () => {
    const weight = (level: DifficultyLevel): number => {
      let total = 0;
      for (let n = 1; n <= 15; n += 1) {
        const { spec, solution } = expectOk(generateMission(n, level));
        total += (spec.setup?.length ?? 0) + solution.length;
      }
      return total / 15;
    };

    const quiet = weight('quiet');
    const critical = weight('critical');
    assert.ok(
      critical > quiet,
      `特級(${critical.toFixed(1)}) が低(${quiet.toFixed(1)}) より重くない`,
    );
  });

  it('難易度に応じた矛盾が実際に含まれる', () => {
    // severe 以上は必ず conflict を経由する解になっている
    for (let n = 1; n <= 20; n += 1) {
      const { solution } = expectOk(generateMission(n, 'severe'));
      const hasResolution = solution.some(
        (c) => c.kind === 'merge' && c.resolutions && Object.keys(c.resolutions).length > 0,
      );
      assert.ok(hasResolution, `任務 #${n}: 矛盾の解決を含んでいない`);
    }
  });

  it('矛盾の決断を誤るとクリアできない', () => {
    // 決断が結果を変えないなら、conflict はただの手続きになってしまう。
    // 生成時に選ばれた側の逆を選ぶと、必ずクリアできないことを保証する。
    let checked = 0;
    for (let n = 1; n <= 25; n += 1) {
      const { spec, solution } = expectOk(generateMission(n, 'severe'));

      const flipped: AbilityCommand[] = solution.map((command) => {
        if (command.kind !== 'merge' || !command.resolutions) return command;
        const inverted: Record<string, ConflictResolution> = {};
        for (const [key, resolution] of Object.entries(command.resolutions)) {
          inverted[key] = { type: resolution.type === 'ours' ? 'theirs' : 'ours' };
        }
        return { ...command, resolutions: inverted };
      });

      const hasConflict = solution.some(
        (c) => c.kind === 'merge' && c.resolutions && Object.keys(c.resolutions).length > 0,
      );
      if (!hasConflict) continue;

      const session = replay(spec, flipped);
      if (session.ok) {
        assert.notEqual(
          session.value.status,
          'cleared',
          `任務 #${n}: 決断を誤ってもクリアできてしまう`,
        );
      }
      checked += 1;
    }
    assert.ok(checked > 0, '矛盾を含む任務が 1 つも生成されていない');
  });

  it('矛盾の起きたキーは必ず達成条件に含まれる', () => {
    for (let n = 1; n <= 20; n += 1) {
      const { spec, solution } = expectOk(generateMission(n, 'severe'));
      const conflictKeys = solution.flatMap((c) =>
        c.kind === 'merge' && c.resolutions ? Object.keys(c.resolutions) : [],
      );
      for (const key of conflictKeys) {
        const covered = spec.goals.some(
          (goal) =>
            (goal.predicate.type === 'factEquals' || goal.predicate.type === 'factAbsent') &&
            goal.predicate.key === key,
        );
        assert.ok(covered, `任務 #${n}: ${key} の決断が達成条件に現れない`);
      }
    }
  });

  it('警戒度が高いと助言が出ない', () => {
    const easy = expectOk(generateMission(3, 'quiet'));
    const hard = expectOk(generateMission(3, 'critical'));
    assert.ok((easy.spec.hints?.length ?? 0) > 0);
    assert.equal(hard.spec.hints, undefined);
  });

  it('自己検証が通る', () => {
    for (const level of LEVELS) {
      const generated = expectOk(generateMission(11, level));
      assert.equal(verifySolvable(generated), true);
    }
  });

  it('表示用の語彙が毎回割り当てられる', () => {
    const { spec } = expectOk(generateMission(5, 'standard'));
    assert.ok(spec.factLabels);
    assert.ok(spec.factLabels?.['subject.alive']);
    assert.ok(spec.valueLabels?.['true']);
    // ドメインのキーは固定のまま
    assert.ok('subject.alive' in spec.initialFacts);
  });
});

describe('adaptDifficulty', () => {
  const outcome = (o: Partial<MissionOutcome>): MissionOutcome => ({
    cleared: true,
    moveOverhead: 0,
    usedHint: false,
    retries: 0,
    ...o,
  });

  it('履歴がなければ据え置き', () => {
    assert.equal(adaptDifficulty('standard', []), 'standard');
  });

  it('2 回失敗したら下げる', () => {
    const recent = [outcome({ cleared: false }), outcome({}), outcome({ cleared: false })];
    assert.equal(adaptDifficulty('severe', recent), 'standard');
  });

  it('危なげなく 3 連続で解いたら上げる', () => {
    const recent = [outcome({}), outcome({}), outcome({})];
    assert.equal(adaptDifficulty('quiet', recent), 'standard');
  });

  it('ヒントを使っていたら上げない', () => {
    const recent = [outcome({}), outcome({ usedHint: true }), outcome({ usedHint: true })];
    assert.equal(adaptDifficulty('standard', recent), 'standard');
  });

  it('最低・最高を越えない', () => {
    const bad = [outcome({ cleared: false }), outcome({ cleared: false })];
    assert.equal(adaptDifficulty('quiet', bad), 'quiet');

    const good = [outcome({}), outcome({}), outcome({})];
    assert.equal(adaptDifficulty('critical', good), 'critical');
  });
});

describe('DIFFICULTIES', () => {
  it('警戒度が上がるほど余裕が減る', () => {
    for (let i = 1; i < LEVEL_ORDER.length; i += 1) {
      const prev = DIFFICULTIES[LEVEL_ORDER[i - 1] as DifficultyLevel];
      const cur = DIFFICULTIES[LEVEL_ORDER[i] as DifficultyLevel];
      assert.ok(cur.moveSlack <= prev.moveSlack);
      assert.ok(cur.loadSlack <= prev.loadSlack);
    }
  });
});
