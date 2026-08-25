<script setup lang="ts">
import { computed } from 'vue';
import type { CommitId, StageSpec, TimelineState } from '@reflog/core';
import { currentWorldState } from '@reflog/core';
import { commitLabel, factLabel, valueLabel } from '@/presentation/labels';

const props = defineProps<{
  spec: StageSpec;
  state: TimelineState;
  focused: CommitId | null;
}>();

const commit = computed(() => (props.focused ? props.state.commits[props.focused] : undefined));

const changes = computed(() => {
  const target = commit.value;
  if (!target) return [];
  return Object.entries(target.changes).map(([key, value]) => ({
    key,
    value,
    removed: value === null,
  }));
});

const world = computed(() => {
  const result = currentWorldState(props.state);
  return result.ok ? Object.entries(result.value) : [];
});
</script>

<template>
  <footer class="record">
    <div class="col">
      <span class="label">
        観測記録<template v-if="focused"> — {{ commitLabel(focused) }}</template>
      </span>
      <p class="narrative jp">
        {{ commit?.narrative ?? commit?.message ?? '時点を選択すると、そこで何が起きたかを読める。' }}
      </p>
    </div>

    <div class="col">
      <span class="label">この時点の変化</span>
      <div class="rows">
        <div
          v-for="change in changes"
          :key="change.key"
          class="row"
          :class="change.removed ? 'is-removed' : 'is-added'"
        >
          <span class="sign">{{ change.removed ? '−' : '+' }}</span>
          <span class="val">
            {{ factLabel(spec, change.key) }} = {{ valueLabel(spec, change.value) }}
          </span>
        </div>
        <div v-if="changes.length === 0" class="row">
          <span class="sign">·</span>
          <span class="val">変化なし</span>
        </div>
      </div>
    </div>

    <div class="col">
      <span class="label">現在の世界</span>
      <div class="rows">
        <div v-for="[key, value] in world" :key="key" class="row">
          <span class="sign">·</span>
          <span class="val">{{ factLabel(spec, key) }} = {{ valueLabel(spec, value) }}</span>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.record {
  background: var(--panel);
  padding: 14px 16px;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(180px, 1fr) minmax(180px, 1fr);
  gap: 24px;
  min-height: 132px;
}

@media (max-width: 900px) {
  .record {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}

.col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.narrative {
  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  max-width: 62ch;
  color: var(--ink);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  font-family: var(--mono);
  font-size: 11px;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 6px;
  padding: 2px 5px;
  background: var(--panel-hi);
  overflow-x: auto;
}

.sign {
  color: var(--ink-faint);
}
.row.is-added .sign {
  color: var(--ok);
}
.row.is-removed .sign {
  color: var(--accent);
}
.row.is-removed .val {
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
