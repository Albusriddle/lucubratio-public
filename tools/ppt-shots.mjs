#!/usr/bin/env node
// 把课件的指定页渲染成「课程内嵌用」的小图
//
// 为什么不直接用抽取阶段那批图：那批是 200dpi 全页（平均 86 KB），
// 内嵌进正文会把包从 1.7 MB 撑到 20 MB；正文里只需要「手机上够清晰」的缩略图。
//
// 用法：
//   # 单门：从抽取报告取「图页」清单（empty_pages + low_text_pages）
//   node tools/ppt-shots.mjs --deck vm1 --pdf "F:/26秋季专业课/操作系统/vm-1.pdf" \
//        --report .work/vm1/report.json --out web/img
//
//   # 指定页
//   node tools/ppt-shots.mjs --deck vm1 --pdf <pdf> --pages 4,8,11 --out web/img
//
//   # 一次跑全 9 门（读取 decks.json 约定）
//   node tools/ppt-shots.mjs --all
//
// 参数：--width 900 --quality 68
// 产物：<out>/<deck>/pNNN.webp

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(n);

const OUT = opt('--out', 'web/img');
const WIDTH = Number(opt('--width', '900'));
const QUALITY = Number(opt('--quality', '68'));

const PY = `
import sys, json, io, pathlib
import pymupdf
from PIL import Image

pdf_path, out_dir, pages_json, width, quality = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
pages = json.loads(pages_json)
deck_dir = pathlib.Path(out_dir)
deck_dir.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(pdf_path)
written = 0
total = 0
for pno in pages:
    if pno < 1 or pno > len(doc):
        continue
    page = doc[pno - 1]
    pix = page.get_pixmap(dpi=200)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if img.width > width:
        h = max(1, round(img.height * width / img.width))
        img = img.resize((width, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=4)
    data = buf.getvalue()
    (deck_dir / ("p%03d.webp" % pno)).write_bytes(data)
    written += 1
    total += len(data)
doc.close()
print(json.dumps({"written": written, "bytes": total}))
`;

function runDeck(deck, pdf, pages) {
  const dir = path.join(OUT, deck);
  const list = [...new Set(pages)].sort((a, b) => a - b);
  if (!list.length) {
    console.log(`  ${deck}: 无需渲染`);
    return { written: 0, bytes: 0 };
  }
  const res = execFileSync('python', ['-c', PY, pdf, dir, JSON.stringify(list), String(WIDTH), String(QUALITY)], {
    encoding: 'utf8',
  });
  const r = JSON.parse(res.trim().split('\n').pop());
  console.log(`  ${deck.padEnd(7)} ${String(r.written).padStart(3)} 张  ${(r.bytes / 1048576).toFixed(2)} MB`);
  return r;
}

/* ---------- --all：一次跑全 9 门 ---------- */
// 课件 PDF 与抽取目录的对应关系（讲次编号 → deck）
const DECKS = {
  '01': { deck: 'intro', pdf: 'intro.pdf', work: 'intro1' },
  '02': { deck: 'vcpu1', pdf: 'vcpu-1.pdf', work: 'vcpu1' },
  '03': { deck: 'vcpu2', pdf: 'vcpu-2.pdf', work: 'vcpu2' },
  '04': { deck: 'vcpu3', pdf: 'vcpu-3.pdf', work: 'vcpu3' },
  '05': { deck: 'vm1', pdf: 'vm-1.pdf', work: 'vm1' },
  '06': { deck: 'vm2', pdf: 'vm-2.pdf', work: 'vm2' },
  '07': { deck: 'vm3', pdf: 'vm-3.pdf', work: 'vm3' },
  '08': { deck: 'vm4', pdf: 'vm-4.pdf', work: 'vm4' },
  '09': { deck: 'conc1', pdf: 'conc-1.pdf', work: 'conc1' },
};
const SRC_DIR = opt('--src', 'F:/26秋季专业课/操作系统');

if (flag('--all')) {
  let all = { written: 0, bytes: 0 };
  for (const [no, d] of Object.entries(DECKS)) {
    const reportPath = path.join('.work', d.work, 'report.json');
    if (!fs.existsSync(reportPath)) {
      console.log(`  ${d.deck.padEnd(7)} 跳过（缺 ${reportPath}）`);
      continue;
    }
    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const pages = [...new Set([...(rep.empty_pages || []), ...(rep.low_text_pages || [])])];
    const pdf = path.join(SRC_DIR, d.pdf);
    if (!fs.existsSync(pdf)) {
      console.log(`  ${d.deck.padEnd(7)} 跳过（缺 ${pdf}）`);
      continue;
    }
    const r = runDeck(d.deck, pdf, pages);
    all.written += r.written;
    all.bytes += r.bytes;
  }
  console.log(`\n合计 ${all.written} 张 / ${(all.bytes / 1048576).toFixed(2)} MB → ${OUT}/`);
  process.exit(0);
}

/* ---------- 单门 ---------- */
const deck = opt('--deck');
const pdf = opt('--pdf');
if (!deck || !pdf) {
  console.error('用法：node tools/ppt-shots.mjs --deck <name> --pdf <pdf> (--pages 4,8 | --report .work/x/report.json) [--out web/img]');
  console.error('      或：node tools/ppt-shots.mjs --all');
  process.exit(2);
}
if (!fs.existsSync(pdf)) {
  console.error('PDF 不存在: ' + pdf);
  process.exit(2);
}

let pages = [];
if (opt('--pages')) {
  pages = opt('--pages').split(',').map((x) => Number(x.trim())).filter(Boolean);
} else if (opt('--report')) {
  const rep = JSON.parse(fs.readFileSync(opt('--report'), 'utf8'));
  pages = [...new Set([...(rep.empty_pages || []), ...(rep.low_text_pages || [])])];
} else {
  console.error('需要 --pages 或 --report');
  process.exit(2);
}

const r = runDeck(deck, pdf, pages);
console.log(`合计 ${r.written} 张 / ${(r.bytes / 1048576).toFixed(2)} MB → ${path.join(OUT, deck)}`);
