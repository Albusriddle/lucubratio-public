/* ============================================================
   ASCII 字符画 → 内联 SVG（构建期转换）
   为什么这么做：
   Android 没有中文等宽字体，汉字/制表符的宽度不是 2:1，
   靠 CSS 定宽也只能修一半（拐角字形本身是短线）。
   转成 SVG 后每个字符按坐标定位、线条自己画，与字体完全无关，
   且矢量缩放清晰、颜色用 currentColor 跟随深色模式。
   ============================================================ */

const CELL_W = 7;      // 一个 ASCII 字符的宽度（1 格）
const ROW_H = 15;      // 行高
const FONT = 12;       // 字号
const BASELINE = 11.5; // 基线偏移
const STROKE = 1.1;

// 制表符 → 方向（l/r/u/d）。未列出的按横线处理。
const BOX_DIRS = {
  '─': 'lr', '━': 'lr', '═': 'lr', '-': null,
  '│': 'ud', '┃': 'ud', '║': 'ud',
  '┌': 'rd', '┍': 'rd', '┎': 'rd', '┏': 'rd', '╔': 'rd',
  '┐': 'ld', '┑': 'ld', '┒': 'ld', '┓': 'ld', '╗': 'ld',
  '└': 'ru', '┕': 'ru', '┖': 'ru', '┗': 'ru', '╚': 'ru',
  '┘': 'lu', '┙': 'lu', '┚': 'lu', '┛': 'lu', '╝': 'lu',
  '├': 'udr', '┝': 'udr', '┞': 'udr', '┟': 'udr', '┠': 'udr', '┡': 'udr', '┢': 'udr', '┣': 'udr', '╠': 'udr',
  '┤': 'udl', '┥': 'udl', '┦': 'udl', '┧': 'udl', '┨': 'udl', '┩': 'udl', '┪': 'udl', '┫': 'udl', '╣': 'udl',
  '┬': 'lrd', '┭': 'lrd', '┮': 'lrd', '┯': 'lrd', '┰': 'lrd', '┱': 'lrd', '┲': 'lrd', '┳': 'lrd', '╦': 'lrd',
  '┴': 'lru', '┵': 'lru', '┶': 'lru', '┷': 'lru', '┸': 'lru', '┹': 'lru', '┺': 'lru', '┻': 'lru', '╩': 'lru',
  '┼': 'lrud', '╀': 'lrud', '╁': 'lrud', '╂': 'lrud', '╃': 'lrud', '╄': 'lrud', '╅': 'lrud', '╆': 'lrud',
  '╇': 'lrud', '╈': 'lrud', '╉': 'lrud', '╊': 'lrud', '╋': 'lrud', '╬': 'lrud',
};

const isBox = (ch) => Object.prototype.hasOwnProperty.call(BOX_DIRS, ch);
const isFullWidth = (cp) => cp > 0x7e;

function charWidth(ch) {
  return isFullWidth(ch.codePointAt(0)) ? 2 : 1;
}

function textWidth(s) {
  let n = 0;
  for (const ch of s) n += charWidth(ch);
  return n;
}

/**
 * 修复源文件里"竖线不在主干列上"的 ASCII 图。
 *
 * 背景：这些图是人在不同编辑器里拼的，汉字的宽度假设不一致，
 * 导致文字行的 │ 与上下边框的角（┌┐└┘）差出十几列。
 * 做法：以水平边框行上的角列作为"主干列"（rails），
 * 把文字行的竖线按顺序吸附过去，再按新列重新铺文本。
 * 只有在「竖线数量 == 主干列数量」且偏移可控时才动手，否则原样返回。
 */
