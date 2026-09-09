# -*- coding: utf-8 -*-
"""
2025 版题库 单文件 bundle 构建脚本

输入:  database/2025-0809124154_2851/ 下的 总题库.pdf / A|B|C类题库.pdf / 总题库附图标记.pdf
输出:  dist/业余无线电模拟考试系统-2025.html  (单文件应用，零依赖，双击即用)

2025 题库格式 (与 2017 TXT 不同):
  [J]章节  [I]MC#-#### 题号  [P]分类章号  [Q]题干  [T]答案字母(可多选 A-D)
  [A][B][C][D] 四选项
  图片: 总题库附图标记.pdf 中按 LK#### 标注(题号4位后缀)对应
"""
import base64
import json
import re
import sys
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "database" / "2025-0809124154_2851"
DIST = ROOT / "dist"
SRC = ROOT / "src"
OUT = DIST / "业余无线电模拟考试系统-2025.html"
IMG_SCALE = 3.0  # 附图渲染缩放

# 2025 常用默认考试规则: 卷面题数 / 限时(分钟) / 合格答对数
EXAM_RULES = {
    "A": {"count": 30, "minutes": 40, "pass": 24, "total": None},
    "B": {"count": 50, "minutes": 60, "pass": 40, "total": None},
    "C": {"count": 90, "minutes": 100, "pass": 60, "total": None},
}


def page_lines(pdf):
    """逐页取文本，去掉页脚孤立的整数页码行"""
    for pg in pdf.pages:
        t = pg.extract_text() or ""
        lines = [l.rstrip() for l in t.split("\n")]
        nz = [i for i, l in enumerate(lines) if l.strip()]
        if nz and re.fullmatch(r"\d{1,3}", lines[nz[-1]].strip()):
            lines.pop(nz[-1])
        yield lines


def parse_bank(pdf):
    """解析题库 PDF -> {id: {id,q,options,ans}}"""
    items = {}
    cur = None

    def flush():
        nonlocal cur
        if not cur:
            return
        iid = cur["I"]
        q = "".join(cur["Q"]).strip()
        opts = ["".join(cur["o"][k]) for k in "ABCD"]
        t = cur["T"] or ""
        ans = [ord(c) - ord("A") for c in t if c in "ABCD"]
        items[iid] = {"id": iid, "q": q, "options": opts, "ans": ans}

    for lines in page_lines(pdf):
        for ln in lines:
            s = ln.strip()
            m = re.match(r"^\[?([JQTIABCD])\](.*)$", s)
            if m:
                tag, rest = m.group(1), m.group(2)
                if tag == "J" and cur and cur["I"]:
                    flush()
                    cur = None
                if not cur:
                    cur = {"I": None, "Q": [], "T": None, "o": {k: [] for k in "ABCD"}}
                if tag == "J":
                    cur["J"] = rest.strip()
                elif tag == "I":
                    cur["I"] = rest.strip()
                elif tag == "Q":
                    cur["Q"].append(rest)
                elif tag == "T":
                    cur["T"] = rest.strip()
                elif tag in "ABCD":
                    cur["o"][tag].append(rest)
            elif cur:
                if cur["Q"] and not any(cur["o"][k] for k in "ABCD") and not cur["T"]:
                    cur["Q"].append(s)
                else:
                    # 续行归入最后一个非空的选项（倒序，确保 D>C>B>A 优先）
                    for tag in "DCBA":
                        if cur["o"][tag]:
                            cur["o"][tag].append(s)
                            break
    flush()  # 落盘最后一个未被后续 [J] 触发的块
    return items


def extract_images(pdf_path, id_by_suffix):
    """从 附图标记.pdf 按 LK#### 标注裁图，返回 {question_id: png_bytes}"""
    imgs = {}
    doc = pdfium.PdfDocument(str(pdf_path))
    with pdfplumber.open(str(pdf_path)) as pdfpl:
        for pi, page in enumerate(pdfpl.pages):
            words = [w for w in page.extract_words() if re.match(r"^(LK\d+)$", w["text"])]
            if not words:
                continue
            render = doc[pi].render(scale=IMG_SCALE)
            pil = render.to_pil().convert("RGB")
            for w in words:
                label = w["text"]
                key = label[2:]  # 去掉 "LK"
                if key == "060":  # PDF 标注缺损: 0600~0604 序列中缺 0603，060 实为 0603
                    key = "0603"
                qid = id_by_suffix.get(key)
                if not qid:
                    continue
                lx = (w["x0"] + w["x1"]) / 2.0
                lt = w["top"]
                best, bestd = None, 1e9
                for im in page.images:
                    if im["bottom"] <= lt + 22:
                        cx = (im["x0"] + im["x1"]) / 2.0
                        d = abs(cx - lx) + abs(((im["top"] + im["bottom"]) / 2.0) - lt) * 0.2
                        if d < bestd:
                            bestd, best = d, im
                if best is None:
                    continue
                x0 = max(0, int(best["x0"] * IMG_SCALE) - 2)
                y0 = max(0, int(best["top"] * IMG_SCALE) - 2)
                x1 = int(best["x1"] * IMG_SCALE) + 2
                y1 = int(best["bottom"] * IMG_SCALE) + 2
                imgs[qid] = pil.crop((x0, y0, x1, y1))
    doc.close()
    return imgs


