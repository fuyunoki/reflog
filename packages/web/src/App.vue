<script setup lang="ts">
/**
 * 画面の切り替え。
 *
 * ルーターは入れていない。画面が 2 つしかない今の段階では、
 * 状態ひとつで足りるものに依存を増やす理由がないため。
 */
import { computed, onMounted, ref } from 'vue';
import type { GeneratedStage, StageSpec } from '@reflog/core';
import { DIFFICULTIES, countsAsMove } from '@reflog/core';
import { useProgressStore } from '@/stores/progress';
import { useSessionStore } from '@/stores/session';
import { stageSource } from '@/infrastructure/StaticStageSource';
import StageView from '@/presentation/views/StageView.vue';

type Screen = 'home' | 'stage';

const progress = useProgressStore();
const session = useSessionStore();

const screen = ref<Screen>('home');
const current = ref<StageSpec | null>(null);
/** 観測任務のときだけ入る。想定解の手数を成績評価に使う。 */
const currentMission = ref<GeneratedStage | null>(null);

const campaignStages = computed(() =>
  stageSource.all.filter((spec) => spec.chapter.number > 0),
);

const difficultyLabel = computed(() => DIFFICULTIES[progress.difficulty].label);

onMounted(async () => {
  await progress.load();
});

const openStage = (spec: StageSpec): void => {
  currentMission.value = null;
  current.value = spec;
  screen.value = 'stage';
};

const drawMission = (): void => {
  const mission = progress.drawMission();
  if (!mission) {
    session.notify('任務の生成に失敗した。もう一度試してほしい。', 'error');
    return;
  }
  currentMission.value = mission;
  current.value = mission.spec;
  screen.value = 'stage';
};

const onCleared = async (): Promise<void> => {
  const spec = current.value;
  const played = session.session;
  if (!spec || !played) return;

  if (currentMission.value) {
    const expected = currentMission.value.solution.filter(countsAsMove).length;
    await progress.recordMissionResult({
      cleared: true,
      moveOverhead: played.movesUsed - expected,
      usedHint: session.usedHint,
      retries: session.retries,
    });
  } else {
    await progress.recordClear(spec.id, played);
  }
};

const onNext = (): void => {
  if (currentMission.value) {
    drawMission();
    return;
  }
  screen.value = 'home';
  current.value = null;
};

const exit = (): void => {
  screen.value = 'home';
  current.value = null;
  currentMission.value = null;
};
</script>

<template>
  <StageView
    v-if="screen === 'stage' && current"
    :spec="current"
    @cleared="onCleared"
    @next="onNext"
    @exit="exit"
  />

  <main v-else class="home">
    <header class="masthead">
      <h1 class="wordmark">REFLOG</h1>
      <p class="tagline jp">
        消したはずのものの記録を辿り、壊れた世界線を修復する。
      </p>
    </header>

    <section class="block">
      <div class="block-head">
        <span class="label">本編</span>
        <span class="label">{{ progress.clearedCount }} 件 修正済み</span>
      </div>
      <div class="list">
        <button
          v-for="spec in campaignStages"
          :key="spec.id"
          class="entry"
          type="button"
          @click="openStage(spec)"
        >
          <span class="entry-no">
            CH {{ String(spec.chapter.number).padStart(2, '0') }}
          </span>
          <span class="entry-main">
            <span class="entry-title jp">{{ spec.title }}</span>
            <span class="entry-sub jp">{{ spec.chapter.title }}</span>
          </span>
          <span class="entry-state" :class="{ done: progress.isCleared(spec.id) }">
            {{ progress.isCleared(spec.id) ? '修正済み' : '未修正' }}
          </span>
        </button>
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <span class="label">観測任務</span>
        <span class="label">{{ difficultyLabel }}</span>
      </div>
      <p class="note jp">
        観測局から配信される異常。番号と警戒度から自動で組まれるため、尽きることがない。
        成績に応じて警戒度が上下する。
      </p>
      <button class="btn primary mission" type="button" @click="drawMission">
        任務 #{{ progress.missionNumber }} を受領する
      </button>
    </section>

    <footer class="foot">
      <span class="label">記録はこの端末に保存されている</span>
    </footer>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  max-width: 720px;
  margin: 0 auto;
  padding: clamp(28px, 6vw, 72px) 20px 48px;
  display: flex;
  flex-direction: column;
  gap: 34px;
}

.masthead {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wordmark {
  font-family: var(--sans);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.03em;
  line-height: 1;
  font-size: clamp(46px, 13vw, 108px);
  margin: 0;
  color: var(--ink);
}

.tagline {
  margin: 0;
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.8;
  max-width: 46ch;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--rule-firm);
  padding-bottom: 6px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--rule);
}

.entry {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  text-align: left;
  background: var(--panel);
  border: none;
  border-radius: 0;
  padding: 14px;
  cursor: pointer;
  color: var(--ink);
  transition: background 120ms linear;
}
.entry:hover {
  background: var(--panel-hi);
}
.entry:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.entry-no {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
  letter-spacing: 0.04em;
}

.entry-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.entry-title {
  font-size: 14px;
  font-weight: 500;
}

.entry-sub {
  font-size: 11px;
  color: var(--ink-faint);
}

.entry-state {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
  white-space: nowrap;
}
.entry-state.done {
  color: var(--ok);
}

.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.75;
  color: var(--ink-muted);
  max-width: 52ch;
}

.mission {
  align-self: flex-start;
  font-family: var(--mono);
  font-size: 12px;
}

.foot {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid var(--rule);
}
</style>
