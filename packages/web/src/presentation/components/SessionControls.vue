<script setup lang="ts">
/**
 * 手を戻す・助言を求める。
 *
 * 操作の入口（パネル / コンソール）に関係なく要るものなので、
 * どちらのモードでも左の列の同じ位置に出す。
 */
defineProps<{
  canUndo: boolean;
  hasHints: boolean;
}>();

defineEmits<{
  (e: 'undo'): void;
  (e: 'hint'): void;
}>();
</script>

<template>
  <div class="session-controls">
    <span class="label">記録</span>
    <button class="btn" type="button" :disabled="!canUndo" @click="$emit('undo')">
      一手戻す
    </button>
    <button v-if="hasHints" class="btn" type="button" @click="$emit('hint')">
      助言を求める
    </button>
  </div>
</template>

<style scoped>
/*
 * クラス名は親と重ならないものにする。
 * 子コンポーネントのルート要素には親の scoped スタイルも適用されるため、
 * StageView 側の .controls（横並び・中央揃え）に上書きされてしまう。
 */
.session-controls {
  display: flex;
  flex-direction: column;
  /* ボタンは列の幅いっぱいに広げる */
  align-items: stretch;
  gap: 7px;
  padding: 12px 14px;
  border-top: 1px solid var(--rule-firm);
  background: var(--panel);
  flex-shrink: 0;
}

/* ラベルは左端に置く */
.session-controls .label {
  text-align: left;
}
</style>
