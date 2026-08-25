<script setup lang="ts">
/**
 * ステージのプレイ画面。
 *
 * 判断はすべて session ストア（＝ core のユースケース）に委ねてあり、
 * ここは配置と見せ方だけを受け持つ。
 *
 * レイアウトは画面の高さに固定し、スクロールは各ペインの中だけで起こす。
 * コンソールの出力が増えても画面ごと下に伸びないようにするため。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
import GuidePanel from '@/presentation/components/GuidePanel.vue';

const props = defineProps<{ spec: StageSpec }>();
const emit = defineEmits<{
  (e: 'cleared'): void;
  (e: 'exit'): void;
  (e: 'next'): void;
}>();

const store = useSessionStore();
const mergePickerOpen = ref(false);

onMounted(() => store.start(props.spec));
watch(
  () => props.spec.id,
  () => store.start(props.spec),
);

watch(
  () => store.cleared,
  (isCleared) => {
    if (isCleared) emit('cleared');
  },
);

// --- カラム幅の調整 --------------------------------------------------------

const WIDTH_KEY = 'reflog:column-widths';
const LEFT_RANGE = { min: 200, max: 640 } as const;
const RIGHT_RANGE = { min: 200, max: 520 } as const;
const DEFAULTS = { left: 230, right: 260 } as const;

const clamp = (value: number, range: { min: number; max: number }): number =>
  Math.min(range.max, Math.max(range.min, value));

const readWidths = (): { left: number; right: number } => {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { left?: number; right?: number };
      return {
        left: clamp(parsed.left ?? DEFAULTS.left, LEFT_RANGE),
        right: clamp(parsed.right ?? DEFAULTS.right, RIGHT_RANGE),
      };
    }
  } catch {
    // 保存が壊れていても既定値で続行する
  }
  return { ...DEFAULTS };
};

const stored = readWidths();
const leftWidth = ref(stored.left);
const rightWidth = ref(stored.right);
const dragging = ref<'left' | 'right' | null>(null);

const saveWidths = (): void => {
  try {
    localStorage.setItem(
      WIDTH_KEY,
      JSON.stringify({ left: leftWidth.value, right: rightWidth.value }),
    );
  } catch {
    // 保存できなくても操作そのものは有効
  }
};

const onPointerMove = (event: PointerEvent): void => {
  if (dragging.value === 'left') {
    leftWidth.value = clamp(event.clientX, LEFT_RANGE);
  } else if (dragging.value === 'right') {
    rightWidth.value = clamp(window.innerWidth - event.clientX, RIGHT_RANGE);
  }
};

const endDrag = (): void => {
  if (!dragging.value) return;
  dragging.value = null;
  document.body.style.removeProperty('cursor');
  document.body.style.removeProperty('user-select');
  saveWidths();
};

const startDrag = (side: 'left' | 'right'): void => {
  dragging.value = side;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

/** キーボードでも幅を変えられるようにする。 */
const nudge = (side: 'left' | 'right', delta: number): void => {
  if (side === 'left') leftWidth.value = clamp(leftWidth.value + delta, LEFT_RANGE);
  else rightWidth.value = clamp(rightWidth.value + delta, RIGHT_RANGE);
  saveWidths();
};

const resetWidths = (): void => {
  leftWidth.value = DEFAULTS.left;
  rightWidth.value = DEFAULTS.right;
  saveWidths();
};

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
});
onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  endDrag();
});

// --- 表示用の値 ------------------------------------------------------------

/**
 * 異常として赤で示す時点。
 * 「消してはいけない記録」を守れという達成条件が、そのまま異常の在り処を指している。
 */
