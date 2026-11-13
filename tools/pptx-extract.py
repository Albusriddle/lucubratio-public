#!/usr/bin/env python3
"""PPTX 课件 → 逐页 Markdown（+ 内嵌图片导出）

为什么需要：`tools/pdf-extract.py` 只吃 PDF；本课程课件是 7 个 .pptx（793 页），
而"每页文字 + 图页清单"是双盲生成流程的输入，所以补一个等价的 PPTX 版本。

产出（与 pdf-extract.py 同构，便于同一套流程复用）：

    <out>/pages/<deck>-pNNN.md     每页文本（含表格、备注）+ 图片引用
    <out>/img/<deck>/sNNN-k.webp   该页内嵌图片（PNG/JPEG 会转 WebP）
    <out>/report.json              slides / no_text_pages / low_text_pages / suggested_segments

用法：
    python tools/pptx-extract.py 课件.pptx --deck ch3 --out .work/net
    python tools/pptx-extract.py 课件.pptx --deck ch3 --out .work/net --low-text 120 --segment 40

判读规则（与 PDF 版一致）：
  · no_text_pages  ：整页几乎没有文字层（纯图/照片）→ 必须看图后据图写
  · low_text_pages ：文字很少但含图 → 同样要据图核对，不能只读文字
"""
import argparse
import io
import json
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
except ImportError:
    print("✗ 缺少 python-pptx：pip install python-pptx", file=sys.stderr)
    sys.exit(2)

try:
    from PIL import Image
except ImportError:
    Image = None


def iter_text(shape, lines):
    """递归收集形状里的文字（含组合、表格）。"""
    if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
        for sub in shape.shapes:
            iter_text(sub, lines)
        return
    if getattr(shape, "has_table", False) and shape.has_table:
        tbl = shape.table
        for row in tbl.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            if any(cells):
                lines.append("| " + " | ".join(cells) + " |")
        return
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            t = "".join(run.text for run in para.runs).strip()
            if t:
                lines.append(t)


def iter_images(shape, out_dir, deck, page_no, saved):
    if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
        for sub in shape.shapes:
            iter_images(sub, out_dir, deck, page_no, saved)
        return
    if shape.shape_type != MSO_SHAPE_TYPE.PICTURE:
        return
    try:
        blob = shape.image.blob
        ext = (shape.image.ext or "png").lower()
    except Exception:
        return
    k = len(saved) + 1
    name = f"s{page_no:03d}-{k}.webp"
    target = out_dir / name
    try:
        if Image is not None and ext in ("png", "jpg", "jpeg", "bmp", "gif"):
            im = Image.open(io.BytesIO(blob)).convert("RGB")
            if max(im.size) > 1200:
                im.thumbnail((1200, 1200))
            im.save(target, "WEBP", quality=82, method=4)
        else:
            target = out_dir / f"s{page_no:03d}-{k}.{ext}"
            target.write_bytes(blob)
    except Exception:
        return
    saved.append(f"img/{deck}/{target.name}")


def main():
    ap = argparse.ArgumentParser(description="PPTX 课件 → 逐页 Markdown")
    ap.add_argument("pptx", help="课件 .pptx 路径")
    ap.add_argument("--deck", required=True, help="课件标识（如 ch3），用于文件名与图片目录")
    ap.add_argument("--out", required=True, help="输出目录（如 .work/net）")
    ap.add_argument("--low-text", type=int, default=120, help="低于该字数且含图 → 视为低文字页（默认 120）")
    ap.add_argument("--segment", type=int, default=40, help="建议分段长度（默认 40 页/段）")
    ap.add_argument("--no-images", action="store_true", help="不导出内嵌图片")
    args = ap.parse_args()

    src = Path(args.pptx)
    if not src.exists():
        print(f"✗ 文件不存在：{src}", file=sys.stderr)
        sys.exit(2)

    out = Path(args.out)
    pages_dir = out / "pages"
    img_dir = out / "img" / args.deck
    pages_dir.mkdir(parents=True, exist_ok=True)
    if not args.no_images:
        img_dir.mkdir(parents=True, exist_ok=True)

    prs = Presentation(src)
    report = {
        "deck": args.deck,
        "pptx": str(src),
        "slides": len(prs.slides),
        "no_text_pages": [],
        "low_text_pages": [],
        "suggested_segments": [],
    }

    for idx, slide in enumerate(prs.slides, start=1):
        lines, imgs = [], []
        for sh in slide.shapes:
            iter_text(sh, lines)
            if not args.no_images:
                iter_images(sh, img_dir, args.deck, idx, imgs)
        # 备注页
        if slide.has_notes_slide:
            note = (slide.notes_slide.notes_text_frame.text or "").strip()
            if note:
                lines.append("")
                lines.append("> 备注：" + note.replace("\n", " "))

        text = "\n".join(lines).strip()
        body = [f"## p{idx}\n"]
        if text:
            body.append(text + "\n")
        for im in imgs:
            body.append(f"![]({im})\n")
        n_chars = len(text)
        if n_chars < 15:
            report["no_text_pages"].append(idx)
            body.append("（本页无文字层：纯图。请打开页面图后据图补写，不要臆造。）\n")
        elif n_chars < args.low_text and imgs:
            report["low_text_pages"].append(idx)
            body.append("（本页文字很少，关键信息可能在图里：请对照图片核对后再写。）\n")

        (pages_dir / f"{args.deck}-p{idx:03d}.md").write_text("".join(body), encoding="utf-8")

    total = report["slides"]
    step = args.segment
    report["suggested_segments"] = [
        {"from": s, "to": min(s + step - 1, total)} for s in range(1, total + 1, step)
    ]

    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ {src.name} → {pages_dir}（{total} 页）")
    print(f"  无文字页 {len(report['no_text_pages'])} / 低文字页 {len(report['low_text_pages'])}"
          f" / 建议分段 {len(report['suggested_segments'])} 段")
    if report["no_text_pages"]:
        print(f"  无文字页: {report['no_text_pages'][:12]}")
    if report["low_text_pages"]:
        print(f"  低文字页: {report['low_text_pages'][:12]}")


if __name__ == "__main__":
    main()
