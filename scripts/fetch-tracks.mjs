#!/usr/bin/env node
/**
 * Скачивает реальные SVG-схемы трасс Ф1 (julesr0y/f1-circuits-svg, стиль black-outline)
 * и генерирует src/game/tracksvgs.generated.ts с геометрией.
 *
 * Запуск (один раз, нужен Node 18+):
 *   node scripts/fetch-tracks.mjs
 *
 * После этого пересоберите игру: npm run build
 * Игра автоматически подхватит реальные контуры вместо рукописных.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'src', 'game', 'tracksvgs.generated.ts');
const BASE = 'https://raw.githubusercontent.com/julesr0y/f1-circuits-svg/main/circuits/detailed/black-outline/';

/** файл в репозитории -> ключ трассы (outline) в календаре игры */
const MAP = {
  'melbourne-2.svg': 'melbourne',
  'shanghai-1.svg': 'shanghai',
  'suzuka-2.svg': 'suzuka',
  'bahrain-1.svg': 'bahrain',
  'jeddah-1.svg': 'jeddah',
  'miami-1.svg': 'miami',
  'monaco-6.svg': 'monaco',
  'catalunya-6.svg': 'barcelona',
  'montreal-6.svg': 'montreal',
  'spielberg-3.svg': 'spielberg',
  'silverstone-8.svg': 'silverstone',
  'spa-francorchamps-4.svg': 'spa',
  'hungaroring-3.svg': 'hungaroring',
  'zandvoort-5.svg': 'zandvoort',
  'monza-7.svg': 'monza',
  'baku-1.svg': 'baku',
  'marina-bay-4.svg': 'singapore',
  'austin-1.svg': 'austin',
  'mexico-city-3.svg': 'mexico',
  'interlagos-2.svg': 'interlagos',
  'las-vegas-1.svg': 'vegas',
  'yas-marina-2.svg': 'yasmarina',
  'lusail-1.svg': 'lusail',
  'madring-1.svg': 'madrid',
};

async function fetchWithRetry(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`Не удалось скачать ${url}`);
}

/** Извлекает d="" самого длинного (желательно замкнутого) path из SVG */
function extractPath(svg) {
  const ds = [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) return null;
  const closed = ds.filter((d) => /[zZ]\s*$/.test(d.trim()) || /\bz\b/.test(d));
  const pool = closed.length ? closed : ds;
  return pool.reduce((a, b) => (b.length > a.length ? b : a), '');
}

const entries = [];
let ok = 0;
for (const [file, key] of Object.entries(MAP)) {
  try {
    const svg = await fetchWithRetry(BASE + file);
    const d = extractPath(svg);
    if (!d || d.length < 40) throw new Error('path не найден или слишком короткий');
    entries.push(`  ${key}: ${JSON.stringify(d)},`);
    ok++;
    console.log(`  ✓ ${key.padEnd(12)} (${file}) — ${d.length} символов`);
  } catch (e) {
    console.error(`  ✗ ${key.padEnd(12)} (${file}) — ${e.message}`);
  }
  // мягкая пауза, чтобы не упираться в лимиты GitHub
  await new Promise((r) => setTimeout(r, 400));
}

const body = [
  '// СГЕНЕРИРОВАНО АВТОМАТИЧЕСКИ — node scripts/fetch-tracks.mjs',
  '// Реальные контуры трасс Ф1 (julesr0y/f1-circuits-svg, black-outline).',
  '// Имеет приоритет над рукописными TRACK_OUTLINES.',
  'export const GENERATED_TRACK_SVGS: Record<string, string> = {',
  ...entries,
  '};',
  '',
].join('\n');

writeFileSync(OUT, body, 'utf8');
console.log(`\nГотово: ${ok}/${Object.keys(MAP).length} трасс -> ${OUT}`);
console.log('Теперь выполните: npm run build');
