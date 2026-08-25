<script setup lang="ts">
import { computed } from 'vue';
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
</script>

<template>
  <svg
    class="graph"
    :viewBox="`0 0 ${layout.width} ${layout.height}`"
    :width="layout.width"
    :height="layout.height"
    role="img"
    aria-label="世界線図"
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
      @click="emit('select', node.id)"
      @keydown.enter.prevent="emit('select', node.id)"
      @keydown.space.prevent="emit('select', node.id)"
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
</template>

<style scoped>
.graph {
  display: block;
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
</style>
