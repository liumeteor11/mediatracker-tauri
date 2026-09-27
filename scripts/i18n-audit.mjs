#!/usr/bin/env node
/**
 * i18n audit — keeps src/locales/{zh,en}.json and the t('…') keys used in the
 * source in sync.
 *
 * Fails (exit 1) on:
 *   - a key used in the source that is missing from a locale
 *   - a key that exists in only one of the two locales
 *   - a key whose interpolation placeholders differ between locales
 *   - a dynamic key prefix (media_type.*, ai_config.reasoning_*) with a gap
 *   - the `t('key') || 'fallback'` anti-pattern (i18next returns the key, so
 *     the fallback never runs — use { defaultValue: … } instead)
 *
 * Warns (exit 0) about locale keys nothing references and hard-coded CJK text
 * in components, which are both usually leftovers.
 *
 * Usage: npm run i18n:audit
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const localesDir = path.join(root, 'src', 'locales');

const flatten = (obj, prefix = '', out = {}) => {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
};

const readLocale = (name) => {
  const file = path.join(localesDir, `${name}.json`);
  return flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
};

const zh = readLocale('zh');
const en = readLocale('en');

const sourceFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(path.join(root, 'src'));

const used = new Map();
const dynamicPrefixes = new Set();
const fallbackIdiom = [];
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');
  for (const match of text.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_.]+)\1/g)) {
    const key = match[2];
    if (!used.has(key)) used.set(key, rel);
  }
  for (const match of text.matchAll(/\bt\(\s*`([A-Za-z0-9_.]*)\$\{/g)) dynamicPrefixes.add(match[1]);
  text.split('\n').forEach((line, i) => {
    if (/\bt\(\s*['"`][^'"`]+['"`][^)]*\)\s*\|\|/.test(line)) fallbackIdiom.push(`${rel}:${i + 1}`);
  });
}

const problems = [];
const missingIn = (locale) => [...used.keys()].filter((key) => !(key in locale));
for (const key of missingIn(zh)) problems.push(`missing in zh.json: ${key}  (used in ${used.get(key)})`);
for (const key of missingIn(en)) problems.push(`missing in en.json: ${key}  (used in ${used.get(key)})`);

for (const key of Object.keys(zh)) if (!(key in en)) problems.push(`only in zh.json: ${key}`);
for (const key of Object.keys(en)) if (!(key in zh)) problems.push(`only in en.json: ${key}`);

const placeholders = (value) =>
  typeof value === 'string'
    ? (value.match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g) || []).map((s) => s.replace(/[{} ]/g, '')).sort().join(',')
    : '';
for (const key of Object.keys(zh)) {
  if (!(key in en)) continue;
  const a = placeholders(zh[key]);
  const b = placeholders(en[key]);
  if (a !== b) problems.push(`placeholder mismatch: ${key} — zh[${a}] vs en[${b}]`);
}

for (const prefix of dynamicPrefixes) {
  const has = (locale) => Object.keys(locale).some((key) => key.startsWith(prefix));
  if (!has(zh) || !has(en)) problems.push(`dynamic key prefix "${prefix}*" has no entries in ${!has(zh) ? 'zh.json' : 'en.json'}`);
}

for (const site of fallbackIdiom) problems.push(`t(...) || fallback never runs, use defaultValue: ${site}`);

const unused = Object.keys(zh).filter((key) => !used.has(key) && ![...dynamicPrefixes].some((p) => key.startsWith(p)));
const hardcoded = [];
for (const file of sourceFiles) {
  if (!file.endsWith('.tsx')) continue;
  const rel = path.relative(root, file).replace(/\\/g, '/');
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (/[\u4e00-\u9fff]/.test(code) && !/\bt\(/.test(code)) hardcoded.push(`${rel}:${i + 1}`);
    });
}

const report = {
  locales: { zh: Object.keys(zh).length, en: Object.keys(en).length },
  keysUsedInSource: used.size,
  dynamicPrefixes: [...dynamicPrefixes],
  problems,
  warnings: {
    definedButUnused: unused,
    hardcodedCjkInComponents: hardcoded,
  },
};
console.log(JSON.stringify(report, null, 2));

if (problems.length > 0) {
  console.error(`\ni18n audit failed with ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\ni18n audit passed.');
