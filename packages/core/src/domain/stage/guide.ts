/**
 * 手引き。プレイヤーが「次に何をすればいいか」を見失わないための段組み。
 *
 * このゲームは、いきなり盤面と目標だけを出されても何をする遊びなのか分からない。
 * 世界線・時点・矛盾といった語も、初見では意味が取れない。
 * そこで各ステージに手引きを持たせ、条件を満たすごとに次の段へ進むようにする。
 *
 * 進み具合はセッションから導出するだけで、状態を別に持たない。
 * アンドゥしても手引きが取り残されない。
 */
import type { AbilityKind } from '../ability/types.ts';
import type { AbilityCommand } from '../ability/types.ts';
import type { CommitId } from '../timeline/types.ts';
import type { GoalReport } from './goal.ts';

export type GuideCondition =
  /** 何らかの時点を選ぶ（commitId を指定すればその時点に限る）。 */
  | { readonly type: 'commitSelected'; readonly commitId?: CommitId }
  /** ある能力を使う。 */
  | { readonly type: 'abilityUsed'; readonly ability: AbilityKind }
  /** ある達成条件を満たす。 */
  | { readonly type: 'goalSatisfied'; readonly goalId: string }
  /** ステージをクリアする。最後の段に使う。 */
  | { readonly type: 'cleared' }
  /** 読むだけで進む段（次の段の条件で自動的に押し出される）。 */
  | { readonly type: 'acknowledged' };

export interface GuideStep {
  /** 画面に出す一文。命令形ではなく、何をすればよいかを示す。 */
  readonly text: string;
  /** 補足。用語の説明などに使う。 */
  readonly note?: string;
  /** この条件を満たすと次の段へ進む。 */
  readonly until: GuideCondition;
}

export interface GuideState {
  /** 現在の段。すべて満たしていれば null。 */
  readonly current: GuideStep | null;
  readonly index: number;
  readonly total: number;
  readonly finished: boolean;
}

export interface GuideInput {
  readonly selected: CommitId | null;
  readonly commands: readonly AbilityCommand[];
  readonly report: GoalReport;
  readonly cleared: boolean;
  /** 読むだけの段を、プレイヤーが読み終えた数。 */
  readonly acknowledged: number;
}

const satisfied = (
  condition: GuideCondition,
  input: GuideInput,
  stepIndex: number,
): boolean => {
  switch (condition.type) {
    case 'commitSelected':
      return condition.commitId === undefined
        ? input.selected !== null
        : input.selected === condition.commitId;
    case 'abilityUsed':
      return input.commands.some((command) => command.kind === condition.ability);
    case 'goalSatisfied':
      return input.report.statuses.some(
        (status) => status.id === condition.goalId && status.satisfied,
      );
    case 'cleared':
      return input.cleared;
    case 'acknowledged':
      return input.acknowledged > stepIndex;
  }
};

/** いま見せるべき段を求める。満たしていない最初の段が現在地になる。 */
export const resolveGuide = (
  steps: readonly GuideStep[] | undefined,
  input: GuideInput,
): GuideState => {
  if (!steps || steps.length === 0) {
    return { current: null, index: 0, total: 0, finished: true };
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] as GuideStep;
    if (!satisfied(step.until, input, index)) {
      return { current: step, index, total: steps.length, finished: false };
    }
  }

  return { current: null, index: steps.length, total: steps.length, finished: true };
};
