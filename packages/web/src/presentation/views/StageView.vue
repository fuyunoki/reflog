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
import { useProgressStore } from '@/stores/progress';
import { commitLabel } from '@/presentation/labels';
import TimelineGraph from '@/presentation/components/TimelineGraph.vue';
import AbilityPanel from '@/presentation/components/AbilityPanel.vue';
import AnnotatedText from '@/presentation/components/AnnotatedText.vue';
import LexiconCard from '@/presentation/components/LexiconCard.vue';
import { lexiconSource } from '@/infrastructure/StaticLexiconSource';
import { backdropOf } from '@/presentation/backdrop';
import GoalList from '@/presentation/components/GoalList.vue';
import RecordPanel from '@/presentation/components/RecordPanel.vue';
import WorldStatePanel from '@/presentation/components/WorldStatePanel.vue';
import SessionControls from '@/presentation/components/SessionControls.vue';
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
const progress = useProgressStore();
const mergePickerOpen = ref(false);

onMounted(() => store.start(props.spec, progress.learnedAbilities));
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
const DEFAULTS = { left: 240, right: 330 } as const;

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

/** 並べ直す先を選ぶ。相手が 1 つなら迷う余地がないのでそのまま実行する。 */
const rebasePickerOpen = ref(false);

const onRebase = (): void => {
  if (store.mergeableBranches.length === 1) {
    store.attemptRebase(store.mergeableBranches[0] as BranchName);
    return;
  }
  rebasePickerOpen.value = true;
};

const pickRebase = (branch: BranchName): void => {
  rebasePickerOpen.value = false;
  store.attemptRebase(branch);
};

const pickMerge = (branch: BranchName): void => {
  mergePickerOpen.value = false;
  store.attemptMerge(branch);
};

const onCherryPick = (): void => {
  if (store.selected) store.attemptCherryPick(store.selected);
};

/**
 * 歴史が消える操作なので、実行前に必ず確認を挟む。
 * 「取り返しがつかない」ことを体で覚えてもらう仕掛けでもある。
 */
const resetTarget = ref<CommitId | null>(null);

const onReset = (): void => {
  resetTarget.value = store.selected;
};

const confirmReset = (): void => {
  const target = resetTarget.value;
  resetTarget.value = null;
  if (target && store.play({ kind: 'reset', targetId: target })) {
    store.notify('時点ごと巻き戻した。切り離された記録は reflog から辿れる。');
  }
};

/*
 * 語彙カード。
 *
 * 本文の語を押すと開き、そのステージで初めて出る語は導入を閉じた直後に一度だけ出る。
 * 「人物や場所がいきなり本文に出てきて想像できない」という指摘への対応で、
 * 読みたい人だけが読めばよいので、進行は一切止めない。
 */
const openedEntry = ref<string | null>(null);

/** 場所ごとの地紋。盤面の後ろにごく薄く敷く。 */
const backdrop = computed(() => backdropOf(props.spec));

/*
 * ヘッダに残す一行。
 * 本編は「いつ・どこ」、訓練は「何番目の演習で、何を扱う回か」が要る欄なので、
 * 先頭 2 欄ではなく欄名で選ぶ。
 */
const HEADER_FIELDS = ['年月', '場所', '演習', '主題'];

const headerLine = computed(() => {
  const briefing = props.spec.briefing ?? [];
  return HEADER_FIELDS.map((label) => briefing.find((line) => line.label === label))
    .filter((line): line is NonNullable<typeof line> => line !== undefined)
    .map((line) => (line.label === '演習' ? `演習 ${line.value}` : line.value))
    .join(' ／ ');
});
const debutQueue = ref<string[]>([]);

const shownEntry = computed(() =>
  lexiconSource.get(openedEntry.value ?? debutQueue.value[0] ?? ''),
);

/*
 * 同じ語に何度も下線を引くと本文が読めなくなるので、段落をまたいで 1 回に抑える。
 * モーダルを開くたびに作り直すため、開閉を依存に取っている。
 */
