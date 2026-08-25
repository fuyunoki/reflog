<script setup lang="ts">
import type { GoalReport } from '@reflog/core';

defineProps<{ report: GoalReport }>();
</script>

<template>
  <div class="goals">
    <div
      v-for="status in report.statuses"
      :key="status.id"
      class="goal"
      :data-done="status.satisfied"
      :data-optional="status.optional"
    >
      <span class="tick" aria-hidden="true" />
      <span class="text jp">
        {{ status.label }}
        <span v-if="status.optional" class="optional">[任意]</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.goals {
  display: flex;
  flex-direction: column;
}

.goal {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  padding: 8px 0;
  border-top: 1px solid var(--rule);
  font-size: 12px;
  line-height: 1.5;
}
.goal:first-child {
  border-top: none;
}

.tick {
  width: 14px;
  height: 14px;
  border: 1px solid var(--rule-firm);
  border-radius: 50%;
  margin-top: 3px;
  transition: background 140ms linear, border-color 140ms linear;
}
.goal[data-done='true'] .tick {
  background: var(--ok);
  border-color: var(--ok);
}

.text {
  color: var(--ink-muted);
}
.goal[data-done='true'] .text {
  color: var(--ink);
}

.optional {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--ink-faint);
}
</style>
