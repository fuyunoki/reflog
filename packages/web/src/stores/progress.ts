/**
 * プレイヤーの記録。
 *
 * 未ログインでも遊べることを崩さないため、既定では端末内の匿名 ID で記録する。
 * ログインを実装する際は、ここで注入するリポジトリを D1 版に差し替え、
 * mergeProgress でローカルの記録を統合する。
 */
import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type {
  DifficultyLevel,
  GeneratedStage,
  MissionOutcome,
  PlayerProgress,
  StageId,
  StageSession,
} from '@reflog/core';
import {
  emptyProgress,
  generateMission,
  recordClearance,
  recordMission,
  toWorldHistory,
} from '@reflog/core';
import {
  LOCAL_PLAYER_ID,
  progressRepository,
} from '@/infrastructure/LocalStorageProgressRepository';

export const useProgressStore = defineStore('progress', () => {
  const progress = shallowRef<PlayerProgress>(emptyProgress(LOCAL_PLAYER_ID));
  const loaded = shallowRef(false);

  const difficulty = computed<DifficultyLevel>(() => progress.value.currentDifficulty);
  const missionNumber = computed(() => progress.value.nextMissionNumber);
  const history = computed(() => toWorldHistory(progress.value));
  const clearedCount = computed(
    () => Object.values(progress.value.records).filter((r) => r.cleared).length,
  );

  const isCleared = (stageId: StageId): boolean =>
    progress.value.records[stageId]?.cleared ?? false;

  const recordOf = (stageId: StageId) => progress.value.records[stageId];

  async function load(): Promise<void> {
    progress.value = await progressRepository.load(LOCAL_PLAYER_ID);
    loaded.value = true;
  }

  async function persist(): Promise<void> {
    await progressRepository.save(progress.value);
  }

  /** 本編のクリアを記録する。決断もここで積まれる。 */
  async function recordClear(stageId: StageId, session: StageSession): Promise<void> {
    progress.value = recordClearance(progress.value, stageId, session);
    await persist();
  }

  /** 観測任務の結果を記録し、次の警戒度を決める。 */
  async function recordMissionResult(outcome: MissionOutcome): Promise<void> {
    progress.value = recordMission(progress.value, outcome);
    await persist();
  }

  /** 次の観測任務を引く。番号と警戒度から決定的に生成される。 */
  function drawMission(): GeneratedStage | null {
    const result = generateMission(missionNumber.value, difficulty.value);
    return result.ok ? result.value : null;
  }

  /** 番号を指定して同じ任務を再現する（共有・やり直し用）。 */
  function drawMissionByNumber(
    number: number,
    level: DifficultyLevel = difficulty.value,
  ): GeneratedStage | null {
    const result = generateMission(number, level);
    return result.ok ? result.value : null;
  }

  return {
    progress,
    loaded,
    difficulty,
    missionNumber,
    history,
    clearedCount,
    isCleared,
    recordOf,
    load,
    persist,
    recordClear,
    recordMissionResult,
    drawMission,
    drawMissionByNumber,
  };
});