const introOnce = computed(() => {
  void store.introOpen;
  return new Set<string>();
});
const outroOnce = computed(() => {
  void store.outroOpen;
  return new Set<string>();
});

/** 自分で開いた語は、後の回で改めて自動提示しない。 */
const openEntry = (entryId: string): void => {
  openedEntry.value = entryId;
  lexiconSource.markSeen([entryId]);
};

const closeCard = (): void => {
  if (openedEntry.value) {
    openedEntry.value = null;
    return;
  }
  // 初出の提示は 1 枚ずつ送る
  debutQueue.value = debutQueue.value.slice(1);
};

/** 導入を閉じた直後に、そのステージで初めて出る語を順に見せる。 */
const beginDebuts = (): void => {
  store.introOpen = false;
  const debuts = lexiconSource.all
    .filter((entry) => entry.firstSeen === props.spec.id && !lexiconSource.hasSeen(entry.id))
    .map((entry) => entry.id);
  if (debuts.length === 0) return;
  lexiconSource.markSeen(debuts);
  debutQueue.value = debuts;
};

/** 分岐の名前は自動で振る。命名そのものはこのゲームの主題ではない。 */
const onBranch = (): void => {
  if (!store.selected || !store.timeline) return;
  const existing = Object.keys(store.timeline.branches).length;
  store.play({ kind: 'branch', name: `line-${existing + 1}`, at: store.selected });
};

/*
 * 印だけは名前を自動で振れない。
 * 「どこに、どの名前で付いているか」が達成条件そのものになる回があるため。
 */
const tagNameOpen = ref(false);
const tagName = ref('');

const onTag = (): void => {
  if (!store.selected) return;
  tagName.value = '';
  tagNameOpen.value = true;
};

const confirmTag = (): void => {
  const name = tagName.value.trim();
  if (!name || !store.selected) return;
  tagNameOpen.value = false;
  store.play({ kind: 'tag', name, at: store.selected });
};

const onDeleteTag = (name: string): void => {
  if (store.play({ kind: 'delete-tag', name })) {
    store.notify(`${name} の印を外した。付け直すまで、この名前はどこも指していない。`);
  }
};
</script>

