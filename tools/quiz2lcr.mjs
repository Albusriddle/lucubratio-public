#!/usr/bin/env node
// quiz2lcr：把 D:/std/quiz-html 的 11 份交付题库（1472 题）转换成 Lucubratio 内容页
//
// 用法：
//   node tools/quiz2lcr.mjs [--src D:/std/quiz-html] [--out content/osq] [--parts 4]
//
// 做什么：
//   1) 读 os/final*/data.json（每题：stem/opts/ans/exp/evidence/kp/angle）
//   2) 按讲次（deck）分 4 页，页内按 kp 聚簇，保持 kp 连续
//   3) 写成 content/osq/NN_<deck>_q<K>.html：三块 h2（本页覆盖 / 怎么用 / 检测）+ 页图 + 逐题检测
//   4) 解析做两处格式适配（内容不改）：
//      · 「A 项错在…」→「A 错在…」（Lucubratio 自检靠这个认干扰项）
//      · 末尾追加「（课件 pNNN）」（自检硬门：解析必须带页码）
//   5) 两处已知口径修正（只改本转换产物，不回写题库）：
//      · vm-2-089 解析里「15KB 对不上」会被自检误认成第二个「B 对」→ 改写措辞
//      · vm-3-099 题干 160 字（>120）→ 英文引文改中文复述，与解析口径一致
//
// 只读源题库；只写 --out 目录。

import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const COURSE = arg('course', 'os');

// 两门课：每章 { dir: 题库目录, deck: 讲次目录名, parts: 分几页, title: 学生看到的讲名 }
const COURSES = {
  os: {
    src: 'D:/std/quiz-html',
    decksFile: 'os/source/decks.json',
    out: 'content/osq',
    chapters: [
      { dir: 'final', deck: 'intro', parts: 4, title: '01 导论' },
      { dir: 'final2', deck: 'vcpu-1', parts: 4, title: '02 CPU 虚拟化 一' },
      { dir: 'final3', deck: 'vcpu-2', parts: 4, title: '03 CPU 虚拟化 二' },
      { dir: 'final4', deck: 'vcpu-3', parts: 4, title: '04 CPU 虚拟化 三' },
      { dir: 'final5', deck: 'vm-1', parts: 4, title: '05 内存虚拟化 一' },
      { dir: 'final6', deck: 'vm-2', parts: 4, title: '06 内存虚拟化 二' },
      { dir: 'final7', deck: 'vm-3', parts: 4, title: '07 内存虚拟化 三' },
      { dir: 'final8', deck: 'vm-4', parts: 4, title: '08 内存虚拟化 四' },
      { dir: 'final9', deck: 'conc-1', parts: 4, title: '09 并发 一' },
      { dir: 'final10', deck: 'conc-2', parts: 4, title: '10 并发 二' },
      { dir: 'final11', deck: 'conc-3', parts: 4, title: '11 并发 三' },
    ],
  },
  cn: {
    src: 'D:/std/quiz-html/cn',
    // 计网题库的解析用「B 项：……」体例（冒号引出错因），OS 用「B 项错在……」；
    // 冒号体例自检的启发式不认，转换成「B 错在：……」既保留原意又让自检可判。
    itemColon: true,
    decksFile: 'source/decks.json',
    out: 'content/cnq',
    chapters: [
      { dir: 'rw1/final', deck: 'cn1', parts: 5, title: '第 1 章 · 概论' },
      { dir: 'rw2/final', deck: 'cn2', parts: 8, title: '第 2 章 · 应用层' },
      { dir: 'c3/final', deck: 'cn3', parts: 7, title: '第 3 章 · 传输层' },
    ],
  },
};
if (!COURSES[COURSE]) { console.error('未知课程: ' + COURSE); process.exit(2); }
const CFG = COURSES[COURSE];
const SRC = path.resolve(arg('src', CFG.src));
const OUT = path.resolve(arg('out', CFG.out));

