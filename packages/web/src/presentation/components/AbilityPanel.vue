<script setup lang="ts">
import { computed } from 'vue';
import type { AbilityKind, BranchName, CommitId, TimelineState } from '@reflog/core';
import { CAUSAL_LOAD } from '@reflog/core';
import { ABILITY, commitLabel } from '@/presentation/labels';

const props = defineProps<{
  abilities: readonly AbilityKind[];
  state: TimelineState;
  selected: CommitId | null;
  branches: readonly BranchName[];
  mergeable: readonly BranchName[];
  canUndo: boolean;
  hasHints: boolean;
}>();

const emit = defineEmits<{
  (e: 'revert'): void;
  (e: 'merge'): void;
  (e: 'branch'): void;
  (e: 'checkout', branch: BranchName): void;
  (e: 'undo'): void;
  (e: 'hint'): void;
}>();

const has = (kind: AbilityKind): boolean => props.abilities.includes(kind);

/** ルートは打ち消せない。打ち消す前の状態が存在しないため。 */
const canRevert = computed(
  () => has('revert') && !!props.selected && (props.state.commits[props.selected]?.parents.length ?? 0) > 0,
);

const canMerge = computed(() => has('merge') && props.mergeable.length > 0);

const currentBranch = computed(() =>
  props.state.head.type === 'branch' ? props.state.head.branch : null,
);

const guidance = computed(() => {
  if (props.selected) {
    return `${commitLabel(props.selected)} を選択中。REVERT でこの出来事を打ち消せる。`;
  }
  return '時点を選ぶと、その出来事を打ち消せる。';
});
</script>

<template>
  <aside class="pane">
    <div class="stack">
      <span class="label">行使できる能力</span>

      <button
        v-if="has('revert')"
        class="ability"
        type="button"
        :disabled="!canRevert"
        @click="emit('revert')"
      >
        {{ ABILITY.revert.name }}<span class="cost">負荷 {{ CAUSAL_LOAD.revert }}</span>
      </button>

      <button
        v-if="has('merge')"
        class="ability"
        type="button"
        :disabled="!canMerge"
        @click="emit('merge')"
      >
        {{ ABILITY.merge.name }}<span class="cost">負荷 {{ CAUSAL_LOAD.merge }}</span>
      </button>

      <button
        v-if="has('branch')"
        class="ability"
        type="button"
        :disabled="!selected"
        @click="emit('branch')"
      >
        {{ ABILITY.branch.name }}<span class="cost">負荷 {{ CAUSAL_LOAD.branch }}</span>
      </button>

      <button
        v-if="has('reset')"
        class="ability destructive"
        type="button"
        disabled
        :title="ABILITY.reset.effect"
      >
        {{ ABILITY.reset.name }}<span class="cost">未解放</span>
      </button>
    </div>

    <p class="guidance jp">{{ guidance }}</p>

    <div class="stack">
      <span class="label">世界線</span>
      <div class="branches">
        <button
          v-for="name in branches"
          :key="name"
          class="branch"
          type="button"
          :aria-current="name === currentBranch"
          @click="emit('checkout', name)"
        >
          <span>{{ name }}</span>
          <span class="tip">{{ commitLabel(state.branches[name] ?? '') }}</span>
        </button>
      </div>
    </div>

    <div class="stack">
      <span class="label">記録</span>
      <button class="btn" type="button" :disabled="!canUndo" @click="emit('undo')">
        一手戻す
      </button>
      <button v-if="hasHints" class="btn" type="button" @click="emit('hint')">
        助言を求める
      </button>
    </div>
  </aside>
</template>

<style scoped>
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

.ability {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.01em;
  text-align: left;
  background: var(--panel-hi);
  color: var(--ink);
  border: 1px solid var(--rule-firm);
  border-radius: 0;
  padding: 9px 10px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  transition: background 120ms linear, color 120ms linear;
}
.ability:hover:not(:disabled) {
  background: var(--ink);
  color: var(--panel);
}
.ability:disabled {
  opacity: 0.34;
  cursor: not-allowed;
}
.ability:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.ability .cost {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  opacity: 0.7;
  white-space: nowrap;
}

.ability.destructive {
  border-color: var(--accent);
  color: var(--accent);
}
.ability.destructive:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}

.guidance {
  font-size: 11px;
  color: var(--ink-muted);
  line-height: 1.5;
  margin: 0;
}

.branches {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.branch {
  font-family: var(--mono);
  font-size: 11px;
  padding: 5px 8px;
  border: 1px solid transparent;
  background: var(--panel-hi);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.branch:hover {
  border-color: var(--rule-firm);
}
.branch[aria-current='true'] {
  border-color: var(--ink);
  font-weight: 700;
}
.branch .tip {
  color: var(--ink-faint);
}
</style>
