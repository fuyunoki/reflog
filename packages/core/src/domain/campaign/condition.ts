/**
 * 分岐条件の評価と、章の解放判定。
 *
 * 入力は WorldHistory だけに絞ってある。PlayerProgress（永続化の都合を含む型）を
 * ドメインに持ち込まないことで、依存の向きを内向きに保つ。
 */
import type { FactKey } from '../timeline/types.ts';
import type { StageId } from '../stage/spec.ts';
import type {
  BranchingEpisode,
  CampaignSpec,
  ChapterSpec,
  RecordedChoice,
  WorldCondition,
  WorldHistory,
} from './types.ts';

/** 同じ事実に何度も決断していれば、最後の決断を採る。 */
const latestChoice = (
  history: WorldHistory,
  stageId: StageId,
  key: FactKey,
): RecordedChoice | undefined => {
  let found: RecordedChoice | undefined;
  for (const choice of history.choices) {
    if (choice.stageId === stageId && choice.key === key) found = choice;
  }
  return found;
};

export const evaluateCondition = (
  history: WorldHistory,
  condition: WorldCondition,
): boolean => {
  switch (condition.type) {
    case 'always':
      return true;
    case 'stageCleared':
      return history.clearedStages.has(condition.stageId);
    case 'stagePerfect':
      return history.perfectStages.has(condition.stageId);
    case 'choseSide': {
      const choice = latestChoice(history, condition.stageId, condition.key);
      return choice?.side === condition.side;
    }
    case 'choseValue': {
      const choice = latestChoice(history, condition.stageId, condition.key);
      return choice?.value === condition.value;
    }
    case 'everDecided':
      return history.choices.some((c) => c.key === condition.key);
    case 'clearedCount':
      return history.clearedStages.size >= condition.atLeast;
    case 'and':
      return condition.all.every((c) => evaluateCondition(history, c));
    case 'or':
      return condition.any.some((c) => evaluateCondition(history, c));
    case 'not':
      return !evaluateCondition(history, condition.of);
  }
};

export const isChapterUnlocked = (
  history: WorldHistory,
  chapter: ChapterSpec,
): boolean =>
  chapter.unlockedBy === undefined || evaluateCondition(history, chapter.unlockedBy);

export const unlockedChapters = (
  history: WorldHistory,
  campaign: CampaignSpec,
): readonly ChapterSpec[] =>
  campaign.chapters
    .filter((chapter) => isChapterUnlocked(history, chapter))
    .sort((a, b) => a.number - b.number);

/**
 * 分岐エピソードの配信先を決める。
 * 候補は上から順に評価し、条件を満たした最初のものを返す。
 * 既定ルートは末尾に { type: 'always' } を置いておくこと。
 */
export const resolveEpisode = (
  history: WorldHistory,
  episode: BranchingEpisode,
): StageId | null => {
  for (const candidate of episode.candidates) {
    if (evaluateCondition(history, candidate.when)) return candidate.stageId;
  }
  return null;
};

/** 次に挑むべきステージ。解放済みの章を順に見て、未クリアの最初のものを返す。 */
export const nextStage = (
  history: WorldHistory,
  campaign: CampaignSpec,
): StageId | null => {
  for (const chapter of unlockedChapters(history, campaign)) {
    for (const stageId of chapter.stages) {
      if (!history.clearedStages.has(stageId)) return stageId;
    }
  }
  return null;
};

/** 本編の到達率。0〜1。 */
export const campaignProgress = (
  history: WorldHistory,
  campaign: CampaignSpec,
): number => {
  const all = campaign.chapters.flatMap((c) => c.stages);
  if (all.length === 0) return 0;
  const done = all.filter((id) => history.clearedStages.has(id)).length;
  return done / all.length;
};
