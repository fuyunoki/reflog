<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** 警告として見せるか。矛盾の提示や破壊的操作の確認に使う。 */
    alert?: boolean;
    /** 背景クリックと Esc で閉じられるか。 */
    dismissible?: boolean;
  }>(),
  { alert: false, dismissible: true },
);

const emit = defineEmits<{ (e: 'close'): void }>();

const close = (): void => {
  if (props.dismissible) emit('close');
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && props.open) close();
};

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="scrim" @click.self="close">
    <div
      class="dialog"
      :class="{ 'is-alert': alert }"
      role="dialog"
      aria-modal="true"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 19, 0.55);
  display: grid;
  place-items: center;
  padding: 20px;
  z-index: 20;
}

.dialog {
  background: var(--panel);
  border: 1px solid var(--rule-firm);
  max-width: 620px;
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog.is-alert {
  border-color: var(--accent);
  border-width: 2px;
}
</style>
