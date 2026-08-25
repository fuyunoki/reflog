/**
 * 本編（手作りの章）の進行と分岐。
 *
 * このゲームでは、conflict でどちらの現実を選んだかがそのまま物語の分岐になる。
 * その決断を RecordedChoice として積み上げ、後の章の解放条件として参照する。
 * つまりプレイヤーの記録そのものが「そのプレイヤーが作った世界」になる。
 */
import type { FactKey, FactValue } from '../timeline/types.ts';
import type { StageId } from '../stage/spec.ts';

/** conflict に対する決断の記録。 */
export interface RecordedChoice {
  readonly stageId: StageId;
  readonly key: FactKey;
  readonly side: 'ours' | 'theirs' | 'custom';
  /** 実際に採用された値。事実を消す決断だった場合は null。 */
  readonly value: FactValue | null;
  readonly at: string;
}

/** 章や分岐の解放条件。プレイヤーがこれまでに作ってきた世界を参照する。 */
export type WorldCondition =
  | { readonly type: 'stageCleared'; readonly stageId: StageId }
  | { readonly type: 'stagePerfect'; readonly stageId: StageId }
  /** 特定の conflict で、どちら側を選んだか。 */
  | {
      readonly type: 'choseSide';
      readonly stageId: StageId;
      readonly key: FactKey;
      readonly side: 'ours' | 'theirs' | 'custom';
    }
  /** 特定の事実が、最終的にどの値で決着したか。 */
  | {
      readonly type: 'choseValue';
      readonly stageId: StageId;
      readonly key: FactKey;
      readonly value: FactValue;
    }
  /** ある事実について、これまでに一度でも決断したか。 */
  | { readonly type: 'everDecided'; readonly key: FactKey }
  | { readonly type: 'clearedCount'; readonly atLeast: number }
  | { readonly type: 'and'; readonly all: readonly WorldCondition[] }
  | { readonly type: 'or'; readonly any: readonly WorldCondition[] }
  | { readonly type: 'not'; readonly of: WorldCondition }
  /** 常に真。分岐の既定ルートに使う。 */
  | { readonly type: 'always' };

/** 章。プレイヤーに能力を解放する単位でもある。 */
export interface ChapterSpec {
  readonly number: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly stages: readonly StageId[];
  /** 章の解放条件。省略時は常に解放。 */
  readonly unlockedBy?: WorldCondition;
  /**
   * この章で新たに解放される能力。
   * 物語の進行と、教えられる git の概念を対応させる。
   */
  readonly unlocksAbilities?: readonly string[];
}

/**
 * 分岐するエピソード。
 * 同じ章の同じ位置に複数の候補を置き、条件に合う最初のものを配信する。
 */
export interface BranchingEpisode {
  readonly slot: string;
  readonly candidates: readonly {
    readonly stageId: StageId;
    readonly when: WorldCondition;
  }[];
}

export interface CampaignSpec {
  readonly chapters: readonly ChapterSpec[];
  readonly episodes?: readonly BranchingEpisode[];
}

/** 条件評価に必要な、プレイヤーの歩みだけを抜き出したもの。 */
export interface WorldHistory {
  readonly clearedStages: ReadonlySet<StageId>;
  readonly perfectStages: ReadonlySet<StageId>;
  readonly choices: readonly RecordedChoice[];
}
