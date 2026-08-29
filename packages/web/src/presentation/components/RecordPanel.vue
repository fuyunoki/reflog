<script setup lang="ts">
/**
 * 選んでいる時点で何が起きたか。
 *
 * このゲームでいちばん読ませたい情報なので、盤面のすぐ隣に置く。
 * 以前は画面最下部にあり、視線が届かなかった。
 */
import { computed } from 'vue';
import type { CommitId, StageSpec, TimelineState } from '@reflog/core';
import { commitLabel, factLabel, valueLabel } from '@/presentation/labels';
import AnnotatedText from '@/presentation/components/AnnotatedText.vue';

const props = defineProps<{
  spec: StageSpec;
  state: TimelineState;
  focused: CommitId | null;
}>();

const emit = defineEmits<{ (e: 'open-entry', entryId: string): void }>();

const commit = computed(() =>
  props.focused ? props.state.commits[props.focused] : undefined,
);

/** その時点が、どの世界線の上にあるか。 */
const refs = computed(() => {
  if (!props.focused) return [];
  return Object.entries(props.state.branches)
    .filter(([, tip]) => tip === props.focused)
    .map(([name]) => name);
});

const changes = computed(() => {
  const target = commit.value;
  if (!target) return [];
  return Object.entries(target.changes).map(([key, value]) => ({
    key,
    value,
    removed: value === null,
  }));
});
</script>

<template>
  <section class="record">
    <div class="head">
      <span class="label">
        観測記録<template v-if="focused"> — {{ commitLabel(focused) }}</template>
      </span>
      <span v-if="refs.length > 0" class="refs">{{ refs.join(' / ') }}</span>
    </div>

    <p class="narrative jp">
      <AnnotatedText
        :text="
          commit?.narrative ??
          commit?.message ??
          '世界線図の丸をクリックすると、その時点で何が起きたかを読める。'
        "
        @open="emit('open-entry', $event)"
      />
    </p>

    <template v-if="commit">
      <span class="label sub">この時点で変わったこと</span>
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
    </template>
  </section>
</template>

<style scoped>
.record {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.refs {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.narrative {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--ink);
  /* 物語を読ませる場所なので、行長を詰めすぎない */
  max-width: 46ch;
}

.sub {
  margin-top: 2px;
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
  padding: 3px 6px;
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
