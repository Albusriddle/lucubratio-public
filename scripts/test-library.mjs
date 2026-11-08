// 课程库（web/shell/library.js）的纯逻辑自测
// 用 Node 的全局 fetch/window 桩件，把"内置课程 + 已导入课程"的合并逻辑真跑一遍。
//
// 用法：node scripts/test-library.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { unzipSync } from './lib/zip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'android/app/src/main/assets/web');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('\x1b[32m✓\x1b[0m ' + m); };
const bad = (m) => { fail++; console.log('\x1b[31m✗\x1b[0m ' + m); };

/**
 * 让 fetch 模拟设备上的两条来源：
 *   · /manifest.json、/shell/*           → 构建产物（assets）
 *   · /courses/<id>/**                   → 课程包（设备上是 filesDir/courses/<id>/**）
 * 课程包内容从 dist/demo-0.1.0.lcr 解出来，和真实导入后的磁盘布局一致。
 */
const PKG_DIR = path.join(ROOT, 'dist');

/**
 * dist/ 不入库（.gitignore），所以 CI 里没有现成课程包 —— 现场打一个。
 * 这样这个测试不依赖任何"事先存在的产物"，任何机器上都能跑。
 */
function ensurePackage() {
  const has = fs.existsSync(PKG_DIR) && fs.readdirSync(PKG_DIR).some((n) => n.endsWith('.lcr'));
  if (has) return;
  if (!fs.existsSync(path.join(OUT, 'manifest.json'))) {
    throw new Error('缺少构建产物：请先跑 node scripts/build.mjs');
  }
  execFileSync(process.execPath,
    [path.join(ROOT, 'scripts/pack.mjs'), '--id', 'demo', '--title', 'Lucubratio 示例课程', '--version', '0.1.0'],
    { cwd: ROOT, stdio: 'ignore' });
}

function loadCourses() {
  const map = new Map(); // "/courses/demo/xxx" → Buffer
  if (!fs.existsSync(PKG_DIR)) return map;
  for (const f of fs.readdirSync(PKG_DIR).filter((n) => n.endsWith('.lcr'))) {
    const id = f.replace(/-\d+\.\d+\.\d+\.lcr$/, '');
    for (const e of unzipSync(fs.readFileSync(path.join(PKG_DIR, f)))) {
      map.set(`/courses/${id}/${e.name}`, e.data);
    }
  }
  return map;
}

function installFetchStub() {
  const courses = loadCourses();
  globalThis.fetch = async (url) => {
    const rel = decodeURIComponent(String(url)).replace(/^\//, '');
    const key = '/' + rel;
    if (courses.has(key)) {
      const buf = courses.get(key);
      return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')) };
    }
    const p = path.join(OUT, rel);
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(fs.readFileSync(p, 'utf8')),
    };
  };
}

/** 安装原生桥桩件；metas 为 null 表示"没有原生桥" */
function installBridge(metas) {
  if (metas === null) {
    globalThis.window = {};
    return;
  }
  globalThis.window = {
    AndroidSA: {
      listCourses: () => JSON.stringify({ v: 1, courses: metas }),
    },
  };
}

ensurePackage();
installFetchStub();
const lib = await import('../web/shell/library.js');

/* ---------- 1) 无原生桥：只有内置课程 ---------- */
{
  installBridge(null);
  const l = await lib.loadLibrary();
  const st = lib.libraryStats(l);
  if (l.builtin && l.imported.length === 0 && st.builtinPages === 2) {
    ok(`无原生桥：内置 ${st.builtinPages} 篇，导入 0 门`);
  } else {
    bad(`无原生桥时结果异常：builtin=${!!l.builtin} imported=${l.imported.length} pages=${st.builtinPages}`);
  }
}

/* ---------- 2) 有导入课程：能合并并读到每门课的清单 ---------- */
{
  const metas = [{
    id: 'demo', title: '示例课程', version: '0.1.0',
    pages: 2, questions: 3, bytes: 17918, installedAt: Date.now(),
  }];
  installBridge(metas);
  const l = await lib.loadLibrary();
  const st = lib.libraryStats(l);

  if (l.imported.length === 1 && l.imported[0].manifest) {
    const items = lib.flattenItems(l.imported[0].manifest);
    if (items.length === 2 && items.every((it) => String(it.file).startsWith('/courses/demo/'))) {
      ok(`导入课程可读：${items.length} 篇，路径前缀正确`);
    } else {
      bad(`导入课程页面异常：${JSON.stringify(items.map((i) => i.file))}`);
    }
  } else {
    bad('导入课程的 manifest 没有读到');
  }

  if (st.importedCourses === 1 && st.importedPages === 2 && st.totalPages === 4) {
    ok(`统计正确：内置 ${st.builtinPages} + 导入 ${st.importedPages} = ${st.totalPages} 篇`);
  } else {
    bad(`统计异常：${JSON.stringify(st)}`);
  }
}

