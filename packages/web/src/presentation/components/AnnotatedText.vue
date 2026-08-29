<script setup lang="ts">
/**
 * 本文中の登録語に下線を引き、押せるようにする。
 *
 * 本文の側にリンクを書かせない方針。ステージ JSON は物語を書く場所であって、
 * 印を付ける場所ではない。語彙を 1 つ足せば過去の本文すべてに自動で反映される。
 */
import { computed } from 'vue';
import { annotate } from '@reflog/core';
import { lexiconSource } from '@/infrastructure/StaticLexiconSource';

const props = defineProps<{
  text: string;
  /** 同じ語に何度も下線を引かないための共有セット。段落をまたいで渡す。 */
  once?: Set<string>;
}>();

const emit = defineEmits<{ (e: 'open', entryId: string): void }>();

const segments = computed(() => annotate(props.text, lexiconSource.all, props.once));
</script>

<template>
  <span
    ><template v-for="(segment, i) in segments" :key="i"><button
        v-if="segment.kind === 'entry'"
        class="term"
        type="button"
        @click="emit('open', segment.entryId)"
      >{{ segment.text }}</button><template v-else>{{ segment.text }}</template></template></span
  >
</template>

<style scoped>
/*
 * 本文の途中に置くので、見た目はあくまで文字。
 * ボタンらしさを出すと読み物として成立しなくなる。
 */
.term {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  border-bottom: 1px dashed var(--accent);
  padding: 0;
  margin: 0;
  cursor: pointer;
}
.term:hover {
  color: var(--accent);
  border-bottom-style: solid;
}
.term:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
