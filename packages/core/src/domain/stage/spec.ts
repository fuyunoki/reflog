/**
 * ステージ定義。JSON にそのまま書ける形にしてある。
 * シナリオを増やす作業＝ JSON を 1 つ足す作業、という状態を維持する。
 */
import { type Result, ok } from '../shared/result.ts';
import type { DomainError } from '../shared/errors.ts';
import { createTimeline } from '../timeline/operations.ts';
import { executeAbility } from '../ability/execute.ts';
import type { AbilityCommand, AbilityKind } from '../ability/types.ts';
import type { ChangeSet } from '../timeline/types.ts';
import type { FactKey, TimelineState, WorldState } from '../timeline/types.ts';
import type { DifficultyLevel } from './difficulty.ts';
import type { WorldCondition } from '../campaign/types.ts';
import type { Goal } from './goal.ts';
import type { GuideStep } from './guide.ts';

export type StageId = string;

/**
 * このステージで刻める出来事。
 *
 * git の commit は「何を変えるか」を作業者が決めるが、
 * ゲームでは世界に対して何が起こせるかをステージ側が用意する。
 * プレイヤーは、その中から何を起こすかを選ぶ。
 */
export interface CommitOffer {
  readonly id: string;
  /** 記録に残る一文。git のコミットメッセージにあたる。 */
  readonly message: string;
  readonly changes: ChangeSet;
  readonly narrative?: string;
}

/** 章。プレイヤーに解放する能力の単位でもある。 */
export interface ChapterRef {
  readonly number: number;
  readonly title: string;
  /**
   * 訓練か本編か。
   * 訓練は「どの術式を、どの順で渡すか」で段階が分かれる。
   * 省略時は number が 0 のものを訓練とみなす。
   */
  readonly kind?: 'training' | 'story';
}

/**
 * ステージ冒頭の見出し。
 *
 * 「いつ・どこの話か」が本文を読まないと分からない、という指摘への対応。
 * 項目を固定せず行の並びにしてあるのは、本編（年月・場所・分類・関係者）と
 * 訓練（演習番号・分類・主題）で必要な欄が違うため。
 */
export interface BriefingLine {
  readonly label: string;
  readonly value: string;
}

export interface StageSpec {
  readonly id: StageId;
  readonly title: string;
  readonly chapter: ChapterRef;
  /** 冒頭に出す見出し。本文より先に目に入る位置に置く。 */
  readonly briefing?: readonly BriefingLine[];
  /** ステージ開始時に読ませる導入テキスト。 */
  readonly intro: readonly string[];
  /** クリア時に読ませるテキスト。 */
  readonly outro?: readonly string[];

  /** 初期世界の事実。 */
  readonly initialFacts: WorldState;
  readonly rootMessage: string;
  readonly rootNarrative?: string;
  /**
   * 初期グラフを組み立てる手順。
   * 盤面をコマンド列で表現することで、エンジン自身が唯一の真実であり続ける。
   */
  readonly setup?: readonly AbilityCommand[];

  readonly goals: readonly Goal[];
  /** このステージで行使できる能力。ここに無い能力はエラーになる。 */
  readonly abilities: readonly AbilityKind[];
  /** 手数の上限。未指定なら無制限。 */
  readonly moveLimit?: number;
  /** 因果負荷の上限。未指定なら無制限。 */
  readonly causalLoadLimit?: number;
  /** 詰まったときに段階的に開示するヒント。 */
  readonly hints?: readonly string[];

  /** COMMIT で刻める出来事の候補。無ければ commit は使えない。 */
  readonly offers?: readonly CommitOffer[];
  /**
   * 手引き。条件を満たすごとに次の段へ進み、常に「次にすること」が画面に出る。
   * 初めて触る章ほど厚くし、慣れた章では省いてよい。
   */
  readonly guide?: readonly GuideStep[];

  /**
   * 事実キーの表示名。Presentation 層だけが使う。
   * 自動生成ステージでは、同じキーに毎回違う語彙を割り当てるために利用する。
   */
  readonly factLabels?: Readonly<Record<FactKey, string>>;
  /** 事実の値の表示名。 */
  readonly valueLabels?: Readonly<Record<string, string>>;
  /** 自動生成ステージの警戒度。手作りステージでは省略してよい。 */
  readonly difficulty?: DifficultyLevel;

  /**
   * 章の中での並び順。小さいほど先。
   * ID の採番と学習の順序は必ずしも一致しないので、順序は明示する。
   */
  readonly order?: number;

  /**
   * このステージで新しく渡す術式。1 ステージにつき 1 つ。
   * 一覧で「何を覚える回か」を示すのに使う。
   */
  readonly teaches?: AbilityKind;

  /**
   * このステージが選べるようになる条件。省略時は最初から開いている。
   *
   * 順に解放していくことで、新しい能力を覚える順序が保証される。
   * 条件はプレイヤーの記録（クリア状況と過去の決断）から評価する。
   */
  readonly unlockedBy?: WorldCondition;
}

/**
 * ステージ定義から初期タイムラインを構築する。
 * setup の実行では能力制限を適用しない（盤面作成は作者の権限であるため）。
 */
export const buildInitialTimeline = (
  spec: StageSpec,
): Result<TimelineState, DomainError> => {
  let state = createTimeline({
    initialFacts: spec.initialFacts,
    rootMessage: spec.rootMessage,
    rootNarrative: spec.rootNarrative,
  });

  for (const step of spec.setup ?? []) {
    const next = executeAbility(state, step);
    if (!next.ok) return next;
    state = next.value;
  }

  return ok(state);
};
