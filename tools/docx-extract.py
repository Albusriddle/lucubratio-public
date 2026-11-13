#!/usr/bin/env python3
"""DOCX 实验指导书 → 逐节 Markdown（+ 内嵌图片导出）

为什么需要：`pdf-extract.py` / `pptx-extract.py` 都吃不了 Word 文档，
而本课程的实验指导书与实验讲义是 `.docx`（另有 `.doc` 需先用 Word 另存为 docx）。

产出（与另两个抽取器同构）：

    <out>/pages/<deck>-pNNN.md     每个「标题 + 其下正文」一段
    <out>/img/<deck>/sNNN-k.webp   文档内嵌图片
    <out>/report.json              段落数 / 低文字段 / 建议分段

用法：
    python tools/docx-extract.py 指导书.docx --deck lab1 --out .work/net/lab1
    python tools/docx-extract.py 指导书.docx --deck lab1 --out .work/net/lab1 --low-text 80
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
    import docx
except ImportError:
    print("✗ 缺少 python-docx：pip install python-docx", file=sys.stderr)
    sys.exit(2)

try:
    from PIL import Image
except ImportError:
    Image = None


def main():
    ap = argparse.ArgumentParser(description="DOCX → 逐节 Markdown")
    ap.add_argument("docx", help="文档 .docx 路径")
    ap.add_argument("--deck", required=True, help="标识（如 lab1），用于文件名与图片目录")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--low-text", type=int, default=80, help="低于该字数视为低文字段（默认 80）")
    args = ap.parse_args()

    src = Path(args.docx)
    if not src.exists():
        print(f"✗ 文件不存在：{src}", file=sys.stderr)
        sys.exit(2)

    out = Path(args.out)
    pages_dir = out / "pages"
    img_dir = out / "img" / args.deck
    pages_dir.mkdir(parents=True, exist_ok=True)
    img_dir.mkdir(parents=True, exist_ok=True)

    doc = docx.Document(str(src))
    report = {"deck": args.deck, "docx": str(src), "sections": 0, "low_text": []}

    # 按「标题段」切分：Heading/Title 起新段，其余段落归到当前段
    sections = []
    cur = {"title": "（文首）", "lines": [], "imgs": []}
    for para in doc.paragraphs:
        text = (para.text or "").strip()
        style = (para.style.name or "") if para.style is not None else ""
        if style.startswith("Heading") or style == "Title":
            if cur["lines"] or cur["imgs"]:
                sections.append(cur)
            cur = {"title": text or "（无标题）", "lines": [], "imgs": []}
            if text:
                cur["lines"].append(text)
        elif text:
            cur["lines"].append(text)
    sections.append(cur)

    # 图片按出现顺序编号（python-docx 不提供图片锚点位置，只能整篇导出）
    n_img = 0
    for rel in doc.part.rels.values():
        if "image" not in rel.reltype:
            continue
        try:
            blob = rel.target_part.blob
        except Exception:
            continue
        n_img += 1
        name = f"s{n_img:03d}.webp"
        try:
            if Image is not None:
                im = Image.open(io.BytesIO(blob)).convert("RGB")
                if max(im.size) > 1200:
                    im.thumbnail((1200, 1200))
                im.save(img_dir / name, "WEBP", quality=82, method=4)
            else:
                (img_dir / f"s{n_img:03d}.png").write_bytes(blob)
        except Exception:
            continue

    for i, sec in enumerate(sections, start=1):
        body = [f"## p{i} {sec['title']}\n"]
        if sec["lines"]:
            body.append("\n".join(sec["lines"]) + "\n")
        if n_img and i == 1:
            body.append(f"（本文档内嵌 {n_img} 张图，已导出到 img/{args.deck}/；python-docx 不给图片位置，"
                        f"写页面时按上下文判断用哪张，判断不了就写「图见原文档」。）\n")
        chars = sum(len(x) for x in sec["lines"])
        if chars < args.low_text:
            report["low_text"].append(i)
        (pages_dir / f"{args.deck}-p{i:03d}.md").write_text("".join(body), encoding="utf-8")

    report["sections"] = len(sections)
    report["images"] = n_img
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ {src.name} → {pages_dir}（{len(sections)} 段 / {n_img} 张图）")
    if report["low_text"]:
        print(f"  低文字段: {report['low_text'][:12]}")


if __name__ == "__main__":
    main()
