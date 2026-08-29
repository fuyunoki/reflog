<script setup lang="ts">
/**
 * いまの世界がどうなっているか。
 *
 * 達成条件のすぐ下に置く。「こうしたい（条件）」と「いまこう（現状）」が
 * 並んで見えることで、あと何を変えればよいかが読み取れる。
 * 条件が参照している事実には印を付け、どれを動かせばよいか分かるようにする。
 */
import { computed } from 'vue';
import type { FactKey, StageSpec, TimelineState } from '@reflog/core';
import { currentWorldState } from '@reflog/core';
import { factLabel, valueLabel } from '@/presentation/labels';

const props = defineProps<{
  spec: StageSpec;
  state: TimelineState;
}>();

/** 達成条件が見ている事実。目標に関わるものだけ強調する。 */
const watched = computed<ReadonlySet<FactKey>>(() => {
  const keys = new Set<FactKey>();
  const walk = (predicate: unknown): void => {
    if (typeof predicate !== 'object' || predicate === null) return;
    const p = predicate as Record<string, unknown>;
    if (typeof p.key === 'string') keys.add(p.key);
    for (const nested of [p.of, ...((p.all as unknown[]) ?? []), ...((p.any as unknown[]) ?? [])]) {
      if (nested) walk(nested);
    }
  };
  for (const goal of props.spec.goals) walk(goal.predicate);
  return keys;
});

const facts = computed(() => {
  const result = currentWorldState(props.state);
  if (!result.ok) return [];
  return Object.entries(result.value).map(([key, value]) => ({
    key,
    value,
    watched: watched.value.has(key),
  }));
});
</script>

<template>
  <section class="world">
    <span class="label">いまの世界</span>
    <div class="rows">
      <div
        v-for="fact in facts"
        :key="fact.key"
        class="row"
        :class="{ watched: fact.watched }"
      >
        <span class="name jp">{{ factLabel(spec, fact.key) }}</span>
        <span class="value jp">{{ valueLabel(spec, fact.value) }}</span>
      </div>
      <div v-if="facts.length === 0" class="row">
        <span class="name">——</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.world {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--rule);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  padding: 6px 8px;
  background: var(--panel-hi);
  font-size: 12px;
  border-left: 2px solid transparent;
}

/* 達成条件が見ている事実 */
.row.watched {
  border-left-color: var(--ink);
}

.name {
  color: var(--ink-muted);
  min-width: 0;
}
.row.watched .name {
  color: var(--ink);
}

.value {
  font-weight: 500;
  white-space: nowrap;
}
</style>