def main():
    # 1) 总题库
    with pdfplumber.open(DB / "总题库.pdf") as pdf:
        all_q = parse_bank(pdf)
    print(f"总题库解析: {len(all_q)} 题")
    id_by_suffix = {i.rsplit("-", 1)[1]: i for i in all_q}

    # 2) 各类别归属
    class_ids = {}
    for cls in "ABC":
        with pdfplumber.open(DB / f"{cls}类题库.pdf") as pdf:
            ids = set(parse_bank(pdf))
        missing = ids - all_q.keys()
        if missing:
            sys.exit(f"ERROR: {cls} 类题号不在总题库: {sorted(missing)[:5]}")
        class_ids[cls] = ids
        print(f"{cls} 类题库: {len(ids)} 题")

    for qid, q in all_q.items():
        q["classes"] = [c for c in "ABC" if qid in class_ids[c]]

    # 3) 附图提取并内嵌 base64 (jpeg 控体积)，以题号为键
    import io
    b64 = {}
    for qid, pil_im in extract_images(DB / "总题库附图标记.pdf", id_by_suffix).items():
        buf = io.BytesIO()
        pil_im.convert("RGB").save(buf, "JPEG", quality=88)
        b64[qid] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        all_q[qid]["img"] = qid  # 把对应题的 img 键设为题号
    print(f"图片内嵌: {len(b64)} 张, 共 {sum(len(v) for v in b64.values()) / 1e6:.1f} MB")

    # 4) 校验各题字段完整
    problems = 0
    for qid, q in all_q.items():
        if not q["q"] or any(not o for o in q["options"]) or not q["ans"]:
            print("字段缺失:", qid, repr(q["q"][:20]), q["ans"]); problems += 1
    multi = [qid for qid, q in all_q.items() if len(q["ans"]) > 1]
    print(f"多选题目数: {len(multi)}, 字段缺失: {problems}")

    # 5) 组装数据
    rules = {c: {**r, "total": len(class_ids[c])} for c, r in EXAM_RULES.items()}
    data = {"questions": sorted(all_q.values(), key=lambda x: x["id"]), "rules": rules}

    html = (SRC / "index.html").read_text(encoding="utf-8")
    app_js = (SRC / "app.js").read_text(encoding="utf-8")
    app_css = (SRC / "styles.css").read_text(encoding="utf-8")

    bundle = (
        html.replace("/*__STYLES__*/", app_css)
        .replace("/*__APP_JS__*/", app_js)
        .replace(
            "/*__DATA__*/",
            "const DB_QUESTIONS=" + json.dumps(data["questions"], ensure_ascii=False)
            + ";\nconst DB_RULES=" + json.dumps(data["rules"], ensure_ascii=False)
            + ";\nconst DB_IMAGES=" + json.dumps(b64) + ";",
        )
        # 更新头部版本说明与页脚考试规则
        .replace("题库 v171031 · 1237 题", "题库 2025 · 1375 题")
        .replace(
            "依据中国无线电协会公布的《业余无线电台操作技术能力验证题库》(v171031) 制作 ·\n  A类 30题/40分钟/答对25题合格 · B类 50题/60分钟/答对40题合格 · C类 80题/90分钟/答对60题合格",
            "依据中国无线电协会公布的《业余无线电操作技术能力验证题库》(2025) 制作 ·\n  A类 30题/40分钟/答对24题合格 · B类 50题/60分钟/答对40题合格 · C类 90题/100分钟/答对60题合格",
        )
    )
    assert "/*__" not in bundle, "模板占位符替换不完整"
    assert "(v171031)" not in bundle, "页脚规则未替换"

    DIST.mkdir(exist_ok=True)
    OUT.write_text(bundle, encoding="utf-8")
    print(f"构建完成: {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()