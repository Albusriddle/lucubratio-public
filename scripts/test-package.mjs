// 打包器 + 校验器的自测（不依赖网络，跑在 CI 里）
// 用法：node scripts/test-package.mjs
//
// 覆盖：
//   1) 正常包 → 校验通过
//   2) Zip Slip（../ 与绝对路径）→ 被拒
//   3) 页面引用外部脚本 → 被拒
//   4) manifest 引用的页面缺失 → 被拒
//   5) format 版本不受支持 → 被拒

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipSync } from './lib/zip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VERIFY = path.join(ROOT, 'scripts', 'verify-package.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcr-test-'));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('\x1b[32m✓\x1b[0m ' + m); };
const bad = (m) => { fail++; console.log('\x1b[31m✗\x1b[0m ' + m); };

/** 跑 verify-package，返回 { code, out } */
function verify(file) {
  try {
    const out = execFileSync(process.execPath, [VERIFY, file], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** 造一个最小合法包 */
function makePkg(overrides = {}) {
  const id = overrides.id || 'demo';
  const prefix = `/courses/${id}/`;
  const page = overrides.page ||
    '<!doctype html><html><head><title>t</title></head><body><h2 id="a">A</h2><p>hi</p></body></html>';
  const manifest = overrides.manifest || {
    groups: [{ id: 'g', title: 'G', items: [{ id: `${id}-1`, file: `${prefix}content/p.html`, title: 'P' }] }],
    questionCount: 0,
  };
  const body = [
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    // 夹具要贴近真实包：pack.mjs 生成的 search.json 一定覆盖清单里的每一页，
    // 否则 verify-package 的「检索索引与清单一致」检查会（正确地）判它不合格。
    {
      name: 'search.json',
      data: JSON.stringify({
        v: 1,
        pages: Object.fromEntries(
          (manifest.groups || []).flatMap((g) => g.items || []).map((it) => [it.id, it.title || it.id])
        ),
        sections: (manifest.groups || [])
          .flatMap((g) => g.items || [])
          .map((it) => ({ p: it.id, a: 'a', h: it.title || 'P', x: 'hi' })),
      }),
    },
    { name: 'content/p.html', data: page },
    ...(overrides.extra || []),
  ];
  // bytes = 除 format.json 外所有条目解压后字节和（与 pack.mjs 口径一致）
  const bytes = body.reduce((n, e) => n + (Buffer.isBuffer(e.data) ? e.data.length : Buffer.byteLength(String(e.data), 'utf8')), 0);
  const format = overrides.format || {
    format: 'lcr/1', id, title: 'T', version: '0.1.0', appMin: '0.1.0',
    pages: 1, questions: 0, bytes, sha256: 'x',
  };
  const entries = [{ name: 'format.json', data: JSON.stringify(format) }, ...body];
  const file = path.join(tmp, `${id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}.lcr`);
  fs.writeFileSync(file, zipSync(entries));
  return file;
}

/* 1) 正常包 */
{
  const f = makePkg();
  const r = verify(f);
  if (r.code === 0) ok('正常包通过校验'); else bad('正常包被判失败:\n' + r.out);
}

/* 2) Zip Slip */
{
  const f = makePkg({ extra: [{ name: '../evil.txt', data: 'pwn' }] });
  const r = verify(f);
  if (r.code !== 0 && /不安全路径/.test(r.out)) ok('Zip Slip（../）被拒'); else bad('Zip Slip 未被拒:\n' + r.out);
}
{
  const f = makePkg({ extra: [{ name: '/etc/evil.txt', data: 'pwn' }] });
  const r = verify(f);
  if (r.code !== 0 && /不安全路径/.test(r.out)) ok('绝对路径被拒'); else bad('绝对路径未被拒:\n' + r.out);
}

/* 3) 外部脚本 */
{
  const f = makePkg({ page: '<!doctype html><html><body><script src="https://evil.example/x.js"></script></body></html>' });
  const r = verify(f);
  if (r.code !== 0 && /script 指向非|外部\/可执行 URL/.test(r.out)) ok('外部脚本被拒'); else bad('外部脚本未被拒:\n' + r.out);
}

/* 4) manifest 引用的页面缺失 */
{
  const id = 'demo';
  const manifest = { groups: [{ id: 'g', title: 'G', items: [{ id: 'd-2', file: `/courses/${id}/content/missing.html`, title: 'M' }] }], questionCount: 0 };
  const f = makePkg({ manifest, id });
  const r = verify(f);
  if (r.code !== 0 && /不在包内/.test(r.out)) ok('页面缺失被拒'); else bad('页面缺失未被拒:\n' + r.out);
}

/* 4b) P0-1 回归探针：各种"绕过写法"都必须被拒，合法写法必须放行 */
{
  const cases = [
    ['无引号 script src',
      '<!doctype html><html><body><script src=https://evil.example/x.js></script></body></html>', 'fail', /script 指向非|外部\/可执行/],
    ['单引号 script src',
      "<!doctype html><html><body><script src='https://evil.example/x.js'></script></body></html>", 'fail', /script 指向非|外部\/可执行/],
    ['纯内联 script',
      '<!doctype html><html><body><script>localStorage.setItem("pwn","1")</script></body></html>', 'fail', /内联 <script>/],
    ['斜杠分隔的 onerror',
      '<!doctype html><html><body><img/onerror=alert(1) src=x></body></html>', 'fail', /内联事件属性/],
    ['实体编码 javascript:',
      '<!doctype html><html><body><a href="&#106;avascript:alert(1)">x</a></body></html>', 'fail', /外部\/可执行 URL/],
    ['iframe 注入',
      '<!doctype html><html><body><iframe src="https://evil.example"></iframe></body></html>', 'fail', /禁止的标签|外部\/可执行/],
    ['style 内 @import',
      '<!doctype html><html><head><style>@import url(https://evil.example/a.css);</style></head><body></body></html>', 'fail', /@import|外部资源/],
    ['✅ 合法：type=text/plain 放 Mermaid',
      '<!doctype html><html><body><div class="mermaid"><script type="text/plain">flowchart TD\n  A["a"] --> B["b"]\n</script></div></body></html>', 'pass', null],
    ['✅ 合法：/shell/ 脚本与样式',
      '<!doctype html><html><head><link rel="stylesheet" href="/shell/shell.css"><script src="/shell/page.js"></script></head><body></body></html>', 'pass', null],
  ];

  for (const [name, page, expect, re] of cases) {
    const f = makePkg({ page });
    const r = verify(f);
    if (expect === 'fail') {
      if (r.code !== 0 && (!re || re.test(r.out))) ok(`探针被拒：${name}`);
      else bad(`探针未被拒：${name}\n${r.out}`);
    } else {
      if (r.code === 0) ok(`合法写法放行：${name}`);
      else bad(`合法写法被误杀：${name}\n${r.out}`);
    }
  }
}

/* 5) 未知 format */
{
  const f = makePkg({ format: { format: 'lcr/99', id: 'demo', title: 'T', version: '0.1.0', appMin: '0.1.0' } });
  const r = verify(f);
  if (r.code !== 0 && /不受支持/.test(r.out)) ok('未知包格式被拒'); else bad('未知格式未被拒:\n' + r.out);
}

/* 清理 */
fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (fail) {
  console.log(`\x1b[31m包自测失败：${fail} 项（通过 ${pass} 项）\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m包自测通过（${pass} 项）\x1b[0m`);
