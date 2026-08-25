/**
 * 観測任務（自動生成ステージ）の生成器。
 *
 * 設計の要は「逆算生成」であること。
 * ランダムに盤面を作って解けるか探索するのではなく、
 *   盤面を作る → 想定解を実際に実行する → 到達した状態を目標にする
 * という順で作る。生成時点で解を握っているので、解けないステージが原理的に出ない。
 *
 * seed が同じなら必ず同じ任務が出る。任務番号を共有するだけで盤面を再現できるため、
 * 生成したステージをサーバに保存する必要がない。
 */
import { type Result, ok, err } from '../shared/result.ts';
import { createRng, seedFrom, type Rng } from '../shared/random.ts';
import { executeAbility } from '../ability/execute.ts';
import { causalLoadOf, countsAsMove } from '../ability/types.ts';
import type { AbilityCommand } from '../ability/types.ts';
import { createTimeline, previewMerge } from '../timeline/operations.ts';
import { currentWorldState, resolveHead } from '../timeline/graph.ts';
import type {
  ConflictResolution,
  FactKey,
  FactValue,
  TimelineState,
} from '../timeline/types.ts';
import type { Goal } from './goal.ts';
import type { StageSpec } from './spec.ts';
import { DIFFICULTIES, type DifficultyLevel, type DifficultyProfile } from './difficulty.ts';

// --- 語彙 -------------------------------------------------------------------
// 事実キーは固定にして、表示名だけを差し替える。
// これで生成ロジックは単純なまま、プレイヤーには毎回違う世界に見える。

const PLACES = [
  '白鷺', '黒鳶', '灰崎', '青柳', '朝霧', '塩見', '苫江', '氷室', '夜久野', '真名瀬',
];
/** 本編の登場人物（霧島）は入れない。世界観が混線するため。 */
const SURNAMES = [
  '相馬', '御崎', '鷺沼', '八坂', '倉持', '七尾', '古都見', '柊', '燕', '真下',
];
const FACILITIES = [
  '観測所', '研究棟', '中継局', '記録保管庫', '第二資料館', '通信塔',
];
const DEVICES = [
  '観測装置', '記録機関', '位相計', '時軸安定器', '因果計測儀',
];

interface Vocabulary {
  readonly place: string;
  readonly surname: string;
  readonly facility: string;
  readonly device: string;
  readonly year: number;
  readonly month: number;
}

const pickVocabulary = (rng: Rng): Vocabulary => ({
  place: rng.pick(PLACES),
  surname: rng.pick(SURNAMES),
  facility: rng.pick(FACILITIES),
  device: rng.pick(DEVICES),
  year: rng.int(1954, 2012),
  month: rng.int(1, 12),
});

// --- 事実の定義 -------------------------------------------------------------

interface FactTemplate {
  readonly key: FactKey;
  readonly normal: FactValue;
  readonly alternatives: readonly FactValue[];
  readonly label: (v: Vocabulary) => string;
  readonly values: Readonly<Record<string, string>>;
}

const FACTS: readonly FactTemplate[] = [
  {
    key: 'subject.alive',
    normal: 'true',
    alternatives: ['false', 'missing'],
    label: (v) => `${v.surname}の生存`,
    values: { true: '生存', false: '死亡', missing: '消息不明' },
  },
  {
    key: 'device.state',
    normal: 'prototype',
    alternatives: ['complete', 'sealed', 'lost'],
    label: (v) => v.device,
    values: {
      prototype: '試作段階',
      complete: '完成',
      sealed: '封印',
      lost: '散逸',
    },
  },
  {
    key: 'site.state',
    normal: 'operating',
    alternatives: ['burned', 'closed', 'evacuated'],
    label: (v) => `${v.place}${v.facility}`,
    values: {
      operating: '稼働中',
      burned: '焼失',
      closed: '閉鎖',
      evacuated: '退避済み',
    },
  },
  {
    key: 'record.state',
    normal: 'kept',
    alternatives: ['erased', 'classified'],
    label: () => '観測記録',
    values: { kept: '保管', erased: '消失', classified: '封緘' },
  },
];

const factByKey = (key: FactKey): FactTemplate =>
  FACTS.find((f) => f.key === key) as FactTemplate;

// --- 出来事の文面 -----------------------------------------------------------

