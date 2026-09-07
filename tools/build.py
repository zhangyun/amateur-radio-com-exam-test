# -*- coding: utf-8 -*-
"""
业余无线电操作技术能力验证考试 - 题库解析与单文件 bundle 构建脚本

输入:  database/2017-1031 题库电子版(v171031)/ 下的总题库 txt、分类题库 txt、附图 jpg
输出:  dist/业余无线电模拟考试系统.html  (单文件应用，零依赖，双击即用)

题库格式约定 (CRAC 官方 TXT 题库包):
  [I]题号  [Q]题干  [A][B][C][D] 四个选项  [P]图片文件名(仅有图题)
  正确答案恒为 [A] 选项的内容(选项在应用内展示时才打乱)。
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "database" / "2017-1031 题库电子版(v171031)"
IMG_DIR = DB / "总题库附图(v140331)"
DIST = ROOT / "dist"
SRC = ROOT / "src"

# 真实考试规则 (国无协〔2018〕13号): 卷面题数 / 限时(分钟) / 合格答对数
EXAM_RULES = {
    "A": {"count": 30, "minutes": 40, "pass": 25, "total": None},
    "B": {"count": 50, "minutes": 60, "pass": 40, "total": None},
    "C": {"count": 80, "minutes": 90, "pass": 60, "total": None},
}


def read_gbk(p: Path) -> str:
    return p.read_bytes().decode("gbk")


BLOCK_RE = re.compile(
    r"\[I\](?P<id>\w+)\s*\r?\n\[Q\](?P<q>.*?)\r?\n\[A\](?P<a>.*?)\r?\n"
    r"\[B\](?P<b>.*?)\r?\n\[C\](?P<c>.*?)\r?\n\[D\](?P<d>.*?)"
    r"(?:\r?\n\[P\](?P<p>\S+\.jpg))?\s*$",
    re.S,
)


def parse_bank(text: str) -> dict:
    """解析题库文本 -> {id: question dict}"""
    qs = {}
    for chunk in re.split(r"(?=\[I\])", text):
        if not chunk.startswith("[I]"):
            continue
        m = BLOCK_RE.match(chunk)
        if not m:
            sys.exit(f"ERROR: 无法解析题目块: {chunk[:150]!r}")
        g = m.groupdict()
        qid = g["id"].strip()
        if qid in qs:
            sys.exit(f"ERROR: 重复题号 {qid}")
        qs[qid] = {
            "id": qid,
            "q": g["q"].strip(),
            "options": [g["a"].strip(), g["b"].strip(), g["c"].strip(), g["d"].strip()],
            "answer": 0,  # 恒为第一个选项(原 [A])
            "img": g["p"].strip() if g["p"] else None,
        }
    return qs


def main():
    # 1) 总题库
    all_q = parse_bank(read_gbk(DB / "总题库文件(v171031).txt"))
    print(f"总题库解析: {len(all_q)} 题")

    # 2) 各类别归属 (以分类题库文件中出现的题号为准)
    class_ids = {}
    for cls in "ABC":
        f = next(DB.glob(f"{cls}_分类题库*.txt"))
        ids = set(parse_bank(read_gbk(f)).keys())
        missing = ids - all_q.keys()
        if missing:
            sys.exit(f"ERROR: {cls} 类题号不在总题库: {sorted(missing)[:5]}")
        class_ids[cls] = ids
        print(f"{cls} 类题库: {len(ids)} 题")

    # 3) 校验各卷"试卷涉及题号"文件与分类题库一致
    for cls in "ABC":
        f = next(DB.glob(f"{cls}_试卷涉及题号*.txt"))
        listed = set(re.findall(r"LK\d+", read_gbk(f)))
        diff = listed ^ class_ids[cls]
        if diff:
            print(f"WARN: {cls} 卷题号文件与分类题库不一致: {sorted(diff)[:10]}")
        else:
            print(f"{cls} 卷题号文件校验一致 ({len(listed)} 题)")

    # 4) 类别归属写入题目 (C 包含 A∪B 全部, 数据按最小集存储)
    for qid, q in all_q.items():
        q["classes"] = [c for c in "ABC" if qid in class_ids[c]]

    # 5) 补充漏标的附图: LK0938.jpg 存在且与题号匹配, 但题库 [P] 缺失
    extra_fixed = 0
    for jpg in IMG_DIR.glob("*.jpg"):
        qid = jpg.stem
        if qid in all_q and all_q[qid]["img"] is None:
            all_q[qid]["img"] = jpg.name
            extra_fixed += 1
            print(f"补图: {qid} <- {jpg.name}")

    # 6) 图片完整性校验: 每个被引用的图都必须存在, 文件名必须等于题号.jpg
    referenced = {q["img"] for q in all_q.values() if q["img"]}
    on_disk = {p.name for p in IMG_DIR.glob("*.jpg")}
    missing = referenced - on_disk
    if missing:
        sys.exit(f"ERROR: 缺失图片文件: {sorted(missing)}")
    mismatch = [n for n in referenced if n.rsplit(".", 1)[0] not in all_q]
    if mismatch:
        sys.exit(f"ERROR: 图片名与题号不匹配: {mismatch}")
    print(f"图片校验: {len(referenced)} 张被引用, 全部存在且题号匹配")

    # 7) 选项合法性校验 (空选项/重复选项; 官方题库 LK0672 的 B/D 文字重复, 属原始题库笔误, 不影响正确答案 A)
    for q in all_q.values():
        if any(not o for o in q["options"]):
            sys.exit(f"ERROR: {q['id']} 存在空选项")
        if len(set(q["options"])) != 4:
            print(f"WARN: {q['id']} 存在重复选项(原始题库笔误), 正确答案仍为原 [A]")
    print("选项校验: 全部通过")

    # 8) 图片 base64 内嵌
    imgs = {}
    for name in sorted(referenced):
        b = (IMG_DIR / name).read_bytes()
        imgs[name] = "data:image/jpeg;base64," + base64.b64encode(b).decode()
    print(f"图片内嵌: {len(imgs)} 张, 共 {sum(len(v) for v in imgs.values()) / 1e6:.1f} MB")

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
            + ";\nconst DB_IMAGES=" + json.dumps(imgs) + ";",
        )
    )
    assert "/*__" not in bundle, "模板占位符替换不完整"

    DIST.mkdir(exist_ok=True)
    out = DIST / "业余无线电模拟考试系统.html"
    out.write_text(bundle, encoding="utf-8")
    print(f"构建完成: {out} ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
