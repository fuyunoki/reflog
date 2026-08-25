<script setup lang="ts">
/**
 * コマンド入力の端末。
 *
 * ボタンで概念を掴んだあと、同じ操作を本物の git の構文で打ち直せるようにする。
 * 出力は git の見た目に寄せ、ここで見慣れた形が実務でそのまま読めることを狙う。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { COMMAND_HINTS } from '@reflog/core';
import type { ConsoleLine } from '@/stores/session';

const props = defineProps<{
  lines: readonly ConsoleLine[];
  history: readonly string[];
}>();

const emit = defineEmits<{ (e: 'run', input: string): void }>();

const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const field = ref<HTMLInputElement | null>(null);
/** 履歴を遡っている位置。null なら入力中。 */
const historyCursor = ref<number | null>(null);

/** 入力途中の語に前方一致する候補。 */
const suggestions = computed(() => {
  const text = input.value.trim().toLowerCase();
  if (text.length === 0) return [];
  const normalized = text.startsWith('git ') ? text : `git ${text}`;
  return COMMAND_HINTS.filter((hint) => hint.usage.toLowerCase().startsWith(normalized)).slice(
    0,
    4,
  );
});

const scrollToEnd = async (): Promise<void> => {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
};

watch(() => props.lines.length, scrollToEnd);

const submit = (): void => {
  const value = input.value;
  if (value.trim().length === 0) return;
  emit('run', value);
  input.value = '';
  historyCursor.value = null;
  void scrollToEnd();
};

const recall = (direction: -1 | 1): void => {
  if (props.history.length === 0) return;

  if (historyCursor.value === null) {
    historyCursor.value = direction === -1 ? props.history.length - 1 : props.history.length;
  } else {
    historyCursor.value = Math.min(
      props.history.length,
      Math.max(0, historyCursor.value + direction),
    );
  }

  input.value =
    historyCursor.value >= props.history.length
      ? ''
      : (props.history[historyCursor.value] as string);
};

/** Tab は最初の候補で補う。git を省いて打っていた場合もそのまま補完する。 */
const complete = (): void => {
  const first = suggestions.value[0];
  if (!first) return;
  const usage = first.usage;
  const upToPlaceholder = usage.split(' <')[0] as string;
  input.value = usage.includes('<') ? `${upToPlaceholder} ` : usage;
};

const focus = (): void => field.value?.focus();

defineExpose({ focus });
</script>

<template>
  <section class="console" @click="focus">
    <div ref="scroller" class="scroll">
      <div v-for="line in lines" :key="line.id" class="line" :class="line.kind">
        <span v-if="line.kind === 'input'" class="prompt">$</span>
        <span class="text">{{ line.text }}</span>
      </div>
    </div>

    <div v-if="suggestions.length > 0" class="suggestions">
      <div v-for="hint in suggestions" :key="hint.usage" class="suggestion">
        <span class="usage">{{ hint.usage }}</span>
        <span class="summary jp">{{ hint.summary }}</span>
      </div>
      <span class="tab-note">Tab で補完</span>
    </div>

    <form class="entry" @submit.prevent="submit">
      <span class="prompt">$</span>
      <input
        ref="field"
        v-model="input"
        class="field"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="コマンド入力"
        placeholder="git status"
        @keydown.up.prevent="recall(-1)"
        @keydown.down.prevent="recall(1)"
        @keydown.tab.prevent="complete"
      />
    </form>
  </section>
</template>

<style scoped>
.console {
  background: var(--panel-sub);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.65;
  cursor: text;
}

.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
}

.line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.line .text {
  min-width: 0;
}

.line.input .text {
  color: var(--ink);
  font-weight: 500;
}
.line.output .text {
  color: var(--ink-muted);
}
.line.error .text {
  color: var(--accent);
}
.line.note .text {
  color: var(--ink-faint);
  font-family: var(--jp);
  font-size: 11px;
}

.prompt {
  color: var(--accent);
  user-select: none;
  flex-shrink: 0;
}

.suggestions {
  border-top: 1px solid var(--rule);
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--panel);
}

.suggestion {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 11px;
}

.usage {
  color: var(--ink);
  white-space: nowrap;
}

.summary {
  color: var(--ink-faint);
  font-size: 11px;
  min-width: 0;
}

.tab-note {
  font-size: 9px;
  color: var(--ink-faint);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-top: 2px;
}

.entry {
  display: flex;
  gap: 8px;
  align-items: center;
  border-top: 1px solid var(--rule-firm);
  padding: 10px 14px;
  background: var(--panel);
}

.field {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
  padding: 0;
}

.field::placeholder {
  color: var(--ink-faint);
}

.field:focus-visible {
  outline: none;
}

.entry:focus-within {
  box-shadow: inset 0 0 0 1px var(--accent);
}
</style>