const anomalyNarrative = (
  rng: Rng,
  v: Vocabulary,
  key: FactKey,
  value: FactValue,
): string => {
  if (key === 'subject.alive') {
    return value === 'false'
      ? `${v.year}年${v.month}月、${v.place}${v.facility}で事故。${v.surname}は最後まで${v.device}の前から動かなかった。`
      : `${v.surname}はその日を境に記録から消えた。誰も、いつ消えたのかを言えない。`;
  }
  if (key === 'device.state') {
    return value === 'sealed'
      ? `${v.device}は封印された。稼働記録は残らなかった。`
      : `${v.device}は失われた。設計図ごと、どこにも見当たらない。`;
  }
  if (key === 'site.state') {
    return value === 'burned'
      ? `${v.place}${v.facility}が焼失。出火の原因は特定されていない。`
      : `${v.place}${v.facility}は閉鎖された。理由は記録されていない。`;
  }
  return rng.chance(0.5)
    ? '観測記録が消えている。持ち出された形跡はない。'
    : '観測記録に封緘の印が押されている。誰が押したのかは分からない。';
};

const ordinaryNarrative = (v: Vocabulary, key: FactKey, value: FactValue): string => {
  const fact = factByKey(key);
  const name = fact.label(v);
  const state = fact.values[value] ?? value;
  return `${v.year}年、${name}は${state}の状態に置かれた。この時点では、まだ誰も異常に気づいていない。`;
};

// --- 生成本体 ---------------------------------------------------------------

export interface GeneratedStage {
  readonly spec: StageSpec;
  /** 生成時に実際に通した想定解。ヒント生成と検証に使う。 */
  readonly solution: readonly AbilityCommand[];
  readonly seed: number;
  readonly missionNumber: number;
}

export type GenerateError = { readonly type: 'GenerationFailed'; readonly attempts: number };

const between = (rng: Rng, range: readonly [number, number]): number =>
  rng.int(range[0], range[1]);

interface Attempt {
  readonly spec: StageSpec;
  readonly solution: readonly AbilityCommand[];
  readonly conflictCount: number;
}

