<script setup lang="ts">
/**
 * ステージのプレイ画面。
 *
 * 判断はすべて session ストア（＝ core のユースケース）に委ねてあり、
 * ここは配置と見せ方だけを受け持つ。
 */
import { computed, onMounted, ref, watch } from 'vue';
import type { BranchName, CommitId, StageSpec } from '@reflog/core';
import { useSessionStore } from '@/stores/session';
import { commitLabel } from '@/presentation/labels';
import TimelineGraph from '@/presentation/components/TimelineGraph.vue';
import AbilityPanel from '@/presentation/components/AbilityPanel.vue';
import GoalList from '@/presentation/components/GoalList.vue';
import RecordPanel from '@/presentation/components/RecordPanel.vue';
import ConflictDialog from '@/presentation/components/ConflictDialog.vue';
import ModalShell from '@/presentation/components/ModalShell.vue';
import CommandConsole from '@/presentation/components/CommandConsole.vue';

const props = defineProps<{ spec: StageSpec }>();
const emit = defineEmits<{
  (e: 'cleared'): void;
  (e: 'exit'): void;
  (e: 'next'): void;
}>();

const store = useSessionStore();
const mergePickerOpen = ref(false);

onMounted(() => store.start(props.spec));
watch(() => props.spec.id, () => store.start(props.spec));

watch(
  () => store.cleared,
  (isCleared) => {
    if (isCleared) emit('cleared');
  },
);

/**
 * 異常として赤で示す時点。
 * 「消してはいけない記録」を守れという達成条件が、そのまま異常の在り処を指している。
 */
const anomalyIds = computed<readonly CommitId[]>(() =>
  props.spec.goals
    .map((goal) => (goal.predicate.type === 'historyPreserved' ? goal.predicate.commitId : null))
    .filter((id): id is CommitId => id !== null),
);

const moveText = computed(() => {
  const used = store.session?.movesUsed ?? 0;
  return props.spec.moveLimit === undefined ? `${used}` : `${used}/${props.spec.moveLimit}`;
});

const loadText = computed(() => {
  const used = store.session?.causalLoad ?? 0;
  return props.spec.causalLoadLimit === undefined
    ? `${used}`
    : `${used}/${props.spec.causalLoadLimit}`;
});

const movesTight = computed(
  () =>
    props.spec.moveLimit !== undefined &&
    (store.session?.movesUsed ?? 0) >= props.spec.moveLimit,
);

const loadTight = computed(
  () =>
    props.spec.causalLoadLimit !== undefined &&
    (store.session?.causalLoad ?? 0) >= props.spec.causalLoadLimit,
);

const onMerge = (): void => {
  if (store.mergeableBranches.length === 1) {
    store.attemptMerge(store.mergeableBranches[0] as BranchName);
    return;
  }
  mergePickerOpen.value = true;
};

const pickMerge = (branch: BranchName): void => {
  mergePickerOpen.value = false;
  store.attemptMerge(branch);
};

/** 分岐の名前は自動で振る。命名そのものはこのゲームの主題ではない。 */
const onBranch = (): void => {
  if (!store.selected || !store.timeline) return;
  const existing = Object.keys(store.timeline.branches).length;
  store.play({ kind: 'branch', name: `line-${existing + 1}`, at: store.selected });
};
</script>

