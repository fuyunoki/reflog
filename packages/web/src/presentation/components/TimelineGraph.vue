<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CommitId, TimelineState } from '@reflog/core';
import { layoutTimeline } from '@/presentation/graphLayout';
import { commitLabel, truncate } from '@/presentation/labels';

const props = defineProps<{
  state: TimelineState;
  selected: CommitId | null;
  /** 異常として赤で示す時点。ステージ側から指定する。 */
  anomalyIds?: readonly CommitId[];
}>();

const emit = defineEmits<{ (e: 'select', id: CommitId): void }>();

const layout = computed(() => layoutTimeline(props.state));

const isAnomaly = (id: CommitId): boolean => props.anomalyIds?.includes(id) ?? false;

const refBoxWidth = (name: string): number => name.length * 6.6 + 16;

/* --- 見え方の調整 -----------------------------------------------------------
 *
 * 表示する数字は「図のどれだけの範囲を見ているか」。
 * 100% は全体が見えている状態で、数字が小さいほど狭い範囲を大きく見ていることになる。
 * 50% なら半分の範囲、25% なら四分の一の範囲が画面いっぱいに映る。
 */

/** 全体に対する拡大率。1 が全体、6 で六分の一の範囲まで寄れる。 */
const MIN_SPAN = 1;
const MAX_SPAN = 6;

const svg = ref<SVGSVGElement | null>(null);
const span = ref(1);
const pan = ref({ x: 0, y: 0 });

/** 画面に出す割合。範囲が狭いほど数字は小さくなる。 */
const percent = computed(() => Math.round(100 / span.value));

const visible = computed(() => ({
  width: layout.value.width / span.value,
  height: layout.value.height / span.value,
}));

const viewBox = computed(
  () => `${pan.value.x} ${pan.value.y} ${visible.value.width} ${visible.value.height}`,
);

const atDefault = computed(
  () => span.value === MIN_SPAN && pan.value.x === 0 && pan.value.y === 0,
);

const canZoomIn = computed(() => span.value < MAX_SPAN - 0.001);
const canZoomOut = computed(() => span.value > MIN_SPAN + 0.001);

function clampPan(): void {
  const maxX = Math.max(0, layout.value.width - visible.value.width);
  const maxY = Math.max(0, layout.value.height - visible.value.height);
  pan.value = {
    x: Math.min(Math.max(0, pan.value.x), maxX),
    y: Math.min(Math.max(0, pan.value.y), maxY),
  };
}

/** 図が伸び縮みしたら、見ている場所が外へ出ないよう寄せ直す。 */
watch(() => [layout.value.width, layout.value.height], clampPan);

/** 図の中の一点を軸にして範囲を変える。指やカーソルの下の位置がずれない。 */
function spanTo(next: number, anchor?: { x: number; y: number }): void {
  const clamped = Math.min(MAX_SPAN, Math.max(MIN_SPAN, next));
  if (Math.abs(clamped - span.value) < 0.0001) return;

  const focus = anchor ?? {
    x: pan.value.x + visible.value.width / 2,
    y: pan.value.y + visible.value.height / 2,
  };
  const ratio = span.value / clamped;

  pan.value = {
    x: focus.x - (focus.x - pan.value.x) * ratio,
    y: focus.y - (focus.y - pan.value.y) * ratio,
  };
  span.value = clamped;
  clampPan();
}

/** 拡大は範囲を狭めること。数字は小さくなる。 */
const zoomBy = (factor: number): void => spanTo(span.value * factor);

const reset = (): void => {
  span.value = MIN_SPAN;
  pan.value = { x: 0, y: 0 };
};

/** 画面上の位置を、図の座標に置き換える。 */
function toGraphPoint(event: { clientX: number; clientY: number }) {
  const el = svg.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    x: pan.value.x + ((event.clientX - rect.left) / rect.width) * visible.value.width,
    y: pan.value.y + ((event.clientY - rect.top) / rect.height) * visible.value.height,
  };
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  spanTo(span.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15), toGraphPoint(event) ?? undefined);
}

/** 掴んで動かす。時点をクリックしたときに動いてしまわないよう、少し動いてから始める。 */
const dragging = ref(false);
let origin: { x: number; y: number; panX: number; panY: number } | null = null;

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  origin = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y };
}

function onPointerMove(event: PointerEvent): void {
  if (!origin || !svg.value) return;
  const dx = event.clientX - origin.x;
  const dy = event.clientY - origin.y;
  if (!dragging.value && Math.hypot(dx, dy) < 4) return;

  dragging.value = true;
  svg.value.setPointerCapture(event.pointerId);
  const rect = svg.value.getBoundingClientRect();
  pan.value = {
    x: origin.panX - (dx / rect.width) * visible.value.width,
    y: origin.panY - (dy / rect.height) * visible.value.height,
  };
  clampPan();
}

function onPointerUp(): void {
  origin = null;
  requestAnimationFrame(() => {
    dragging.value = false;
  });
}

/** 掴んで動かしている最中は、時点の選択を無視する。 */
const select = (id: CommitId): void => {
  if (!dragging.value) emit('select', id);
};
</script>

