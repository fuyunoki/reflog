/**
 * ビルド成果物を 1 枚の HTML にまとめる。
 *
 * このゲームはサーバなしで完全に動くので、束ねてしまえば
 * ファイル 1 つ配るだけで遊べる状態になる。共有や動作確認に使う。
 *
 * 使い方:
 *   npm run build -w @reflog/web
 *   node scripts/bundle-single-file.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'packages', 'web', 'dist');

const html = readFileSync(join(dist, 'index.html'), 'utf-8');

/** インラインに埋めるとき、閉じタグが本文中にあると HTML が壊れる。 */
const escapeForInline = (code) => code.replaceAll('</script>', '<\\/script>');

const readAsset = (src) => {
  const relative = src.replace(/^\.?\//, '');
  return readFileSync(join(dist, relative), 'utf-8');
};

let output = html;

// <link rel="stylesheet" href="..."> を <style> に畳む
output = output.replace(
  /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (match, href) => {
    // Google Fonts は外部のまま残す（CSP で許可されている）
    if (href.startsWith('http')) return match;
    return `<style>\n${readAsset(href)}\n</style>`;
  },
);

// <script src="..."> を中身に置き換える
output = output.replace(
  /<script([^>]*)src="([^"]+)"([^>]*)><\/script>/g,
  (match, before, src, after) => {
    if (src.startsWith('http')) return match;
    const attrs = `${before} ${after}`.replace(/crossorigin/g, '').trim();
    return `<script ${attrs}>\n${escapeForInline(readAsset(src))}\n</script>`;
  },
);

// Artifact 用に、外枠のタグを外して中身だけにする
const bodyMatch = output.match(/<head[^>]*>([\s\S]*?)<\/head>[\s\S]*?<body[^>]*>([\s\S]*?)<\/body>/);
const artifact = bodyMatch
  ? `${bodyMatch[1].trim()}\n${bodyMatch[2].trim()}\n`
  : output;

const target = join(dist, 'reflog-single.html');
writeFileSync(target, artifact, 'utf-8');

const kb = (Buffer.byteLength(artifact, 'utf-8') / 1024).toFixed(1);
console.log(`wrote ${target} (${kb} kB)`);