<template>
  <div
    v-if="store.session && store.timeline && store.report"
    class="app"
    :class="{ 'is-dragging': dragging !== null }"
    :style="{
      '--left-width': `${leftWidth}px`,
      '--right-width': `${rightWidth}px`,
      '--backdrop': backdrop,
    }"
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
        <!-- 導入を読み飛ばした人にも、いつ・どこの話かだけは残しておく -->
        <span v-if="headerLine" class="place jp">{{ headerLine }}</span>
      </div>

      <div class="meters">
        <div class="gauges">
          <div class="meter">
            <span class="label">手数</span>
            <span class="value" :class="{ tight: movesTight }">{{ moveText }}</span>
          </div>
          <div class="meter">
            <span class="label">因果負荷</span>
            <span class="value" :class="{ tight: loadTight }">{{ loadText }}</span>
          </div>
        </div>

        <!--
          操作方法の切り替えと退出はひとかたまりにする。
          ばらばらに折り返すと、狭い画面で「戻る」だけが行落ちして読みづらくなる。
        -->
        <div class="controls">
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
      </div>
    </header>

    <!--
      手引きは図の器の中に置くと、その分だけ盤面が潰れる。
      帯として独立させ、盤面の高さを削らないようにする。
    -->
    <div v-if="store.guide.current" class="guide-slot">
      <GuidePanel :guide="store.guide" @acknowledge="store.acknowledgeGuide()" />
    </div>

    <div class="grid">
      <div class="col col-left" :class="{ 'is-console': store.inputMode === 'console' }">
        <!--
          術式の一覧はここには置かない。場所を取るうえ、
          入力候補が出たときにコンソールの入力欄が隠れてしまう。一覧はホーム画面にある。
        -->
        <CommandConsole
          v-if="store.inputMode === 'console'"
          :lines="store.consoleLines"
          :history="store.commandHistory"
          @run="store.runCommand($event)"
        />
        <AbilityPanel
          v-else
          :abilities="store.session.abilities"
          :state="store.timeline"
          :selected="store.selected"
          :branches="store.branches"
          :mergeable="store.mergeableBranches"
          :has-offers="(spec.offers?.length ?? 0) > 0"
          @commit="store.attemptCommit()"
          @revert="store.revertSelected()"
          @merge="onMerge"
          @rebase="onRebase"
          @branch="onBranch"
        @cherry-pick="onCherryPick"
        @reset="onReset"
          @tag="onTag"
          @delete-tag="onDeleteTag"
          @checkout="store.checkout($event)"
        />

        <!-- 入口がどちらでも要るので、モードの外に置いて位置を揃える -->
        <SessionControls
          :can-undo="store.canUndo"
          :has-hints="(spec.hints?.length ?? 0) > 0"
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

      <!--
        右の列は上から順に「いま何を見ているか」「何を目指すか」「いまどうなっているか」。
        盤面の丸を選んだとき、視線がそのまま隣へ移れる位置に記録を置く。
      -->
      <aside class="col col-right">
        <RecordPanel
          :spec="spec"
          :state="store.timeline"
          :focused="store.focusedCommit"
          @open-entry="openEntry"
        />

        <div class="rule" />

        <div class="stack">
          <span class="label">達成すべき世界の状態</span>
          <GoalList :report="store.report" />
        </div>

        <div class="rule" />

        <WorldStatePanel :spec="spec" :state="store.timeline" />
      </aside>
    </div>

  </div>

  <!-- 導入 -->
  <ModalShell :open="store.introOpen" @close="store.introOpen = false">
    <span class="label">STAGE {{ spec.id.toUpperCase() }}</span>
    <h2 class="head jp">{{ spec.title }}</h2>

    <!-- 本文を読まなくても「いつ・どこの話か」だけは必ず分かるようにする -->
    <dl v-if="spec.briefing?.length" class="briefing">
      <template v-for="line in spec.briefing" :key="line.label">
        <dt>{{ line.label }}</dt>
        <dd class="jp">
          <AnnotatedText :text="line.value" @open="openEntry" />
        </dd>
      </template>
    </dl>

    <div class="jp prose">
      <p v-for="(line, i) in spec.intro" :key="i">
        <AnnotatedText :text="line" :once="introOnce" @open="openEntry" />
      </p>
    </div>
    <div class="actions">
      <button class="btn primary" type="button" @click="beginDebuts()">
        観測を開始する
      </button>
    </div>
  </ModalShell>

  <!-- 語彙カード -->
  <ModalShell :open="!!shownEntry" @close="closeCard()">
    <LexiconCard v-if="shownEntry" :entry="shownEntry" />
    <div class="actions">
      <button class="btn primary" type="button" @click="closeCard()">
        {{ debutQueue.length > 1 && !openedEntry ? '次の記録' : '閉じる' }}
      </button>
    </div>
  </ModalShell>

  <!-- 印の名前 -->
  <ModalShell :open="tagNameOpen" @close="tagNameOpen = false">
    <span class="label">TAG — 動かない印</span>
    <h2 class="head jp">{{ store.selected ? commitLabel(store.selected) : '' }} に付ける印の名前</h2>
    <div class="jp prose">
      <p>印は世界線と違って動かない。「あのときここだった」と後から言うためのものだ。</p>
    </div>
    <form class="tag-form" @submit.prevent="confirmTag">
      <input
        v-model="tagName"
        class="tag-input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="baseline"
      />
      <div class="actions">
        <button class="btn" type="button" @click="tagNameOpen = false">やめる</button>
        <button class="btn primary" type="submit" :disabled="!tagName.trim()">印を付ける</button>
      </div>
    </form>
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

  <!-- 刻む出来事の選択 -->
  <ModalShell :open="!!store.pendingOffers" @close="store.cancelOffers()">
    <span class="label">COMMIT — 出来事を刻む</span>
    <h2 class="head jp">何を起こしますか</h2>
    <div class="picker">
      <button
        v-for="offer in store.pendingOffers ?? []"
        :key="offer.id"
        class="pick"
        type="button"
        @click="store.commitOffer(offer)"
      >
        <span class="pick-name jp">{{ offer.message }}</span>
        <span v-if="offer.narrative" class="pick-tip jp">{{ offer.narrative }}</span>
      </button>
    </div>
    <div class="actions">
      <button class="btn" type="button" @click="store.cancelOffers()">やめる</button>
    </div>
  </ModalShell>

  <!-- 歴史を消す操作の確認 -->
  <ModalShell :open="resetTarget !== null" alert @close="resetTarget = null">
    <span class="label">RESET — 歴史の消去</span>
    <h2 class="head jp">本当に巻き戻しますか</h2>
    <div class="jp prose">
      <p>
        {{ resetTarget ? commitLabel(resetTarget) : '' }} まで戻すと、それ以降に起きた出来事は
        どの世界線からも辿れなくなります。
      </p>
      <p>打ち消す（REVERT）のとは違い、起きたという記録ごと失われます。</p>
    </div>
    <div class="actions">
      <button class="btn" type="button" @click="resetTarget = null">やめる</button>
      <button class="btn primary" type="button" @click="confirmReset">巻き戻す</button>
    </div>
  </ModalShell>

  <!-- 並べ直す先の選択 -->
  <ModalShell :open="rebasePickerOpen" @close="rebasePickerOpen = false">
    <span class="label">REBASE — 出来事の並べ直し</span>
    <h2 class="head jp">どの世界線の上に並べ直しますか</h2>
    <div class="picker">
      <button
        v-for="branch in store.mergeableBranches"
        :key="branch"
        class="pick"
        type="button"
        @click="pickRebase(branch)"
      >
        <span class="pick-name">{{ branch }}</span>
        <span class="pick-tip">
          tip = {{ commitLabel(store.timeline?.branches[branch] ?? '') }}
        </span>
      </button>
    </div>
    <div class="actions">
      <button class="btn" type="button" @click="rebasePickerOpen = false">やめる</button>
    </div>
  </ModalShell>

  <!-- 矛盾 -->
  <ConflictDialog
    v-if="store.pendingConflict"
    :open="true"
    :spec="spec"
    :kind="store.pendingConflict.kind"
    :source="store.pendingConflict.source"
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
      <p v-for="(line, i) in spec.outro ?? []" :key="i">
        <AnnotatedText :text="line" :once="outroOnce" @open="openEntry" />
      </p>
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

