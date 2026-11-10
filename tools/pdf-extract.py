#!/usr/bin/env python3
"""
课件 PDF → 逐页 Markdown（供生成阶段阅读）+ 纯图页渲染成 WebP（供校对/插图）

用法：
    python tools/pdf-extract.py <课件.pdf> [--out DIR] [--render] [--dpi 150] [--max-pages N]

输出目录结构：
    <out>/pages/p001.md …     每页一段，"## p<页码>" 开头；无文字层会明确写出来
    <out>/report.json         总页数 / 每页字符数 / 无文字页列表 / 建议分段
    <out>/img/p001.webp …     仅 --render 时生成（纯图页，或全部页）

设计取舍：
- **不做 OCR**。扫描件 OCR 出来的字用来"生成课程"错误率太高，宁可让作者看图补写。
- 逐页单独成文件，方便把某一页单独喂给子智能体，也方便按页定位错误。
"""

import argparse
import json
import os
import sys

# Windows 控制台默认 GBK，打印中文/符号会炸；统一切到 UTF-8（失败则忽略）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

MIN_PYMUPDF = (1, 24)

_deps_reported = False

def require_deps(check_only: bool = False) -> None:
    """前置依赖检查：缺什么就明确说、给出安装命令、以退出码 2 结束。"""
    global pymupdf, _deps_reported
    try:
        import pymupdf  # PyMuPDF ≥1.24 的包名
    except ImportError:
        try:
            import fitz as pymupdf  # 老版本只有 fitz
        except ImportError:
            print("✗ 缺少 PyMuPDF（PDF 解析与图页渲染都需要它）", file=sys.stderr)
            print("  安装：pip install -U pymupdf pillow", file=sys.stderr)
            sys.exit(2)

    ver = tuple(int(x) for x in pymupdf.__version__.split(".")[:2]) if hasattr(pymupdf, "__version__") else (0, 0)
    if ver < MIN_PYMUPDF:
        print(f"✗ PyMuPDF 版本过低：{'.'.join(map(str, ver))}（需要 ≥ {'.'.join(map(str, MIN_PYMUPDF))}）", file=sys.stderr)
        print("  升级：pip install -U pymupdf", file=sys.stderr)
        sys.exit(2)

    has_pil = True
    try:
        import PIL  # noqa: F401
    except ImportError:
        has_pil = False

    if _deps_reported:
        if check_only:
            sys.exit(0)
        return
    _deps_reported = True
    print(f"✓ PyMuPDF {pymupdf.__version__}")
    if has_pil:
        print("✓ Pillow（图页可转 WebP）")
    else:
        print("· 未安装 Pillow：图页会保留 PNG（构建器也吃 PNG，不影响正确性）")
        print("  需要 WebP 时：pip install pillow")
    if check_only:
        sys.exit(0)


require_deps()


