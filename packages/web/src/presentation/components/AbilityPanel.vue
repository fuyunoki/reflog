<script setup lang="ts">
import { computed } from 'vue';
import type { AbilityKind, BranchName, CommitId, TimelineState } from '@reflog/core';
import { CAUSAL_LOAD, isAncestorOf } from '@reflog/core';
import { ABILITY, commitLabel } from '@/presentation/labels';

const props = defineProps<{
  abilities: readonly AbilityKind[];
  state: TimelineState;
  selected: CommitId | null;
  branches: readonly BranchName[];
  mergeable: readonly BranchName[];
  /** このステージに刻める出来事が用意されているか。 */
  hasOffers: boolean;
}>();

const emit = defineEmits<{
  (e: 'commit'): void;
  (e: 'revert'): void;
  (e: 'merge'): void;
  (e: 'rebase'): void;
  (e: 'branch'): void;
  (e: 'cherry-pick'): void;
  (e: 'reset'): void;
  (e: 'tag'): void;
  (e: 'delete-tag', name: string): void;
  (e: 'checkout', branch: BranchName): void;
}>();

const has = (kind: AbilityKind): boolean => props.abilities.includes(kind);

/** ルートは打ち消せない。打ち消す前の状態が存在しないため。 */
const canRevert = computed(
  () => has('revert') && !!props.selected && (props.state.commits[props.selected]?.parents.length ?? 0) > 0,
);

const canMerge = computed(() => has('merge') && props.mergeable.length > 0);

/**
 * cherry-pick できるのは、いまの世界線から辿れない時点だけ。
 * すでに含まれている出来事は持ち込む意味がない。
 */
const canCherryPick = computed(() => {
  if (!has('cherry-pick') || !props.selected) return false;
  const head =
    props.state.head.type === 'branch'
      ? props.state.branches[props.state.head.branch]
      : props.state.head.commitId;
  return !!head && !isAncestorOf(props.state, props.selected, head);
});

/** reset は現在地より前の時点にしか戻せない。 */
const canReset = computed(() => {
  if (!has('reset') || !props.selected) return false;
  if (props.state.head.type !== 'branch') return false;
  const head = props.state.branches[props.state.head.branch];
  return !!head && props.selected !== head && isAncestorOf(props.state, props.selected, head);
});

/** 付いている印の一覧。印は動かないので、指している時点も一緒に見せる。 */
const tags = computed(() =>
  Object.entries(props.state.tags).map(([name, commitId]) => ({ name, commitId })),
);

const currentBranch = computed(() =>
  props.state.head.type === 'branch' ? props.state.head.branch : null,
);

const guidance = computed(() => {
  if (!props.selected) return '時点を選ぶと、その出来事に対して手を打てる。';

  const id = commitLabel(props.selected);
  if (canCherryPick.value) {
    return `${id} を選択中。別の世界線の出来事なので、CHERRY-PICK で持ち込める。`;
  }
  if (canReset.value) {
    return `${id} を選択中。REVERT で打ち消すか、RESET で時点ごと巻き戻せる。`;
  }
  return `${id} を選択中。REVERT でこの出来事を打ち消せる。`;
});
</script>

<template>
  <aside class="pane">
    <div class="stack">
      <span class="label">行使できる能力</span>

      <button
        v-if="has('commit')"
        class="ability"
        type="button"
        :disabled="!hasOffers"
        @click="emit('commit')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.commit.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.commit }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.commit.effect }}</span>
      </button>

      <button
        v-if="has('revert')"
        class="ability"
        type="button"
        :disabled="!canRevert"
        @click="emit('revert')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.revert.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.revert }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.revert.effect }}</span>
      </button>

      <button
        v-if="has('merge')"
        class="ability"
        type="button"
        :disabled="!canMerge"
        @click="emit('merge')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.merge.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.merge }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.merge.effect }}</span>
      </button>

      <button
        v-if="has('rebase')"
        class="ability destructive"
        type="button"
        :disabled="mergeable.length === 0"
        @click="emit('rebase')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.rebase.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.rebase }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.rebase.effect }}</span>
      </button>

      <button
        v-if="has('branch')"
        class="ability"
        type="button"
        :disabled="!selected"
        @click="emit('branch')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.branch.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.branch }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.branch.effect }}</span>
      </button>

      <button
        v-if="has('cherry-pick')"
        class="ability"
        type="button"
        :disabled="!canCherryPick"
        :title="ABILITY['cherry-pick'].effect"
        @click="emit('cherry-pick')"
      >
        <span class="line">
          <span class="name">{{ ABILITY['cherry-pick'].name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD['cherry-pick'] }}</span>
        </span>
        <span class="effect jp">{{ ABILITY['cherry-pick'].effect }}</span>
      </button>

      <button
        v-if="has('tag')"
        class="ability"
        type="button"
        :disabled="!selected"
        :title="ABILITY.tag.effect"
        @click="emit('tag')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.tag.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.tag }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.tag.effect }}</span>
      </button>

      <button
        v-if="has('reset')"
        class="ability destructive"
        type="button"
        :disabled="!canReset"
        :title="ABILITY.reset.effect"
        @click="emit('reset')"
      >
        <span class="line">
          <span class="name">{{ ABILITY.reset.name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD.reset }}</span>
        </span>
        <span class="effect jp">{{ ABILITY.reset.effect }}</span>
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

    <!-- 印は世界線と違って動かない。並べて置くことで、その差が目に入る -->
    <div v-if="tags.length > 0" class="stack">
      <span class="label">印</span>
      <div class="branches">
        <button
          v-for="tag in tags"
          :key="tag.name"
          class="branch tag"
          type="button"
          :disabled="!has('delete-tag')"
          :title="has('delete-tag') ? `${tag.name} の印を外す` : '印は外せない'"
          @click="emit('delete-tag', tag.name)"
        >
          <span>◆ {{ tag.name }}</span>
          <span class="tip">{{ commitLabel(tag.commitId) }}</span>
        </button>
      </div>
    </div>

  </aside>
</template>

<style scoped>
.pane {
  background: var(--panel);
  padding: 14px;
  min-width: 0;
  flex: 1;
  min-height: 0;
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
  text-align: left;
  background: var(--panel-hi);
  color: var(--ink);
  border: 1px solid var(--rule-firm);
  border-radius: 0;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 120ms linear, color 120ms linear;
}

.ability .line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.ability .name {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

/* 何が起きるかは、hover を待たずに常に見せる */
.ability .effect {
  font-size: 10px;
  line-height: 1.45;
  color: var(--ink-faint);
}
.ability:hover:not(:disabled) .effect {
  color: inherit;
  opacity: 0.8;
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

.branch.tag {
  color: var(--accent);
}
.branch.tag:disabled {
  cursor: default;
  opacity: 0.7;
}
.branch.tag:disabled:hover {
  border-color: transparent;
}
</style>