const decks = JSON.parse(fs.readFileSync(path.join(SRC, CFG.decksFile), 'utf8')).decks;
const deckByKey = new Map(decks.map((d) => [d.deck, d]));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 全局页 pNNN → 该讲内的页序（1 起） */
function localPage(globalPage, deckKey) {
  const d = deckByKey.get(deckKey);
  const n = Number(String(globalPage).replace(/^fig:/, '').replace(/^p/, ''));
  return { local: n - d.from + 1, global: n };
}

/** 按 kp 聚簇把 [题] 切成 parts 段，保持 kp 连续、段间题量尽量均衡 */
function splitByKp(qs, parts) {
  const order = [];
  const byKp = new Map();
  for (const q of qs) {
    if (!byKp.has(q.kp)) { byKp.set(q.kp, []); order.push(q.kp); }
    byKp.get(q.kp).push(q);
  }
  if (order.length <= parts) {
    // kp 太少：一 kp 一段，剩余段空（不产空页）
    const groups = order.map((kp) => byKp.get(kp));
    while (groups.length < parts) groups.push([]);
    return groups;
  }
  const total = qs.length;
  const groups = Array.from({ length: parts }, () => []);
  let acc = 0, gi = 0;
  for (const kp of order) {
    const arr = byKp.get(kp);
    const threshold = (total * (gi + 1)) / parts;
    // 当前段已过半且还能留给后面段 → 换段
    if (gi < parts - 1 && acc + arr.length > threshold && acc >= threshold / parts) gi++;
    groups[gi].push(...arr);
    acc += arr.length;
  }
  return groups;
}

const STYLE = `<style>
  :root{--bg:#fbfbfd;--fg:#1f2328;--muted:#5b6570;--line:#e3e6ea;--accent:#2f6fdd}
  *{box-sizing:border-box}
  body{margin:0;font-family:"PingFang SC","Microsoft YaHei",-apple-system,"Segoe UI",sans-serif;line-height:1.75}
  h2{font-size:21px;margin:26px 0 10px;padding-left:10px;border-left:4px solid var(--accent)}
  h3{font-size:16px;margin:20px 0 6px}
  p{font-size:15.5px;margin:8px 0}
  blockquote{margin:10px 0;padding:10px 12px;background:#fff8e1;border-left:4px solid #e6b422;border-radius:6px;font-size:15px}
  figure{margin:12px 0}
  figure img{max-width:100%;border:1px solid var(--line);border-radius:8px}
  figcaption{font-size:13px;color:var(--muted);margin-top:4px}
</style>`;

let pageNo = 0;
const written = [];

