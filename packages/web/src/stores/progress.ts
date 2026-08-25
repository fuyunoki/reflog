/**
 * プレイヤーの記録。
 *
 * 未ログインでも遊べることを崩さないため、保存はまず端末に対して行い、
 * ログインしている場合だけアカウントへ同期する。
 *
 * ログインした瞬間には、端末の記録とアカウントの記録を統合する。
 * どちらかを捨てるようなことはしない —— このゲームの主題に、実装としても従う。
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
  mergeProgress,
  recordClearance,
  recordMission,
  toWorldHistory,
} from '@reflog/core';
import {
  LOCAL_PLAYER_ID,
  LocalStorageProgressRepository,
} from '@/infrastructure/LocalStorageProgressRepository';
import {
  SyncingProgressRepository,
  remoteProgressRepository,
} from '@/infrastructure/SyncingProgressRepository';
import { useAuthStore } from './auth';

const localRepository = new LocalStorageProgressRepository();

export const useProgressStore = defineStore('progress', () => {
  const auth = useAuthStore();
  const repository = new SyncingProgressRepository(() => auth.signedIn);

  const progress = shallowRef<PlayerProgress>(emptyProgress(LOCAL_PLAYER_ID));
  const loaded = shallowRef(false);
  const syncing = shallowRef(false);

  const difficulty = computed<DifficultyLevel>(() => progress.value.currentDifficulty);
  const missionNumber = computed(() => progress.value.nextMissionNumber);
  const history = computed(() => toWorldHistory(progress.value));
  const clearedCount = computed(
    () => Object.values(progress.value.records).filter((r) => r.cleared).length,
  );

  const isCleared = (stageId: StageId): boolean =>
    progress.value.records[stageId]?.cleared ?? false;

  const recordOf = (stageId: StageId) => progress.value.records[stageId];

  const currentPlayerId = (): string => auth.user?.playerId ?? LOCAL_PLAYER_ID;

  async function load(): Promise<void> {
    progress.value = await repository.load(currentPlayerId());
    loaded.value = true;
  }

  async function persist(): Promise<void> {
    await repository.save(progress.value);
  }

  /**
   * ログイン直後に呼ぶ。端末の記録とアカウントの記録を束ねて、両方へ書き戻す。
   */
  async function mergeWithAccount(): Promise<void> {
    if (!auth.signedIn || !auth.user) return;

    syncing.value = true;
    try {
      const local = await localRepository.load(LOCAL_PLAYER_ID);
      const remote = await remoteProgressRepository.load(auth.user.playerId);
      const merged = mergeProgress(local, remote);

      progress.value = merged;
      await repository.save(merged);
      loaded.value = true;
    } catch {
      // 同期できなくても、端末の記録で遊び続けられる
      if (!loaded.value) await load();
    } finally {
      syncing.value = false;
    }
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
    syncing,
    difficulty,
    missionNumber,
    history,
    clearedCount,
    isCleared,
    recordOf,
    load,
    persist,
    mergeWithAccount,
    recordClear,
    recordMissionResult,
    drawMission,
    drawMissionByNumber,
  };
});