/* ---------- 3) 桥返回坏数据时不炸 ---------- */
{
  globalThis.window = { AndroidSA: { listCourses: () => '{ not json' } };
  const metas = lib.listImportedMetas();
  if (Array.isArray(metas) && metas.length === 0) ok('桥返回坏 JSON 时降级为空数组（不抛异常）');
  else bad('坏 JSON 未被安全处理：' + JSON.stringify(metas));
}

/* ---------- 4) 课程 manifest 缺失时降级 ---------- */
{
  installBridge([{ id: 'ghost', title: '幽灵课程', version: '1.0.0', pages: 9, bytes: 1, installedAt: Date.now() }]);
  const l = await lib.loadLibrary();
  const st = lib.libraryStats(l);
  if (l.imported.length === 1 && l.imported[0].manifest === null && st.importedPages === 9) {
    ok('课程清单缺失时用 meta.pages 兜底（首页不会少算页数）');
  } else {
    bad(`缺失清单的兜底异常：${JSON.stringify({ imported: l.imported.length, pages: st.importedPages })}`);
  }
}

/* ---------- 5) 格式化工具 ---------- */
{
  const b1 = lib.fmtBytes(17918), b2 = lib.fmtBytes(2 * 1024 * 1024), b3 = lib.fmtBytes(512);
  if (b1 === '17 KB' && b2 === '2.0 MB' && b3 === '512 B') ok(`体积格式化：${b1} / ${b2} / ${b3}`);
  else bad(`体积格式化异常：${b1} / ${b2} / ${b3}`);

  const d = lib.fmtDate(new Date(2026, 10, 8).getTime());
  if (d === '2026-11-08') ok('日期格式化：' + d);
  else bad('日期格式化异常：' + d);
}

/* ---------- 6) 检索索引合并（内置 + 已导入课程） ---------- */
{
  installBridge([{ id: 'demo', title: '示例课程', version: '0.1.0', pages: 2, bytes: 1, installedAt: Date.now() }]);
  const idx = await lib.loadSearchIndex();
  const cids = Object.keys(idx.pages || {});
  const hasBuiltin = cids.some((c) => !c.includes(':'));
  const hasCourse = cids.some((c) => String(c).startsWith('demo:'));
  if (hasBuiltin && hasCourse) {
    ok(`检索索引合并：${cids.length} 页 / ${idx.sections.length} 节（含内置与 demo: 前缀）`);
  } else {
    bad(`检索索引合并异常：pages=${JSON.stringify(cids)}`);
  }
  const badSection = (idx.sections || []).find((x) => !x.p);
  if (!badSection) ok('合并后的每个小节都带所属页面 id');
  else bad('存在没有 p 字段的小节');
}

/* ---------- 7) 课程归属判定（删除课程时靠它清数据） ---------- */
{
  const cases = [
    ['demo:os-01', 'demo', true],
    ['demo:os-01#检测 1', 'demo', true],
    ['os-01', 'demo', false],
    ['other:os-01', 'demo', false],
    ['', 'demo', false],
  ];
  let allOk = true;
  for (const [input, course, expect] of cases) {
    if (lib.belongsToCourse(input, course) !== expect) {
      allOk = false;
      bad(`归属判定错误：${JSON.stringify(input)} vs ${course} 期望 ${expect}`);
    }
  }
  if (allOk) ok(`归属判定：${cases.length} 个用例全对（内置 cid 不含 ":"）`);
  if (lib.courseIdOf('demo:os-01') === 'demo' && lib.courseIdOf('os-01') === null) {
    ok('courseIdOf：导入课程解析出 demo，内置返回 null');
  } else {
    bad('courseIdOf 结果异常');
  }
}

console.log('');
if (fail) {
  console.log(`\x1b[31m课程库自测失败：${fail} 项（通过 ${pass} 项）\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m课程库自测通过（${pass} 项）\x1b[0m`);