<template>
  <div class="graph-wrap">
      <svg
      ref="svg"
    class="graph"
    :class="{ dragging }"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label="世界線図"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <path
      v-for="edge in layout.edges"
      :key="edge.id"
      class="edge"
      :class="{ 'is-second': edge.isSecondParent }"
      :d="edge.path"
    />

    <g
      v-for="node in layout.nodes"
      :key="node.id"
      class="node"
      :class="{ 'is-orphan': node.isOrphan }"
      tabindex="0"
      role="button"
      :aria-label="`${commitLabel(node.id)} ${node.commit.message}`"
      @click="select(node.id)"
      @keydown.enter.prevent="select(node.id)"
      @keydown.space.prevent="select(node.id)"
    >
      <circle
        class="ring"
        :class="{
          'is-anomaly': isAnomaly(node.id),
          'is-head': node.isHead,
          'is-selected': node.id === props.selected,
        }"
        :cx="node.x"
        :cy="node.y"
        :r="layout.radius"
      />
      <text class="node-id" :x="node.x" :y="node.y - 20" text-anchor="middle">
        {{ commitLabel(node.id) }}
      </text>
      <text
        class="node-msg"
        :class="{ 'is-anomaly': isAnomaly(node.id) }"
        :x="node.x"
        :y="node.y + (node.labelRow === 0 ? 31 : 49)"
        text-anchor="middle"
      >
        {{ truncate(node.commit.message, 9) }}
      </text>
      <title>{{ node.commit.message }}</title>
    </g>

    <!-- 動かない印。ブランチ札とは形を変えて、性質の違いが見て分かるようにする -->
    <g v-for="node in layout.nodes" :key="`tags-${node.id}`">
      <g v-for="(name, i) in node.tags" :key="name">
        <text
          class="tag-mark"
          :x="node.x"
          :y="node.y - 34 - i * 13"
          text-anchor="middle"
        >
          ◆ {{ name }}
        </text>
      </g>
    </g>

    <g v-for="node in layout.nodes" :key="`refs-${node.id}`">
      <g v-for="(name, i) in node.refs" :key="name">
        <rect
          class="ref-box"
          :class="{
            'is-head': state.head.type === 'branch' && state.head.branch === name,
          }"
          :x="node.x + layout.radius + 9"
          :y="node.y - 9 + i * 22"
          :width="refBoxWidth(name)"
          height="18"
        />
        <text
          class="ref-tag"
          :class="{
            'is-head': state.head.type === 'branch' && state.head.branch === name,
          }"
          :x="node.x + layout.radius + 9 + refBoxWidth(name) / 2"
          :y="node.y + 4 + i * 22"
          text-anchor="middle"
        >
          {{ name }}
        </text>
      </g>
    </g>
    </svg>

    <div class="zoom" role="group" aria-label="図の表示">
      <button type="button" aria-label="縮小" :disabled="!canZoomOut" @click="zoomBy(1 / 1.25)">−</button>
      <button
        type="button"
        class="level"
        :disabled="atDefault"
        :title="atDefault ? '全体が表示されている' : '全体表示に戻す'"
        @click="reset"
      >
        {{ percent }}%
      </button>
      <button type="button" aria-label="拡大" :disabled="!canZoomIn" @click="zoomBy(1.25)">＋</button>
    </div>
  </div>
</template>

<style scoped>
.graph-wrap {
  position: relative;
  width: 100%;
  /* 高さを 100% で取ると、同じ器に他の要素があるとき溢れる。残りを埋める形にする */
  flex: 1;
  min-height: 0;
}

.graph {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.graph.dragging {
  cursor: grabbing;
}

.edge {
  stroke: var(--rule-firm);
  stroke-width: 1;
  fill: none;
}
.edge.is-second {
  stroke-dasharray: 3 3;
}

.node {
  cursor: pointer;
}
.node:focus-visible {
  outline: 2px solid var(--accent);
}
.node.is-orphan {
  opacity: 0.45;
}

.ring {
  fill: var(--panel-hi);
  stroke: var(--rule-firm);
  stroke-width: 1;
  transition: stroke 120ms linear;
}
.ring.is-anomaly {
  stroke: var(--accent);
}
.ring.is-head {
  fill: var(--ink);
}
.ring.is-selected {
  stroke: var(--ink);
  stroke-width: 2.5;
}
.node:hover .ring {
  stroke: var(--ink);
}

.node-id {
  font-family: var(--mono);
  font-size: 9px;
  fill: var(--ink-faint);
  letter-spacing: 0.02em;
}

/*
 * 隣のラベルと重なっても読めるように、地の色で縁を取る。
 * paint-order を stroke 先にしないと文字が潰れる。
 */
.node-msg {
  font-family: var(--jp);
  font-size: 11px;
  fill: var(--ink-muted);
  paint-order: stroke fill;
  stroke: var(--panel-sub);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.node-id {
  paint-order: stroke fill;
  stroke: var(--panel-sub);
  stroke-width: 3px;
  stroke-linejoin: round;
}
.node-msg.is-anomaly {
  fill: var(--accent);
}

.ref-box {
  fill: none;
  stroke: var(--ink);
  stroke-width: 1;
}
.ref-box.is-head {
  fill: var(--ink);
}

.ref-tag {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  fill: var(--ink);
}
.ref-tag.is-head {
  fill: var(--panel);
}

.zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  border: 1px solid var(--rule-firm);
  background: var(--panel);
}

.zoom button {
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1;
  padding: 6px 9px;
  background: transparent;
  color: var(--ink-muted);
  border: none;
  border-radius: 0;
  cursor: pointer;
}
.zoom button + button {
  border-left: 1px solid var(--rule);
}
.zoom button:hover:not(:disabled) {
  background: var(--ink);
  color: var(--panel);
}
.zoom button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* 全体が見えているときは押しても何も起きないので、そう見せる */
.zoom .level {
  min-width: 52px;
  color: var(--ink);
}
.zoom .level:disabled {
  color: var(--ink-faint);
  cursor: default;
}

.tag-mark {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.03em;
  fill: var(--ink-muted);
}
</style>
