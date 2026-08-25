import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // 静的ホスティングのサブパス配置でも動くようにしておく
  base: './',
  resolve: {
    alias: {
      // core は TS ソースを直接束ねる。ビルド成果物を挟まないので型もそのまま効く。
      '@reflog/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
