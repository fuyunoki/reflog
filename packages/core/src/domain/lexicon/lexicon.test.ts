/**
 * 語彙カードの検証。
 *
 * 本文の照合が壊れると、下線が引かれないだけでなく本文が欠ける可能性がある。
 * データ側の規約（docs/world.md）も、人が守るのではなく機械で守らせる。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { annotate, findMatches } from './annotate.ts';
import type { LexiconEntry } from './types.ts';
import type { StageSpec } from '../stage/spec.ts';

const dir = fileURLToPath(new URL('../../../../../content/lexicon/', import.meta.url));
const entries: LexiconEntry[] = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(dir + name, 'utf-8')) as LexiconEntry);

const stagesDir = fileURLToPath(new URL('../../../../../content/stages/', import.meta.url));
const stages: StageSpec[] = readdirSync(stagesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(stagesDir + name, 'utf-8')) as StageSpec);

describe('本文の照合', () => {
  const sample: LexiconEntry[] = [
    { id: 'a', kind: 'person', name: '霧島 湊', aliases: ['霧島湊', '霧島'], caption: '', lines: [] },
    { id: 'b', kind: 'org', name: '観測局', caption: '', lines: [] },
  ];

  it('地の文と語に切り分けても、本文は一字も欠けない', () => {
    const text = '観測局は霧島湊の記録を回収した。霧島は白鷺にいた。';
    const joined = annotate(text, sample)
      .map((segment) => segment.text)
      .join('');
    assert.equal(joined, text);
  });

  it('長い表記を優先する —— 霧島湊を霧島で切らない', () => {
    const matches = findMatches('霧島湊が亡くなった', sample);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.end, 3, '「霧島湊」まで一続きで取る');
  });

  it('同じ語に何度も下線を引かない', () => {
    const once = new Set<string>();
    const first = annotate('観測局の記録', sample, once);
    const second = annotate('観測局はそう言った', sample, once);

    assert.equal(first.filter((s) => s.kind === 'entry').length, 1);
    assert.equal(second.filter((s) => s.kind === 'entry').length, 0, '二度目は地の文のまま');
    assert.equal(
      second.map((s) => s.text).join(''),
      '観測局はそう言った',
      '下線を引かなくても本文は残る',
    );
  });

  it('登録語がなければ、そのまま一続きで返る', () => {
    const segments = annotate('何も登録されていない文', sample);
    assert.deepEqual(segments, [{ kind: 'text', text: '何も登録されていない文' }]);
  });
});

describe('語彙データの規約', () => {
  it('id が重複していない', () => {
    const ids = entries.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('初出は実在するステージを指している', () => {
    const stageIds = new Set(stages.map((s) => s.id));
    for (const entry of entries) {
      if (!entry.firstSeen) continue;
      assert.ok(
        stageIds.has(entry.firstSeen),
        `${entry.id}: 存在しない ${entry.firstSeen} を初出にしている`,
      );
    }
  });

  it('初出のステージ本文に、その語が実際に出てくる', () => {
    for (const entry of entries) {
      if (!entry.firstSeen) continue;
      const stage = stages.find((s) => s.id === entry.firstSeen);
      assert.ok(stage);

      const text = [
        ...stage.intro,
        ...(stage.outro ?? []),
        ...(stage.briefing ?? []).map((line) => line.value),
      ].join('\n');

      const names = [entry.name, ...(entry.aliases ?? [])];
      assert.ok(
        names.some((name) => text.includes(name)),
        `${entry.id}: 初出とされる ${entry.firstSeen} の本文に出てこない`,
      );
    }
  });

  /*
   * 役職や用語が架空のままだと読み手に手がかりがない、という指摘への対応。
   *
   * 局のものは訓練で、事案のものは本編で初めて出る。
   * その境目をそのまま規約に使う —— 局のものには実務での対応を必ず書き、
   * 事案のものには書かない。事件の場面に解説が挟まると、事件の重みが落ちるため。
   */
  const isTraining = (entry: LexiconEntry): boolean => {
    const stage = stages.find((s) => s.id === entry.firstSeen);
    return stage?.chapter.kind === 'training';
  };

  it('局の役割・用語には実務での対応が書いてある', () => {
    const missing = entries
      .filter(isTraining)
      .filter((e) => !e.practice)
      .map((e) => e.id);
    assert.deepEqual(missing, [], '実務での対応が無い局側のカードがある');
  });

  it('事案側のカードには実務での対応を書かない', () => {
    const stray = entries
      .filter((e) => !isTraining(e))
      .filter((e) => e.practice)
      .map((e) => e.id);
    assert.deepEqual(stray, [], '事件の場面に解説が挟まっている');
  });

  /*
   * 導入を閉じた直後に何枚も続けて出ると、盤面に入る前に読み物を強制することになる。
   * 初出は散らして、1 ステージ 3 枚までに抑える。
   */
  it('1 ステージで初めて出る語は 3 件まで', () => {
    const perStage = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.firstSeen) continue;
      perStage.set(entry.firstSeen, (perStage.get(entry.firstSeen) ?? 0) + 1);
    }
    const crowded = [...perStage.entries()].filter(([, n]) => n > 3);
    assert.deepEqual(crowded, [], '一度に出る初出が多すぎるステージがある');
  });

  it('本文が空のカードがない', () => {
    for (const entry of entries) {
      assert.ok(entry.name.length > 0, `${entry.id}: 名前がない`);
      assert.ok(entry.caption.length > 0, `${entry.id}: 肩書きがない`);
      assert.ok(entry.lines.length > 0, `${entry.id}: 本文がない`);
    }
  });
});

describe('ステージの見出し', () => {
  it('すべてのステージに見出しが付いている', () => {
    const missing = stages.filter((s) => !s.briefing?.length).map((s) => s.id);
    assert.deepEqual(missing, [], '見出しの無いステージがある');
  });

  it('見出しの欄が空でない', () => {
    for (const stage of stages) {
      for (const line of stage.briefing ?? []) {
        assert.ok(line.label.length > 0, `${stage.id}: 欄名が空`);
        assert.ok(line.value.length > 0, `${stage.id}: ${line.label} の中身が空`);
      }
    }
  });

  it('訓練は演習として、本編は年月と場所として書かれている', () => {
    for (const stage of stages) {
      const labels = (stage.briefing ?? []).map((line) => line.label);
      if (stage.chapter.kind === 'training') {
        assert.ok(labels.includes('演習'), `${stage.id}: 演習番号がない`);
        assert.ok(labels.includes('主題'), `${stage.id}: 主題がない`);
      } else {
        assert.ok(labels.includes('年月'), `${stage.id}: 年月がない`);
        assert.ok(labels.includes('場所'), `${stage.id}: 場所がない`);
      }
    }
  });
});
