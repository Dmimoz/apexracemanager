// Собирает всю игру в один самодостаточный HTML-файл.
// Использование:  npm run build  &&  node scripts/singlefile.mjs
// Результат:      dist/apex-single.html  (его можно загрузить на Netlify или открыть двойным кликом)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const src = path.join(dist, 'index.html');

if (!fs.existsSync(src)) {
  console.error('Сначала выполните: npm run build');
  process.exit(1);
}

let html = fs.readFileSync(src, 'utf8');
let inlined = 0;

// CSS: <link rel="stylesheet" href="/assets/..."> -> <style>...</style>
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
  const href = tag.match(/href="([^"]+)"/)?.[1];
  if (!href) return tag;
  const file = path.join(dist, href.replace(/^\//, ''));
  if (!fs.existsSync(file)) return tag;
  inlined++;
  return `<style>${fs.readFileSync(file, 'utf8')}</style>`;
});

// JS: <script type="module" src="/assets/..."></script> -> инлайн
html = html.replace(/<script[^>]*\ssrc="([^"]+)"[^>]*>\s*<\/script>/g, (tag, s) => {
  const file = path.join(dist, s.replace(/^\//, ''));
  if (!fs.existsSync(file)) return tag;
  inlined++;
  return `<script type="module">${fs.readFileSync(file, 'utf8')}</script>`;
});

const out = path.join(dist, 'apex-single.html');
fs.writeFileSync(out, html, 'utf8');
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`Готово: ${out} (${kb} КБ, инлайнено файлов: ${inlined})`);