const tryGenerate = (
  rng: Rng,
  profile: DifficultyProfile,
  vocab: Vocabulary,
  missionNumber: number,
): Attempt | null => {
  const branchCount = between(rng, profile.branches);
  const depth = between(rng, profile.depth);

  // --- 1. 初期グラフを組み立てる -------------------------------------------
  // main には「後で revert する異常」と「revert しない通常の出来事」を置く。
  // 後者を分岐世界線と衝突させることで、conflict を確実に発生させる。

  const anomalyFact = factByKey('subject.alive');
  const ordinaryFacts = rng.sample(
    FACTS.filter((f) => f.key !== 'subject.alive'),
    Math.max(1, Math.min(depth, 3)),
  );

  const initialFacts: Record<FactKey, FactValue> = {};
  for (const fact of FACTS) initialFacts[fact.key] = fact.normal;

  const setup: AbilityCommand[] = [];

  // 通常の出来事（これらは revert されないので、衝突の種になる）
  const ordinaryChoices: { key: FactKey; value: FactValue }[] = [];
  for (const fact of ordinaryFacts) {
    const value = rng.pick(fact.alternatives);
    ordinaryChoices.push({ key: fact.key, value });
    setup.push({
      kind: 'commit',
      message: `${fact.label(vocab)}に変化があった`,
      changes: { [fact.key]: value },
      narrative: ordinaryNarrative(vocab, fact.key, value),
    });
  }

  // 異常（プレイヤーはこれを revert する）
  const anomalyValue = rng.pick(anomalyFact.alternatives);
  const anomalyIndex = setup.length;
  setup.push({
    kind: 'commit',
    message: `${vocab.place}${vocab.facility}で異常が発生する`,
    changes: { [anomalyFact.key]: anomalyValue },
    narrative: anomalyNarrative(rng, vocab, anomalyFact.key, anomalyValue),
  });
  // root が c1 なので、setup の i 番目のコミットは c(i+2)
  const anomalyCommitId = `c${anomalyIndex + 2}`;

  // 分岐世界線。root から分かれ、通常の出来事と同じ事実を別の値にする。
  const branchNames: string[] = [];
  for (let i = 0; i < branchCount; i += 1) {
    const name = `observation-${String(i + 1).padStart(2, '0')}`;
    branchNames.push(name);

    const target = ordinaryChoices[i % ordinaryChoices.length] as {
      key: FactKey;
      value: FactValue;
    };
    const fact = factByKey(target.key);
    const rival = fact.alternatives.filter((v) => v !== target.value);
    const value = rival.length > 0 ? rng.pick(rival) : fact.normal;

    setup.push({ kind: 'branch', name, at: 'c1' });
    setup.push({ kind: 'checkout', target: { type: 'branch', branch: name } });
    setup.push({
      kind: 'commit',
      message: `別の世界線では${fact.label(vocab)}が異なる`,
      changes: { [target.key]: value },
      narrative: `回収された記録。この世界線では、${fact.label(vocab)}は${
        fact.values[value] ?? value
      }だった。`,
    });
  }
  setup.push({ kind: 'checkout', target: { type: 'branch', branch: 'main' } });

  // --- 2. 盤面を実際に構築する ---------------------------------------------
  let state: TimelineState = createTimeline({
    initialFacts,
    rootMessage: `観測開始: ${vocab.year}年`,
    rootNarrative: 'すべてがまだ、あるべき形をしていた時点。',
  });
  for (const step of setup) {
    const next = executeAbility(state, step);
    if (!next.ok) return null;
    state = next.value;
  }

  const initialWorld = currentWorldState(state);
  if (!initialWorld.ok) return null;
  const beforeSolving = initialWorld.value;

  // --- 3. 想定解を実行する -------------------------------------------------
  const solution: AbilityCommand[] = [];
  let conflictCount = 0;
  const conflictKeys: FactKey[] = [];
  let solved: TimelineState = state;

  // まず異常を打ち消す
  const revert: AbilityCommand = { kind: 'revert', targetId: anomalyCommitId };
  const afterRevert = executeAbility(solved, revert);
  if (!afterRevert.ok) return null;
  solved = afterRevert.value;
  solution.push(revert);

  // 続いて各世界線を統合する。conflict は生成時にどちらかへ倒す。
  for (const name of rng.sample(branchNames, branchNames.length)) {
    const preview = previewMerge(solved, name);
    if (!preview.ok) return null;

    let command: AbilityCommand = { kind: 'merge', from: name };
    if (preview.value.kind === 'three-way' && preview.value.analysis) {
      const conflicts = preview.value.analysis.conflicts;
      if (conflicts.length > 0) {
        conflictCount += conflicts.length;
        conflictKeys.push(...conflicts.map((c) => c.key));
        const resolutions: Record<FactKey, ConflictResolution> = {};
        for (const conflict of conflicts) {
          resolutions[conflict.key] = rng.chance(0.5)
            ? { type: 'ours' }
            : { type: 'theirs' };
        }
        command = { kind: 'merge', from: name, resolutions };
      }
    }

    const merged = executeAbility(solved, command);
    if (!merged.ok) return null;
    solved = merged.value;
    solution.push(command);
  }

  // --- 4. 到達状態から目標を作る -------------------------------------------
  const finalWorld = currentWorldState(solved);
  if (!finalWorld.ok) return null;

  const changedKeys = Object.keys(finalWorld.value).filter(
    (key) => beforeSolving[key] !== finalWorld.value[key],
  );
  if (changedKeys.length === 0) return null;

  // 矛盾が起きたキーは、結果が初期状態と同じでも必ず目標に含める。
  // これを落とすと「どちらの現実を選んでもクリアできる」状態になり、
  // 決断がゲームとして意味を持たなくなる。
  const goalKeys = [...new Set<FactKey>([...changedKeys, ...conflictKeys])];

  const goals: Goal[] = goalKeys.map((key) => {
    const fact = factByKey(key);
    const value = finalWorld.value[key];
    if (value === undefined) {
      return {
        id: `fact-${key}`,
        label: `${fact.label(vocab)}が失われていること`,
        predicate: { type: 'factAbsent', key },
      };
    }
    return {
      id: `fact-${key}`,
      label: `${fact.label(vocab)}が「${fact.values[value] ?? value}」であること`,
      predicate: { type: 'factEquals', key, value },
    };
  });

  if (profile.requireHistory) {
    goals.push({
      id: 'history-preserved',
      label: '異常の記録を消していないこと',
      predicate: { type: 'historyPreserved', commitId: anomalyCommitId },
    });
  }
  goals.push({
    id: 'branches-kept',
    label: '回収した世界線を破棄していないこと',
    optional: true,
    predicate:
      branchNames.length === 1
        ? { type: 'branchExists', branch: branchNames[0] as string }
        : { type: 'and', all: branchNames.map((b) => ({ type: 'branchExists' as const, branch: b })) },
  });

  // --- 5. 制限値を決める ---------------------------------------------------
  const moves = solution.filter(countsAsMove).length;
  const load = solution.reduce((sum, c) => sum + causalLoadOf(c), 0);

  const [minLen, maxLen] = profile.solutionLength;
  if (moves < minLen || moves > maxLen) return null;

  const [minConflicts] = profile.conflicts;
  if (conflictCount < minConflicts) return null;

  const factLabels: Record<FactKey, string> = {};
  const valueLabels: Record<string, string> = {};
  for (const fact of FACTS) {
    factLabels[fact.key] = fact.label(vocab);
    for (const [raw, shown] of Object.entries(fact.values)) valueLabels[raw] = shown;
  }

  const spec: StageSpec = {
    id: `mission-${missionNumber}`,
    title: `観測任務 #${missionNumber}`,
    chapter: { number: 0, title: '観測任務' },
    intro: [
      `任務 #${missionNumber} — ${vocab.year}年${vocab.month}月、${vocab.place}${vocab.facility}で観測異常。`,
      `分岐は${branchNames.length}、矛盾は${conflictCount}箇所。`,
      `因果負荷の上限は${load + profile.loadSlack}。修正せよ。`,
    ],
    outro: ['世界線は基準値に復帰した。次の任務に移れ。'],
    initialFacts,
    rootMessage: `観測開始: ${vocab.year}年`,
    rootNarrative: 'すべてがまだ、あるべき形をしていた時点。',
    setup,
    goals,
    abilities: profile.abilities,
    moveLimit: moves + profile.moveSlack,
    causalLoadLimit: load + profile.loadSlack,
    factLabels,
    valueLabels,
    difficulty: profile.level,
    ...(profile.hints
      ? {
          hints: [
            '異常そのものを消すのではなく、その影響だけを打ち消す方法がある。',
            '先に異常を打ち消してから、別の世界線を統合する。',
            `revert で ${anomalyCommitId.toUpperCase()} を打ち消し、順に merge する。`,
          ],
        }
      : {}),
  };

  return { spec, solution, conflictCount };
};