def main() -> int:
    ap = argparse.ArgumentParser(description="课件 PDF → 逐页 Markdown")
    ap.add_argument("pdf", nargs="?", help="课件 PDF 路径（--check-deps 时可省）")
    ap.add_argument("--out", default=None, help="输出目录（默认 <pdf 同名>_extract）")
    ap.add_argument("--render", action="store_true", help="把纯图页渲染成 WebP")
    ap.add_argument("--render-all", action="store_true", help="所有页都渲染（校对配图用）")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--max-pages", type=int, default=0, help="只处理前 N 页（0=全部）")
    ap.add_argument("--segment", type=int, default=30, help="建议每段页数（写进 report）")
    ap.add_argument("--check-deps", action="store_true", help="只检查依赖环境后退出")
    ap.add_argument("--low-text", type=int, default=200,
                    help="含内嵌图且文字少于该值的页，会在 md 里提示看图（默认 200；"
                         "实测「文字 26 字 + 整页图」这种页只按字数会漏标）")
    args = ap.parse_args()
    if args.check_deps:
        require_deps(check_only=True)
    if not args.pdf:
        ap.error("缺少 PDF 路径（或加 --check-deps 只检查环境）")

    if not os.path.isfile(args.pdf):
        sys.exit(f"找不到文件：{args.pdf}")

    out = args.out or (os.path.splitext(args.pdf)[0] + "_extract")
    pages_dir = os.path.join(out, "pages")
    img_dir = os.path.join(out, "img")
    os.makedirs(pages_dir, exist_ok=True)

    doc = pymupdf.open(args.pdf)
    total = len(doc)
    limit = min(total, args.max_pages) if args.max_pages else total

    report = {
        "pdf": os.path.abspath(args.pdf),
        "pages": total,
        "processed": limit,
        "empty_pages": [],
        "low_text_pages": [],   # 有少量文字但关键信息在图里（如"运行结果"+ 终端截图）
        "chars_by_page": {},
        "suggested_segments": [],
    }

    seg = args.segment
    report["suggested_segments"] = [
        {"from": i + 1, "to": min(i + seg, limit)} for i in range(0, limit, seg)
    ]

    rendered = 0
    for i in range(limit):
        page = doc[i]
        text = page.get_text("text").strip()
        report["chars_by_page"][str(i + 1)] = len(text)

        # 图有两种：内嵌位图（get_images）与矢量图（get_drawings）。
        # 只数位图会漏掉「整页状态图」这种矢量插图——实测 p29 就是纯矢量。
        n_img = len(page.get_images(full=True))
        try:
            n_draw = len(page.get_drawings())
        except Exception:
            n_draw = 0
        has_img = n_img > 0
        has_draw = n_draw >= 20          # 少量线条多是分隔线/表格框，不算插图
        low_text = bool(text) and len(text) < args.low_text and (has_img or has_draw)
        if low_text:
            report["low_text_pages"].append(i + 1)

        body = [f"## p{i + 1}\n"]
        if text and not low_text:
            body.append(text + "\n")
        elif low_text:
            body.append(text + "\n")
            body.append("（本页文字很少，关键信息在内嵌图片里：请看 img/p%03d.webp 并据图补写，不要臆造。）\n" % (i + 1))
        else:
            report["empty_pages"].append(i + 1)
            body.append("（本页无文字层：纯图/截图。请查看 img/p%03d.webp 后据图补写，不要臆造。）\n" % (i + 1))

        with open(os.path.join(pages_dir, f"p{i + 1:03d}.md"), "w", encoding="utf-8") as f:
            f.write("".join(body))

        # 只要页面含内嵌图就渲染：文字多少不代表图里没有信息
        # （实测 vcpu-1 的 p29/p48 文字 26 字左右，却是整页状态图与 29 行代码）
        want_img = args.render_all or (args.render and (not text or low_text or has_img or has_draw))
        if want_img:
            os.makedirs(img_dir, exist_ok=True)
            pix = page.get_pixmap(dpi=args.dpi)
            pix.save(os.path.join(img_dir, f"p{i + 1:03d}.png"))
            rendered += 1

    doc.close()

    # PNG → WebP（有 Pillow 才转；没有就保留 PNG，构建器也吃 PNG）
    if rendered:
        try:
            from PIL import Image

            for name in os.listdir(img_dir):
                if not name.endswith(".png"):
                    continue
                src = os.path.join(img_dir, name)
                im = Image.open(src).convert("RGB")
                im.save(os.path.join(img_dir, name[:-4] + ".webp"), "WEBP", quality=82, method=6)
                os.remove(src)
        except ImportError:
            print("（未安装 Pillow，保留 PNG；如需 WebP 请 pip install pillow）")

    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    empty = report["empty_pages"]
    print(f"✓ 已导出 {limit}/{total} 页 → {pages_dir}")
    print(f"  无文字层 {len(empty)} 页" + (f"：{empty[:12]}{'…' if len(empty) > 12 else ''}" if empty else ""))
    low = report["low_text_pages"]
    print(f"  低文字但有图 {len(low)} 页" + (f"：{low[:12]}{'…' if len(low) > 12 else ''}" if low else ""))
    if rendered:
        print(f"  渲染图片 {rendered} 张 → {img_dir}")
    print(f"  建议分段：{len(report['suggested_segments'])} 段（每段 {seg} 页）→ {os.path.join(out, 'report.json')}")
    if empty:
        print("  ⚠️ 这些页必须看图补写，不要凭空生成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