const anomalyIds = computed<readonly CommitId[]>(() =>
  props.spec.goals
    .map((goal) =>
      goal.predicate.type === 'historyPreserved' ? goal.predicate.commitId : null,
    )
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
  <div
    v-if="store.session && store.timeline && store.report"
    class="app"
    :class="{ 'is-dragging': dragging !== null }"
    :style="{ '--left-width': `${leftWidth}px`, '--right-width': `${rightWidth}px` }"
  >
    <header class="bar">
      <div class="identity">
        <span class="chapter">
          {{
            spec.chapter.number > 0
              ? `CH ${String(spec.chapter.number).padStart(2, '0')}`
              : 'MISSION'
          }}
          — {{ spec.chapter.title }}
        </span>
        <h1 class="head jp title">{{ spec.title }}</h1>
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

    <div class="grid">
      <div class="col col-left">
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
      </div>

      <div
        class="handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="左の幅を変える"
        tabindex="0"
        @pointerdown.prevent="startDrag('left')"
        @dblclick="resetWidths"
        @keydown.left.prevent="nudge('left', -24)"
        @keydown.right.prevent="nudge('left', 24)"
      />

      <section class="viewport">
        <div v-if="store.guide.current" class="guide-slot">
          <GuidePanel :guide="store.guide" @acknowledge="store.acknowledgeGuide()" />
        </div>

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

      <div
        class="handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="右の幅を変える"
        tabindex="0"
        @pointerdown.prevent="startDrag('right')"
        @dblclick="resetWidths"
        @keydown.left.prevent="nudge('right', 24)"
        @keydown.right.prevent="nudge('right', -24)"
      />

      <aside class="col col-right">
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
    <div class="summary">手数 {{ moveText }}　　因果負荷 {{ loadText }}</div>
    <div class="actions">
      <button class="btn" type="button" @click="store.restart()">もう一度</button>
      <button class="btn primary" type="button" @click="emit('next')">次へ</button>
    </div>
  </ModalShell>

  <!-- 通知 -->
  <div
    v-if="store.notice"
    class="toast"
    :class="{ 'is-error': store.notice.tone === 'error' }"
    role="status"
  >
    {{ store.notice.text }}
    <button
      class="toast-close"
      type="button"
      aria-label="閉じる"
      @click="store.dismissNotice()"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
/*
 * 画面の高さに固定し、スクロールは各ペインの中だけで起こす。
 * dvh を使うのは、モバイルでアドレスバーの出入りにより高さが変わるため。
 */
.app {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--rule);
  gap: var(--gap);
  overflow: hidden;
}

.app.is-dragging {
  cursor: col-resize;
}

.bar {
  background: var(--panel);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.identity {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
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
  font-size: clamp(16px, 2.2vw, 30px);
}

.meters {
  display: flex;
  gap: 14px;
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
  white-space: nowrap;
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

.grid {
  flex: 1;
  display: grid;
  grid-template-columns:
    var(--left-width)
    var(--gap)
    minmax(0, 1fr)
    var(--gap)
    var(--right-width);
  gap: var(--gap);
  min-height: 0;
}

/* 幅を変えるつまみ。1px の罫線の上に、掴める余白を重ねてある。 */
.handle {
  position: relative;
  background: var(--rule);
  cursor: col-resize;
  touch-action: none;
}
.handle::after {
  content: '';
  position: absolute;
  inset: 0 -4px;
  z-index: 5;
}
.handle:hover,
.handle:focus-visible {
  background: var(--accent);
  outline: none;
}

.col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.col-right {
  background: var(--panel);
  padding: 14px;
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
  min-width: 0;
  min-height: 0;
}

/* 手引きは盤面の上に貼り付けるが、図そのものは隠さない */
.guide-slot {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 4;
  padding: 10px 12px 0;
  width: min(100%, 620px);
}

.legend {
  position: sticky;
  bottom: 0;
  left: 0;
  display: flex;
  gap: 14px;
  pointer-events: none;
  padding: 8px 14px;
  background: linear-gradient(to top, var(--panel-sub), transparent);
}
.legend .accent {
  color: var(--accent);
}

/* --- 画面が狭いとき ------------------------------------------------------ */

@media (max-width: 1000px) {
  .app {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  /* 縦積みでは、まず盤面を見せる */
  .viewport {
    order: 1;
    min-height: 300px;
    max-height: 46dvh;
  }
  .col-left {
    order: 2;
    height: 52dvh;
  }
  .col-right {
    order: 3;
  }

  .handle {
    display: none;
  }

  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
  }
}

@media (max-width: 620px) {
  .identity {
    width: 100%;
  }
  .meters {
    width: 100%;
    justify-content: space-between;
    gap: 10px;
  }
  .title {
    font-size: 18px;
  }
  .col-left {
    height: 58dvh;
  }
}

/* --- ダイアログ内の要素 --------------------------------------------------- */

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