/**
 * 任務を生成する。
 * 条件を満たすまで再試行し、それでも駄目なら失敗を返す（無限ループを避ける）。
 */
export const generateMission = (
  missionNumber: number,
  level: DifficultyLevel,
  seedText?: string,
): Result<GeneratedStage, GenerateError> => {
  const profile = DIFFICULTIES[level];
  const baseSeed = seedFrom(seedText ?? `mission-${missionNumber}-${level}`);

  const MAX_ATTEMPTS = 60;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const rng = createRng(baseSeed + attempt * 7919);
    const vocab = pickVocabulary(rng);
    const result = tryGenerate(rng, profile, vocab, missionNumber);
    if (result) {
      return ok({
        spec: result.spec,
        solution: result.solution,
        seed: baseSeed + attempt * 7919,
        missionNumber,
      });
    }
  }

  return err({ type: 'GenerationFailed', attempts: MAX_ATTEMPTS });
};

/** 盤面が本当に解けるかを、想定解を再生して確かめる。テストと生成時の自己検証に使う。 */
export const verifySolvable = (
  generated: GeneratedStage,
): boolean => {
  let state = createTimeline({
    initialFacts: generated.spec.initialFacts,
    rootMessage: generated.spec.rootMessage,
  });
  for (const step of generated.spec.setup ?? []) {
    const next = executeAbility(state, step);
    if (!next.ok) return false;
    state = next.value;
  }
  for (const command of generated.solution) {
    const next = executeAbility(state, command, generated.spec.abilities);
    if (!next.ok) return false;
    state = next.value;
  }
  void resolveHead(state);
  return true;
};
