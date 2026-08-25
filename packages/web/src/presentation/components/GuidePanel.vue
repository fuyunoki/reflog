<script setup lang="ts">
/**
 * 手引き。
 *
 * 初見のプレイヤーが「何をする遊びなのか」を掴めないまま放り出されないための表示。
 * 常に一段だけ出し、条件を満たすと自動で次へ進む。
 * 読むだけの段には確認ボタンを出す。
 */
import { computed } from 'vue';
import type { GuideState } from '@reflog/core';

const props = defineProps<{ guide: GuideState }>();
const emit = defineEmits<{ (e: 'acknowledge'): void }>();

const needsAcknowledge = computed(
  () => props.guide.current?.until.type === 'acknowledged',
);
</script>

<template>
  <div v-if="guide.current" class="guide" role="note">
    <div class="head-row">
      <span class="label">手引き {{ guide.index + 1 }} / {{ guide.total }}</span>
    </div>

    <p class="text jp">{{ guide.current.text }}</p>
    <p v-if="guide.current.note" class="note jp">{{ guide.current.note }}</p>

    <button
      v-if="needsAcknowledge"
      class="btn primary ack"
      type="button"
      @click="emit('acknowledge')"
    >
      わかった
    </button>
  </div>
</template>

<style scoped>
.guide {
  background: var(--panel);
  border-left: 3px solid var(--accent);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 盤面の上に重ねるが、図の操作は妨げない位置に置く */
  max-width: 62ch;
}

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.text {
  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--ink);
}

.note {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-muted);
}

.ack {
  align-self: flex-start;
  margin-top: 4px;
}
</style>