<template>
  <div v-if="store.session && store.timeline && store.report" class="app">
    <header class="bar">
      <div class="identity">
        <span class="chapter">
          {{ spec.chapter.number > 0 ? `CH ${String(spec.chapter.number).padStart(2, '0')}` : 'MISSION' }}
          — {{ spec.chapter.title }}
        </span>
        <h1 class="head jp title">{{ spec.title }}</h1>
        <span class="label">STAGE {{ spec.id.toUpperCase() }}</span>
      </div>

      <div class="meters">
        <div class="meter">
          <span class="label">手数</span>
          <span class="value" :class="{ tight: movesTight }">{{ moveText }}</span>
        </div>
        <div class="meter">
          <span class="label">因果負荷</span>
          <span class="value" :class="{ tight: loadTight }">{{ loadText }}</span>
        </div>
        <div class="mode-switch" role="group" aria-label="操作方法">
          <button
            type="button"
            :class="{ active: store.inputMode === 'panel' }"
            :aria-pressed="store.inputMode === 'panel'"
            @click="store.setMode('panel')"
          >
            パネル
          </button>
          <button
            type="button"
            :class="{ active: store.inputMode === 'console' }"
            :aria-pressed="store.inputMode === 'console'"
            @click="store.setMode('console')"
          >
            コンソール
          </button>
        </div>
        <button class="btn" type="button" @click="store.restart()">やり直す</button>
        <button class="btn" type="button" @click="emit('exit')">戻る</button>
      </div>
    </header>

    <div class="grid" :class="{ 'is-console': store.inputMode === 'console' }">
      <CommandConsole
        v-if="store.inputMode === 'console'"
        :lines="store.consoleLines"
        :history="store.commandHistory"
        @run="store.runCommand($event)"
      />

      <AbilityPanel
        v-else
        :abilities="spec.abilities"
        :state="store.timeline"
        :selected="store.selected"
        :branches="store.branches"
        :mergeable="store.mergeableBranches"
        :can-undo="store.canUndo"
        :has-hints="(spec.hints?.length ?? 0) > 0"
        @revert="store.revertSelected()"
        @merge="onMerge"
        @branch="onBranch"
        @checkout="store.checkout($event)"
        @undo="store.undo()"
        @hint="store.revealHint()"
      />

      <section class="viewport">
        <TimelineGraph
          :state="store.timeline"
          :selected="store.selected"
          :anomaly-ids="anomalyIds"
          @select="store.select($event)"
        />
        <div class="legend">
          <span class="label">● 現在地</span>
          <span class="label accent">◎ 異常</span>
        </div>
      </section>

      <aside class="pane">
        <div class="stack">
          <span class="label">達成すべき世界の状態</span>
          <GoalList :report="store.report" />
        </div>
      </aside>
    </div>

    <RecordPanel :spec="spec" :state="store.timeline" :focused="store.focusedCommit" />
  </div>

  <!-- 導入 -->
  <ModalShell :open="store.introOpen" @close="store.introOpen = false">
    <span class="label">STAGE {{ spec.id.toUpperCase() }}</span>
    <h2 class="head jp">{{ spec.title }}</h2>
    <div class="jp prose">
      <p v-for="(line, i) in spec.intro" :key="i">{{ line }}</p>
    </div>
    <div class="actions">
      <button class="btn primary" type="button" @click="store.introOpen = false">
        観測を開始する
      </button>
    </div>
  </ModalShell>

  <!-- 統合先の選択 -->
  <ModalShell :open="mergePickerOpen" @close="mergePickerOpen = false">
    <span class="label">MERGE — 世界線の統合</span>
    <h2 class="head jp">どの世界線を取り込みますか</h2>
    <div class="picker">
      <button
        v-for="branch in store.mergeableBranches"
        :key="branch"
        class="pick"
        type="button"
        @click="pickMerge(branch)"
      >
        <span class="pick-name">{{ branch }}</span>
        <span class="pick-tip">
          tip = {{ commitLabel(store.timeline?.branches[branch] ?? '') }}
        </span>
      </button>
    </div>
    <div class="actions">
      <button class="btn" type="button" @click="mergePickerOpen = false">やめる</button>
    </div>
  </ModalShell>

  <!-- 矛盾 -->
  <ConflictDialog
    v-if="store.pendingConflict"
    :open="true"
    :spec="spec"
    :from="store.pendingConflict.from"
    :conflicts="store.pendingConflict.analysis.conflicts"
    :choices="store.conflictChoices"
    :all-decided="store.allConflictsDecided"
    @decide="(key, resolution) => store.decide(key, resolution)"
    @confirm="store.commitConflict()"
    @cancel="store.cancelConflict()"
  />

  <!-- クリア -->
  <ModalShell :open="store.outroOpen" @close="store.outroOpen = false">
    <span class="label">
      STAGE CLEARED<template v-if="store.report?.perfect"> — 完全達成</template>
    </span>
    <h2 class="head jp">世界線は修正された</h2>
    <div class="jp prose">
      <p v-for="(line, i) in spec.outro ?? []" :key="i">{{ line }}</p>
    </div>
    <div class="summary">
      手数 {{ moveText }}　　因果負荷 {{ loadText }}
    </div>
    <div class="actions">
      <button class="btn" type="button" @click="store.restart()">もう一度</button>
      <button class="btn primary" type="button" @click="emit('next')">次へ</button>
    </div>
  </ModalShell>

  <!-- 通知 -->
  <div v-if="store.notice" class="toast" :class="{ 'is-error': store.notice.tone === 'error' }">
    {{ store.notice.text }}
    <button class="toast-close" type="button" aria-label="閉じる" @click="store.dismissNotice()">
      ×
    </button>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--rule);
  gap: var(--gap);
}

.bar {
  background: var(--panel);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  flex-wrap: wrap;
}

.identity {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.chapter {
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid var(--rule-firm);
  padding: 3px 7px;
  white-space: nowrap;
}

.title {
  font-size: clamp(18px, 2.4vw, 32px);
}

.meters {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.meter {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.value {
  font-family: var(--mono);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.value.tight {
  color: var(--accent);
}

.grid {
  flex: 1;
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr) 260px;
  gap: var(--gap);
  min-height: 0;
}

.grid.is-console {
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr) 260px;
}

.mode-switch {
  display: flex;
  border: 1px solid var(--rule-firm);
}

.mode-switch button {
  font-family: var(--sans);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 6px 10px;
  background: transparent;
  color: var(--ink-muted);
  border: none;
  border-radius: 0;
  cursor: pointer;
}
.mode-switch button + button {
  border-left: 1px solid var(--rule-firm);
}
.mode-switch button.active {
  background: var(--ink);
  color: var(--panel);
}
.mode-switch button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

@media (max-width: 900px) {
  .grid,
  .grid.is-console {
    grid-template-columns: 1fr;
  }
  .viewport {
    min-height: 320px;
  }
}

.pane {
  background: var(--panel);
  padding: 14px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.viewport {
  background: var(--panel-sub);
  position: relative;
  overflow: auto;
}

.legend {
  position: absolute;
  left: 14px;
  bottom: 12px;
  display: flex;
  gap: 14px;
  pointer-events: none;
}
.legend .accent {
  color: var(--accent);
}

.prose p {
  margin: 0 0 10px;
  line-height: 1.8;
}
.prose p:last-child {
  margin-bottom: 0;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.summary {
  font-family: var(--mono);
  font-size: 11px;
  background: var(--panel-hi);
  padding: 10px 12px;
  color: var(--ink-muted);
}

.picker {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rule);
  background: var(--panel-hi);
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  padding: 12px 14px;
  cursor: pointer;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
}
.pick:last-child {
  border-bottom: none;
}
.pick:hover {
  background: var(--accent-wash);
}
.pick:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.pick-tip {
  font-size: 10px;
  color: var(--ink-faint);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  background: var(--ink);
  color: var(--panel);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.03em;
  padding: 9px 12px 9px 16px;
  z-index: 30;
  max-width: calc(100vw - 32px);
  display: flex;
  align-items: center;
  gap: 10px;
}
.toast.is-error {
  background: var(--accent);
  color: #fff;
}

.toast-close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
</style>
