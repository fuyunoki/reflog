/**
 * ステージ定義。JSON にそのまま書ける形にしてある。
 * シナリオを増やす作業＝ JSON を 1 つ足す作業、という状態を維持する。
 */
import { type Result, ok } from '../shared/result.ts';
import type { DomainError } from '../shared/errors.ts';
import { createTimeline } from '../timeline/operations.ts';
import { executeAbility } from '../ability/execute.ts';
import type { AbilityCommand, AbilityKind } from '../ability/types.ts';
import type { FactKey, TimelineState, WorldState } from '../timeline/types.ts';
import type { DifficultyLevel } from './difficulty.ts';
import type { Goal } from './goal.ts';
import type { GuideStep } from './guide.ts';

export type StageId = string;

/** 章。プレイヤーに解放する能力の単位でもある。 */
export interface ChapterRef {
  readonly number: number;
  readonly title: string;
}

export interface StageSpec {
  readonly id: StageId;
  readonly title: string;
  readonly chapter: ChapterRef;
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
