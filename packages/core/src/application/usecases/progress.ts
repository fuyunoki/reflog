/**
 * プレイヤーの記録の操作。
 *
 * 記録は単なるセーブデータではなく「そのプレイヤーが作った世界」なので、
 * 上書きではなく積み上げとして扱う。
 * 未ログインで遊んだ分とアカウントの分を統合できるのも、そのためである。
 */
import { currentWorldState } from '../../domain/timeline/graph.ts';
import type { StageId } from '../../domain/stage/spec.ts';
import type { DifficultyLevel, MissionOutcome } from '../../domain/stage/difficulty.ts';
import { adaptDifficulty } from '../../domain/stage/difficulty.ts';
import type { RecordedChoice, WorldHistory } from '../../domain/campaign/types.ts';
import type { PlayerId, PlayerProgress, StageRecord } from '../ports/index.ts';
import type { StageSession } from './stageSession.ts';

/** 直近どれだけの成績を難易度調整に使うか。 */
const MISSION_LOG_LIMIT = 20;

export const emptyProgress = (
  playerId: PlayerId,
  now: string = new Date().toISOString(),
): PlayerProgress => ({
  playerId,
  records: {},
  choices: [],
  missionLog: [],
  currentDifficulty: 'quiet',
  nextMissionNumber: 1,
  account: null,
  updatedAt: now,
});

/** 条件評価に必要な形へ落とす。ドメインに永続化の都合を持ち込まないための変換。 */
export const toWorldHistory = (progress: PlayerProgress): WorldHistory => {
  const cleared = new Set<StageId>();
  const perfect = new Set<StageId>();
  for (const record of Object.values(progress.records)) {
    if (record.cleared) cleared.add(record.stageId);
    if (record.perfect) perfect.add(record.stageId);
  }
  return { clearedStages: cleared, perfectStages: perfect, choices: progress.choices };
};

/**
 * このプレイで下した決断を抜き出す。
 *
 * 採用された値は、コマンドではなく到達した世界の状態から読む。
 * ours / theirs のどちらを選んだかだけでは実際の値が決まらないため。
 */
export const extractChoices = (
  stageId: StageId,
  session: StageSession,
  now: string = new Date().toISOString(),
): readonly RecordedChoice[] => {
  const world = currentWorldState(session.timeline);
  const out: RecordedChoice[] = [];

  for (const command of session.commands) {
    if (command.kind !== 'merge' || !command.resolutions) continue;
    for (const [key, resolution] of Object.entries(command.resolutions)) {
      out.push({
        stageId,
        key,
        side: resolution.type,
        value: world.ok ? (world.value[key] ?? null) : null,
        at: now,
      });
    }
  }
  return out;
};

const isBetter = (next: StageRecord, prev: StageRecord | undefined): boolean => {
  if (!prev) return true;
  if (next.perfect !== prev.perfect) return next.perfect;
  if (next.bestMoves !== prev.bestMoves) return next.bestMoves < prev.bestMoves;
  return next.bestCausalLoad < prev.bestCausalLoad;
};

/** クリアを記録する。より良い結果でなければ記録は据え置き、決断だけを積む。 */
export const recordClearance = (
  progress: PlayerProgress,
  stageId: StageId,
  session: StageSession,
  now: string = new Date().toISOString(),
): PlayerProgress => {
  if (session.status !== 'cleared') return progress;

  const candidate: StageRecord = {
    stageId,
    cleared: true,
    perfect: session.report.perfect,
    bestMoves: session.movesUsed,
    bestCausalLoad: session.causalLoad,
    bestSolution: session.commands,
    clearedAt: now,
  };

  const previous = progress.records[stageId];
  const records = isBetter(candidate, previous)
    ? { ...progress.records, [stageId]: candidate }
    : progress.records;

  return {
    ...progress,
    records,
    choices: [...progress.choices, ...extractChoices(stageId, session, now)],
    updatedAt: now,
  };
};

/** 観測任務の結果を記録し、次の難易度を決める。 */
export const recordMission = (
  progress: PlayerProgress,
  outcome: MissionOutcome,
  now: string = new Date().toISOString(),
): PlayerProgress => {
  const missionLog = [...progress.missionLog, outcome].slice(-MISSION_LOG_LIMIT);
  return {
    ...progress,
    missionLog,
    currentDifficulty: adaptDifficulty(progress.currentDifficulty, missionLog),
    nextMissionNumber: progress.nextMissionNumber + 1,
    updatedAt: now,
  };
};

/** セッションから観測任務の成績を作る。 */
export const outcomeOf = (
  session: StageSession,
  expectedMoves: number,
  usedHint: boolean,
  retries: number,
): MissionOutcome => ({
  cleared: session.status === 'cleared',
  moveOverhead: session.movesUsed - expectedMoves,
  usedHint,
  retries,
});

/**
 * 未ログインで遊んだ記録とアカウントの記録を統合する。
 *
 * どちらかを捨てるのではなく、ステージごとに良い方を残し、決断は時系列で束ねる。
 * 「消してしまえば、誰も悼めなくなる」というこのゲームの主題に、実装としても従う。
 */
export const mergeProgress = (
  local: PlayerProgress,
  remote: PlayerProgress,
): PlayerProgress => {
  const records: Record<StageId, StageRecord> = { ...remote.records };
  for (const [stageId, record] of Object.entries(local.records)) {
    if (isBetter(record, records[stageId])) records[stageId] = record;
  }

  const seen = new Set<string>();
  const choices = [...remote.choices, ...local.choices]
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((c) => {
      const key = `${c.stageId}|${c.key}|${c.at}|${c.side}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const missionLog = [...remote.missionLog, ...local.missionLog].slice(-MISSION_LOG_LIMIT);
  const newer = local.updatedAt.localeCompare(remote.updatedAt) >= 0 ? local : remote;

  const difficulty: DifficultyLevel = newer.currentDifficulty;

  return {
    playerId: remote.playerId,
    records,
    choices,
    missionLog,
    currentDifficulty: difficulty,
    nextMissionNumber: Math.max(local.nextMissionNumber, remote.nextMissionNumber),
    account: local.account ?? remote.account,
    updatedAt: newer.updatedAt,
  };
};
