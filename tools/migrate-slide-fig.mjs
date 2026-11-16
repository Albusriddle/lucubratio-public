#!/usr/bin/env node
/**
 * 把旧式 `<figure class="sa-ppt" data-ppt="…"></figure>` 迁成 AGENTS 约定 1.5 的 `figure.slide-fig`
 * （显式 <img src> + alt + figcaption），用于整本渲染后统一结构、拿到图注角标。
 *
 * 用法：node tools/migrate-slide-fig.mjs [--write] [--pages .work/pages]
 *   不加 --write 只统计（dry-run）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const PAGES = path.join(ROOT, (args[args.indexOf('--pages') + 1] && args.includes('--pages')) ? args[args.indexOf('--pages') + 1] : '.work/pages');

// 讲次 → deck / 抽取目录：以 tools/decks.json 为唯一权威（16 讲，含 ex-* 练习）
const DECK = {};
const WORK = {};
(() => {
  const fallback = {
    '01': ['intro', 'intro1'], '02': ['vcpu-1', 'vcpu1'], '03': ['vcpu-2', 'vcpu2'],
    '04': ['vcpu-3', 'vcpu3'], '05': ['vm-1', 'vm1'], '06': ['vm-2', 'vm2'],
    '07': ['vm-3', 'vm3'], '08': ['vm-4', 'vm4'], '09': ['conc-1', 'conc1'],
    '10': ['conc-2', 'conc2'], '11': ['conc-3', 'conc3'],
  };
  let table = fallback;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'decks.json'), 'utf8'));
    const out = {};
    for (const [no, v] of Object.entries(raw)) if (v && v.deck) out[no] = [v.deck, v.work || ''];
    if (Object.keys(out).length) table = out;
  } catch (e) { console.log('  · 读不到 tools/decks.json，用内置 11 讲映射'); }
  for (const [no, [deck, work]] of Object.entries(table)) { DECK[no] = deck; WORK[no] = work; }
})();

/** 从抽取出来的逐页文本里取一句"这页在讲什么"，取不到就退回页码 */
function hint(lec, page) {
  const w = WORK[lec];
  if (!w) return '';
  const f = path.join(ROOT, '.work', w, 'pages', `p${String(page).padStart(3, '0')}.md`);
  if (!fs.existsSync(f)) return '';
  const lines = fs.readFileSync(f, 'utf8').split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !s.startsWith('|') && !/^（本页无文字层/.test(s));
  const first = lines[0] || '';
  const clean = first.replace(/\s+/g, '').replace(/[|]/g, '').slice(0, 24);
  return clean;
}

const files = fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).sort();
let total = 0, unresolved = 0, changed = 0;
for (const f of files) {
  const abs = path.join(PAGES, f);
  const src = fs.readFileSync(abs, 'utf8');
  const own = (f.match(/^(\d{2})_/) || [])[1] || '';
  let n = 0;
  const out = src.replace(/<figure\s+class="sa-ppt"\s+data-ppt="([^"]+)"\s*><\/figure>/g, (_m, spec) => {
    const raw = String(spec).trim();
    let lec = own, page;
    if (raw.includes(':')) { const [l, p] = raw.split(':'); lec = l.trim(); page = Number(p); }
    else page = Number(raw);
    const deck = DECK[lec];
    if (!deck || !Number.isFinite(page) || page < 1) { unresolved++; return _m; }
    const p3 = `p${String(page).padStart(3, '0')}.webp`;
    const rel = `/img/${deck}/${p3}`;
    if (!fs.existsSync(path.join(ROOT, 'web', 'img', deck, p3))) { unresolved++; return _m; }
    const h = hint(lec, page);
    const alt = h ? `课件 p${page}：${h}` : `课件 p${page}`;
    const cap = h ? `课件 p${page} 原图（${h}）` : `课件 p${page} 原图`;
    n++; total++;
    return `<figure class="slide-fig">\n  <img src="${rel}" alt="${alt}" loading="lazy">\n  <figcaption>${cap}</figcaption>\n</figure>`;
  });
  if (n) {
    changed++;
    console.log(`  ${f}: ${n} 处`);
    if (WRITE) fs.writeFileSync(abs, out);
  }
}
console.log(`\n  合计 ${total} 处（${changed} 个文件），未解析/缺图 ${unresolved} 处${WRITE ? '，已写入' : '（dry-run，未写入）'}`);
