<script setup lang="ts">
/**
 * これまでに渡された術式の一覧。
 *
 * プレイ中は盤面と記録に集中させたいので、参照はここに集める。
 * まだ渡されていないものは伏せるが、残り数は見せる（何が待っているか分かる方が進む）。
 */
import { computed } from 'vue';
import type { AbilityKind } from '@reflog/core';
import { CAUSAL_LOAD } from '@reflog/core';
import { ABILITY } from '@/presentation/labels';

const props = defineProps<{ learned: readonly AbilityKind[] }>();

/** ゲーム内に存在する術式の全種類。 */
const ALL = Object.keys(ABILITY) as AbilityKind[];

/** 覚えた順ではなく、性質が近いものが並ぶように定義順で出す。 */
const known = computed(() => ALL.filter((kind) => props.learned.includes(kind)));
const remaining = computed(() => ALL.length - known.value.length);
</script>

<template>
  <section class="catalog">
    <div class="head">
      <span class="label">術式</span>
      <span class="label">{{ known.length }} / {{ ALL.length }}</span>
    </div>

    <p v-if="known.length === 0" class="empty jp">
      まだ何も渡されていない。訓練を始めると、ひとつずつ手渡される。
    </p>

    <div v-else class="grid">
      <div
        v-for="kind in known"
        :key="kind"
        class="card"
        :class="{ destructive: ABILITY[kind].destructive }"
      >
        <div class="card-head">
          <span class="name">{{ ABILITY[kind].name }}</span>
          <span class="cost">負荷 {{ CAUSAL_LOAD[kind] }}</span>
        </div>
        <span class="effect jp">{{ ABILITY[kind].effect }}</span>
        <code class="command">{{ ABILITY[kind].command }}</code>
      </div>
    </div>

    <p v-if="remaining > 0" class="remaining jp">
      まだ渡されていない術式が {{ remaining }} 種ある。
    </p>
  </section>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--rule-firm);
  padding-bottom: 6px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 1px;
  background: var(--rule);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 12px;
  background: var(--panel);
  /* 歴史が消える術式だけ、縁で見分けられるようにする */
  border-left: 2px solid transparent;
}
.card.destructive {
  border-left-color: var(--accent);
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.name {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

.cost {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--ink-faint);
  white-space: nowrap;
}

.effect {
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.command {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
  overflow-x: auto;
}

.empty,
.remaining {
  margin: 0;
  font-size: 11px;
  color: var(--ink-faint);
  line-height: 1.6;
}
</style>