export function repairDiagram(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const isBorder = (l) => /[─]/.test(l) && /[┌┐└┘┬┴┼]/.test(l);
  const borderLines = lines.filter(isBorder);
  if (borderLines.length < 2) return { text, repaired: false, moved: 0 };

  const colCount = {};
  for (const line of borderLines) {
    let c = 0;
    for (const ch of line) {
      if (/[┌┐└┘┬┴┼]/.test(ch)) colCount[c] = (colCount[c] || 0) + 1;
      c += charWidth(ch);
    }
  }
  const rails = Object.keys(colCount)
    .map(Number)
    .filter((c) => colCount[c] >= 2)
    .sort((a, b) => a - b);
  if (rails.length < 2) return { text, repaired: false, moved: 0 };
  const railSet = new Set(rails);

  let moved = 0;
  const out = lines.map((line) => {
    if (isBorder(line)) return line;
    if (line.indexOf('│') < 0) return line;

    const verts = [];
    let c = 0;
    for (const ch of line) {
      if (ch === '│') verts.push(c);
      c += charWidth(ch);
    }
    if (verts.length !== rails.length) return line;
    if (verts.every((v, i) => v === rails[i])) return line;         // 本来就对齐
    if (verts.some((v, i) => Math.abs(v - rails[i]) > 40)) return line; // 偏太多，可能是别的结构

    const segs = line.split('│');
    if (segs.length !== rails.length + 1) return line;

    let rebuilt = '';
    let col = 0;
    for (let i = 0; i < rails.length; i++) {
      rebuilt += ' '.repeat(Math.max(0, rails[i] - col));
      rebuilt += '│';
      col = rails[i] + 2;
      const inner = (segs[i + 1] || '').trim();
      if (inner) {
        rebuilt += ' ' + inner;
        col += 1 + textWidth(inner);
      }
    }
    if (rebuilt.trimEnd() !== line.trimEnd()) moved++;
    return rebuilt.trimEnd();
  });

  return { text: out.join('\n'), repaired: moved > 0, moved };
}


function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(n) {
  return Math.round(n * 100) / 100;
}

/** 单个制表符 → 若干线段 */
function boxPaths(ch, x0, y0, wCells) {
  const dirs = BOX_DIRS[ch];
  if (!dirs) return '';
  const x1 = x0 + wCells * CELL_W;
  const cx = (x0 + x1) / 2;
  const y1 = y0 + ROW_H;
  const cy = y0 + ROW_H / 2;
  let d = '';
  if (dirs.indexOf('l') >= 0) d += `M${num(x0)} ${num(cy)}H${num(cx)}`;
  if (dirs.indexOf('r') >= 0) d += `M${num(cx)} ${num(cy)}H${num(x1)}`;
  if (dirs.indexOf('u') >= 0) d += `M${num(cx)} ${num(y0)}V${num(cy)}`;
  if (dirs.indexOf('d') >= 0) d += `M${num(cx)} ${num(cy)}V${num(y1)}`;
  return d;
}

/**
 * @param {string} text 纯文本（不含标签）
 * @returns {{svg:string, cols:number, rows:number, boxes:number}}
 */
export function asciiToSvg(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  // 先算网格：非 ASCII 记 2 格
  const grid = lines.map((line) => {
    const cells = [];
    let col = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      const w = isFullWidth(cp) ? 2 : 1;
      cells.push({ ch, col, w });
      col += w;
    }
    return cells;
  });

  const cols = grid.reduce((m, cells) => {
    const last = cells[cells.length - 1];
    return Math.max(m, last ? last.col + last.w : 0);
  }, 0);
  const rows = grid.length;
  if (!cols || !rows) return { svg: '', cols: 0, rows: 0, boxes: 0 };

  const width = cols * CELL_W;
  const height = rows * ROW_H;

  let paths = '';
  let boxes = 0;
  const texts = [];

  grid.forEach((cells, row) => {
    const y0 = row * ROW_H;
    let run = null;

    const flush = () => {
      if (!run) return;
      const x = run.col * CELL_W;
      const len = run.cells * CELL_W;
      const s = esc(run.text);
      texts.push(
        `<text x="${num(x)}" y="${num(y0 + BASELINE)}" textLength="${num(len)}" lengthAdjust="spacing">${s}</text>`
      );
      run = null;
    };

    for (const cell of cells) {
      const ch = cell.ch;
      if (ch === ' ') { flush(); continue; }

      if (isBox(ch)) {
        flush();
        const d = boxPaths(ch, cell.col * CELL_W, y0, cell.w);
        if (d) { paths += d; boxes++; }
        continue;
      }

      if (!run) run = { col: cell.col, cells: 0, text: '' };
      run.cells += cell.w;
      run.text += ch;
    }
    flush();
  });

  const body =
    (paths ? `<path d="${paths}" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="butt"/>` : '') +
    (texts.length ? `<g fill="currentColor" font-family="monospace" font-size="${FONT}">${texts.join('')}</g>` : '');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" ` +
    `width="${num(width)}" height="${num(height)}" role="img" aria-label="结构图">${body}</svg>`;

  return { svg, cols, rows, boxes };
}