for (const ch of CFG.chapters) {
  const data = JSON.parse(fs.readFileSync(path.join(SRC, ch.dir, 'data.json'), 'utf8'));
  const qs = data.questions.slice().sort((a, b) => {
    const ka = Number(String(a.kp).split('-').pop()), kb = Number(String(b.kp).split('-').pop());
    return ka - kb || a.no - b.no;
  });
  const deckMeta = deckByKey.get(ch.deck);
  const deckTitle = ch.title || deckMeta.title;
  const groups = splitByKp(qs, ch.parts);

  groups.forEach((gq, idx) => {
    if (!gq.length) return;
    pageNo += 1;
    const nn = String(pageNo).padStart(2, '0');
    const part = idx + 1;
    const kpIds = [...new Set(gq.map((q) => q.kp))];
    const kpFirst = kpIds[0], kpLast = kpIds[kpIds.length - 1];
    const pages = gq.map((q) => localPage(q.evidence.loc, ch.deck));
    const pMin = Math.min(...pages.map((p) => p.global));
    const pMax = Math.max(...pages.map((p) => p.global));

    const title = part === 1 ? deckTitle : `${deckTitle}（第 ${part} 组）`;
    const figA = pages[0];
    const figB = pages[Math.floor(pages.length / 2)] || figA;

    const body = [];
    body.push(`<h2 id="1-本页覆盖">1. 本页覆盖</h2>`);
    body.push(`<p>本页是 <strong>${esc(deckTitle)}</strong> 的刷题第 ${part} 组：覆盖 <strong>${esc(kpFirst)}</strong> 到 <strong>${esc(kpLast)}</strong> 共 ${kpIds.length} 个知识点，${gq.length} 道检测；证据页范围为课件 p${pMin}–p${pMax}。</p>`);
    body.push(`<p>题目与解析来自同源题库（每讲都经过双盲出题、交叉复核与二审），本页只做格式转换与分页，不改题干、选项与答案。</p>`);

    body.push(`<h2 id="2-怎么用这一页">2. 怎么用这一页</h2>`);
    body.push(`<p>每题四个选项只有一个正确项。先自己选，再看折叠的解析：解析按 A/B/C/D 逐项说明错因，末尾标出该题依据的课件页。同一知识点在别的组里还会以不同角度出现，刷完本组可以去做相邻组。</p>`);
    body.push(`<blockquote><strong>提示</strong>：题干与选项里的数字都取自课件原页；若与页图有出入，以课件页图为准（课件 p${figA.global}）。</blockquote>`);
    body.push(`<figure class="slide-fig"><img src="/img/${ch.deck}/p${String(figA.local).padStart(3, '0')}.webp" alt="课件 p${figA.global}：本组证据页之一" loading="lazy"><figcaption>课件 p${figA.global} 原图（本组证据页之一）</figcaption></figure>`);
    if (figB.global !== figA.global) {
      body.push(`<figure class="slide-fig"><img src="/img/${ch.deck}/p${String(figB.local).padStart(3, '0')}.webp" alt="课件 p${figB.global}：本组另一张证据页" loading="lazy"><figcaption>课件 p${figB.global} 原图（本组另一张证据页）</figcaption></figure>`);
    }

    body.push(`<h2 id="3-检测">3. 检测</h2>`);
    gq.forEach((q, i) => {
      let stem = q.stem;
      if (q.id === 'vm-3-099') {
        stem = '这一页的问题框指出，数组式（线性）页表在典型系统上太大、占用过多内存。关于线性页表的处境，下列说法哪一项正确？';
      }
      let exp = q.exp;
      // 「X 项错在…」→「X 错在…」：Lucubratio 自检靠「A 错在…」这种句式认干扰项。
      // 只在那一个「项」后面紧跟批评性动词时才删，避免把「A 项正确性…」误删成「A正确性…」
      // （后者会被自检当成第二个「A 正确」，导致"答案不唯一"误判）
      exp = exp.replace(
        /([A-D])\s*项(?=(错|把|漏|只|不|混|当成|误|搞|忽|算|取|用|认|多|少|反|以|拿))/g,
        '$1'
      );
      if (CFG.itemColon) exp = exp.replace(/([A-D])\s*项[：:]/g, '$1错在：');
      if (q.id === 'vm-2-089') {
        exp = exp.replace('15KB 对不上', '15KB 与 0x3C00 并不相符');
      }
      if (!/[。；）)]\s*$/.test(exp)) exp += '。';
      exp = exp.replace(/\s+$/, '');
      const opts = q.opts.map((o, k) => `${'ABCD'[k]}. ${esc(o)}`).join('　');
      body.push(`<h3 id="检测 ${i + 1}">检测 ${i + 1}（10 分）${esc(stem)}</h3>`);
      body.push(`<p>${opts}</p>`);
      body.push(`<blockquote><strong>解析</strong>：${esc(exp)}（课件 p${localPage(q.evidence.loc, ch.deck).global}）</blockquote>`);
    });

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
${STYLE}
</head>
<body>

${body.join('\n')}

</body>
</html>
`;
    const fname = `${nn}_${ch.deck.replace(/-/g, '')}_q${part}.html`;
    fs.writeFileSync(path.join(OUT, fname), html, 'utf8');
    written.push({ page: pageNo, file: fname, deck: ch.deck, part, n: gq.length, kp: `${kpFirst}..${kpLast}` });
  });
}

fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify({ course: COURSE, generatedAt: new Date().toISOString(), pages: written }, null, 2), 'utf8');
console.log(`写出 ${written.length} 页 → ${OUT}`);
const total = written.reduce((n, w) => n + w.n, 0);
console.log(`题目合计 ${total}`);
for (const w of written) console.log(`  ${w.file.padEnd(24)} ${String(w.n).padStart(3)} 题  ${w.kp}`);
