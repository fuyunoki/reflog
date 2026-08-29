<script setup lang="ts">
/**
 * 語彙カード。人物・場所・用語の説明を 1 枚で見せる。
 *
 * 役割と用語には「実務でいう——」の一行が必ず付く。
 * 事案側（霧島湊、白鷺研究所など）には付けない。解説が挟まると事件の重みが落ちるため。
 */
import type { LexiconEntry } from '@reflog/core';

defineProps<{ entry: LexiconEntry }>();

const KIND_LABEL: Record<string, string> = {
  person: '人物',
  place: '場所',
  org: '機関',
  term: '用語',
};
</script>

<template>
  <article class="card">
    <span class="kind">{{ KIND_LABEL[entry.kind] ?? '記録' }}</span>
    <h3 class="name jp">{{ entry.name }}</h3>
    <p class="caption jp">{{ entry.caption }}</p>

    <div class="body jp">
      <p v-for="(line, i) in entry.lines" :key="i">{{ line }}</p>
    </div>

    <p v-if="entry.practice" class="practice jp">
      <span class="practice-label">実務でいう</span>{{ entry.practice }}
    </p>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--panel-hi);
  border: 1px solid var(--rule-firm);
  padding: 14px;
  min-width: 0;
}

.kind {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--accent);
}

.name {
  font-size: 17px;
  margin: 0;
  line-height: 1.3;
}

.caption {
  font-size: 11px;
  color: var(--ink-muted);
  margin: 0;
  line-height: 1.5;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.body p {
  font-size: 12px;
  line-height: 1.75;
  margin: 0;
}

/* 実務との対応は、物語の地の文と混ざらないよう明確に隔てる */
.practice {
  font-size: 11px;
  line-height: 1.7;
  margin: 6px 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--rule);
  color: var(--ink-muted);
}
.practice-label {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin-right: 8px;
}
</style>
