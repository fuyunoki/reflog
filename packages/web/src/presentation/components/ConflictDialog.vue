<script setup lang="ts">
/**
 * 矛盾の提示。
 *
 * このゲームの背骨にあたる画面。conflict をパズルの失敗としてではなく、
 * 「どちらの現実を採るか」という決断として見せる。
 * git の conflict マーカーをそのまま使うことで、実際の作業と体験を結びつける。
 */
import type { Conflict, ConflictResolution, FactKey, StageSpec } from '@reflog/core';
import { factLabel, valueLabel } from '@/presentation/labels';
import ModalShell from './ModalShell.vue';

const props = defineProps<{
  open: boolean;
  spec: StageSpec;
  from: string;
  conflicts: readonly Conflict[];
  choices: Record<FactKey, ConflictResolution>;
  allDecided: boolean;
}>();

const emit = defineEmits<{
  (e: 'decide', key: FactKey, resolution: ConflictResolution): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const chosenSide = (key: FactKey): string | undefined => props.choices[key]?.type;

const rawValue = (value: string | null): string => (value === null ? '(なし)' : value);
</script>

<template>
  <ModalShell :open="open" alert :dismissible="false" @close="emit('cancel')">
    <span class="label">CONFLICT — 両立しない現実</span>
    <h2 class="head jp">
      {{ conflicts.length === 1 ? '現実が食い違っている' : `${conflicts.length} 箇所で現実が食い違っている` }}
    </h2>

    <div v-for="conflict in conflicts" :key="conflict.key" class="block">
      <div class="marker">&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD（現在の世界線）</div>

      <button
        type="button"
        class="choice"
        :class="{ 'is-chosen': chosenSide(conflict.key) === 'ours' }"
        @click="emit('decide', conflict.key, { type: 'ours' })"
      >
        <span class="side"><span class="side-key">Ours</span> — 現在の世界線</span>
        <span class="jp">
          この世界では、{{ factLabel(spec, conflict.key) }}は<strong>{{
            valueLabel(spec, conflict.ours)
          }}</strong
          >のままだ。
        </span>
        <span class="raw">{{ conflict.key }} = {{ rawValue(conflict.ours) }}</span>
      </button>

      <div class="marker">=======</div>

      <button
        type="button"
        class="choice"
        :class="{ 'is-chosen': chosenSide(conflict.key) === 'theirs' }"
        @click="emit('decide', conflict.key, { type: 'theirs' })"
      >
        <span class="side"><span class="side-key">Theirs</span> — {{ from }}</span>
        <span class="jp">
          回収された記録では、{{ factLabel(spec, conflict.key) }}は<strong>{{
            valueLabel(spec, conflict.theirs)
          }}</strong
          >だった。
        </span>
        <span class="raw">{{ conflict.key }} = {{ rawValue(conflict.theirs) }}</span>
      </button>

      <div class="marker">&gt;&gt;&gt;&gt;&gt;&gt;&gt; {{ from }}</div>
    </div>

    <p class="note jp">
      どちらの現実を採用しますか。選ばなかった方は、この世界から失われます。
    </p>

    <div class="actions">
      <button class="btn" type="button" @click="emit('cancel')">統合を中止する</button>
      <button class="btn primary" type="button" :disabled="!allDecided" @click="emit('confirm')">
        この現実で確定する
      </button>
    </div>
  </ModalShell>
</template>

<style scoped>
.block {
  border: 1px solid var(--rule);
  background: var(--panel-hi);
}

.marker {
  font-family: var(--mono);
  font-size: 10px;
  padding: 5px 9px;
  color: var(--ink-faint);
  border-bottom: 1px solid var(--rule);
  letter-spacing: 0.03em;
  overflow-x: auto;
  white-space: nowrap;
}

.choice {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  border-left: 3px solid transparent;
  padding: 12px 14px;
  cursor: pointer;
  color: var(--ink);
  font-family: var(--jp);
  font-size: 13px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: background 120ms linear, border-color 120ms linear;
}
.choice:hover {
  background: var(--accent-wash);
}
.choice:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.choice.is-chosen {
  background: var(--accent-wash);
  border-left-color: var(--accent);
}

.side {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.05em;
  color: var(--ink-faint);
}

/* ブランチ名は git の識別子なので大文字化しない */
.side-key {
  text-transform: uppercase;
}

.raw {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-muted);
}

.note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.7;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
