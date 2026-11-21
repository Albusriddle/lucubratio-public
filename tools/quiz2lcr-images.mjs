#!/usr/bin/env node
// 把 quiz-html 的课件页图（PNG）转成 Lucubratio 的 web/img/<deck>/pNNN.webp
//
// 用法：node tools/quiz2lcr-images.mjs --src D:/std/quiz-html/cn/source --course cn
//
// 规则（与 tools/ppt-shots.mjs 的产物规格一致）：
//   · 长边上限 1200 px（超出等比缩放），WebP quality 80
//   · 文件名 pNNN.webp，NNN = 该讲内的页序（1 起，三位补零）
//   · 已存在的文件跳过（幂等）；--force 覆盖
//
// 依赖：Python + Pillow（python -c "import PIL"）

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const SRC = path.resolve(arg('src', 'D:/std/quiz-html/cn/source'));
const COURSE = arg('course', 'cn');
const FORCE = process.argv.includes('--force');
const DEST = path.resolve('web/img');

const decks = JSON.parse(fs.readFileSync(path.join(SRC, 'decks.json'), 'utf8')).decks;

const py = `
import json, os, sys
from PIL import Image
src, dest, decks, force = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4] == '1'
jobs = []
for d in decks:
    outdir = os.path.join(dest, d['deck'])
    os.makedirs(outdir, exist_ok=True)
    for g in range(d['from'], d['to'] + 1):
        local = g - d['from'] + 1
        srcf = os.path.join(src, 'img', 'p%03d.png' % g)
        if not os.path.exists(srcf):
            # 兼容 .jpg
            alt = os.path.join(src, 'img', 'p%03d.jpg' % g)
            if os.path.exists(alt): srcf = alt
            else: continue
        dstf = os.path.join(outdir, 'p%03d.webp' % local)
        if os.path.exists(dstf) and not force: continue
        jobs.append((srcf, dstf))
ok = 0
for srcf, dstf in jobs:
    im = Image.open(srcf).convert('RGBA')
    w, h = im.size
    if max(w, h) > 1200:
        s = 1200.0 / max(w, h)
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    im.save(dstf, 'WEBP', quality=80, method=6)
    ok += 1
print(json.dumps({'converted': ok, 'skipped': len(jobs) - ok}))
`;

const out = execFileSync('python', ['-c', py, SRC, DEST, JSON.stringify(decks), FORCE ? '1' : '0'], { encoding: 'utf8' });
console.log(COURSE, out.trim());