.gauges {
  display: flex;
  gap: 14px;
  align-items: center;
}

/* 折り返すときも、この 3 つは必ず一緒に動く */
.controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
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
  /*
    中の部品がそれぞれ背景を持つので広い画面では見えないが、
    余白や隙間から下が透ける。下辺に貼り付けたときに特に目立つので、
    器の側でも地色を敷いておく。
  */
  background: var(--panel);
}

.col-right {
  background: var(--panel);
  padding: 14px;
  gap: 12px;
  overflow-y: auto;
}

/* 右の列は情報の種類が変わるので、区切りを入れて読み分けられるようにする */
.rule {
  height: 1px;
  background: var(--rule);
  flex-shrink: 0;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.viewport {
  background: var(--panel-sub);
  position: relative;
  /* 図の移動は掴んで動かす方で行うので、器自体は動かさない */
  overflow: hidden;
  /*
    手引きと図を縦に積む。図の高さを 100% にすると
    手引きの分だけ器からはみ出し、はみ出した側にある操作が切れてしまう。
  */
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* 手引きは盤面の上に貼り付けるが、図そのものは隠さない */
.guide-slot {
  background: var(--panel);
  padding: 10px 14px;
  flex-shrink: 0;
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
    /* 行を引き伸ばさない。余りは下にまとめる */
    align-content: start;
    grid-auto-rows: min-content;
  }

  /*
    縦積みの順序は「盤面 → その説明 → 操作」。
    読む順としてはこれでよいが、操作が最下部にあると
    毎回そこまで送らないと手が出せない。
    そこで操作だけは画面の下辺に貼り付け、常に手元にある状態にする。
  */
  .viewport {
    order: 1;
    min-height: 200px;
    /* 盤面と下辺の操作で画面を使い切ると、記録を読む場所が残らない */
    max-height: 30dvh;
  }
  .col-right {
    order: 2;
    /* 下に貼り付いた操作の裏に文字が隠れないよう、余白を足す */
    padding-bottom: 20px;
  }
  .col-left {
    order: 3;
    position: sticky;
    bottom: 0;
    z-index: 5;
    height: auto;
    /* 術式を横に並べたぶん、これだけあれば足りる */
    max-height: 26dvh;
    overflow-y: auto;
    border-top: 1px solid var(--rule-firm);
    /* 下に貼り付いていることが分かるように、境目に影を落とす */
    box-shadow: 0 -10px 24px rgba(0, 0, 0, 0.28);
    padding: 10px 12px;
    gap: 10px;
  }

  /*
    狭い画面では術式を横に並べる。縦積みのままだと下辺が厚くなりすぎて、
    肝心の記録が読めなくなるため。効果の説明はホーム画面の一覧に譲る。
  */
  .col-left :deep(.stack) {
    flex-direction: row;
    /* stretch だと全ボタンが最大の高さに揃ってしまい、下辺が厚くなる */
    align-items: center;
    gap: 6px;
    overflow-x: auto;
  }
  /* 横並びにすると幅が足りず、見出しが一文字ずつ折り返してしまう */
  .col-left :deep(.stack > .label) {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .col-left :deep(.ability) {
    min-width: 108px;
    flex-shrink: 0;
    padding: 7px 9px;
  }
  .col-left :deep(.ability .effect) {
    display: none;
  }
  .col-left :deep(.branches) {
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
  }
  .col-left :deep(.branch) {
    flex-shrink: 0;
  }
  .col-left :deep(.guidance) {
    display: none;
  }
  .col-left :deep(.session-controls) {
    flex-direction: row;
    padding: 0;
    border-top: none;
    background: transparent;
  }
  .col-left :deep(.session-controls .label) {
    display: none;
  }
  .col-left :deep(.session-controls .btn) {
    flex: 1;
  }

  /* コンソールは入力欄と直前の出力が見えればよい */
  .col-left.is-console {
    height: 36dvh;
    max-height: 36dvh;
    padding: 0;
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
  .controls {
    margin-left: auto;
  }
  .title {
    font-size: 18px;
  }
  .col-left.is-console {
    height: 50dvh;
  }
}

/* 横に 5 つ並べきれない幅では、計器と操作を上下に分ける */
@media (max-width: 460px) {
  .meters {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .gauges {
    justify-content: space-between;
  }
  .controls {
    justify-content: space-between;
    margin-left: 0;
  }
  .controls .btn {
    flex: 1;
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
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-faint);
}

.pick-name {
  font-size: 13px;
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

.tag-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tag-input {
  font-family: var(--mono);
  font-size: 13px;
  padding: 8px 10px;
  background: var(--panel-hi);
  color: var(--ink);
  border: 1px solid var(--rule-firm);
  border-radius: 0;
}
.tag-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* 冒頭の見出し。読み飛ばされる前提で、罫線の中に収める */
.briefing {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  background: var(--panel-hi);
}
.briefing dt {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ink-faint);
  align-self: baseline;
  white-space: nowrap;
}
.briefing dd {
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}

.identity .place {
  font-size: 10px;
  color: var(--ink-faint);
  line-height: 1.4;
}

/*
 * 場所ごとの地紋。図の可読性を最優先にするので、地の色に沈む濃さに留める。
 * 図そのものは .viewport の子要素なので、背景を敷いても線は前に出る。
 */
.viewport {
  background-image: var(--backdrop);
  background-repeat: repeat;
  background-position: center;
}
</style>
