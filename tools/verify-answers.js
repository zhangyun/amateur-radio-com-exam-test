/* verify-answers.js —— "确保所有答题都是准确的" 全量数据层校验
 *
 * 不调用任何浏览器、无需外部依赖（内置 TextDecoder('gbk') 解码官方 GBK 题库）。
 * 对内置应用中的每一道题，与官方题库源文件逐一比对：
 *   题干、四个选项（正确答案恒为原 [A] = options[0]）、附图、类别归属、考试规则。
 *
 * 运行: node tools/verify-answers.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DB_DIR = path.join(ROOT, "database", "2017-1031 题库电子版(v171031)");
const IMG_DIR = path.join(DB_DIR, "总题库附图(v140331)");
const DIST_HTML = path.join(ROOT, "dist", "业余无线电模拟考试系统.html");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ✓ " + msg); else { failures++; console.log("  ✗ FAIL: " + msg); } };
/* 与 build.py 的 Python str.strip() 对齐：去除首尾空白 */
const strip = s => s.replace(/^\s+|\s+$/g, "");

function readGbk(rel) { return new TextDecoder("gbk").decode(fs.readFileSync(path.join(DB_DIR, rel))); }

/* 独立复刻官方 TXT 题库块解析：[I]id [Q]题干 [A][B][C][D] 选项 [P]附图
 * 逐行解析，避免正则把 [P] 行卷进 [D] 选项 */
function parseBank(text) {
  const qs = new Map();
  for (const chunk of text.split(/(?=\[I\])/)) {
    if (!chunk.startsWith("[I]")) continue;
    const lines = chunk.replace(/\r\n/g, "\n").split("\n");
    const idM = /\[I\](\w+)/.exec(lines[0]);
    if (!idM) continue;
    const id = idM[1];
    const f = { q: "", a: "", b: "", c: "", d: "", p: null };
    let cur = null;
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i];
      const m = /^\[([IQABCDP])\]\s?/.exec(ln);
      if (m) { cur = m[1].toLowerCase(); if (cur !== "p") f[cur] = ln.slice(m[0].length); }
      else if (cur && cur !== "p") f[cur] += "\n" + ln;
    }
    if (qs.has(id)) throw new Error("重复题号 " + id);
    qs.set(id, {
      id,
      q: strip(f.q),
      options: [strip(f.a), strip(f.b), strip(f.c), strip(f.d)],
      img: /^(\S+\.jpg)\s*$/.test(f.p) ? f.p.trim() : null,
    });
  }
  return qs;
}

/* 从 dist HTML 中提取内嵌的 DB_QUESTIONS / DB_RULES / DB_IMAGES（UTF-8）*/
/* 用括号配对扫描，避免题干/选项中的字符被误判为 JSON 结束 */
function extractEmbedded() {
  const html = fs.readFileSync(DIST_HTML, "utf-8");
  const read = name => {
    const startIdx = html.indexOf("const " + name + "=");
    if (startIdx < 0) throw new Error("HTML 中找不到 " + name);
    const i = html.indexOf("=", startIdx) + 1;
    const open = html[i];
    const close = open === "[" ? "]" : "}";
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === "\"") inStr = false;
        continue;
      }
      if (c === "\"") { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close && depth >= 0) { depth--; if (depth === 0) return JSON.parse(html.slice(i, j + 1)); }
    }
    throw new Error("无法在 HTML 中配对 " + name + " 的括号");
  };
  return { questions: read("DB_QUESTIONS"), rules: read("DB_RULES"), images: read("DB_IMAGES") };
}

function main() {
  console.log("=== 数据层全量校验：每个答案都与官方题库一致 ===\n");

  // 1) 解析官方题库
  console.log("· 解析官方题库（GBK）");
  const bank = parseBank(readGbk("总题库文件(v171031).txt"));
  console.log("  总题库: " + bank.size + " 题");

  const classSets = {};
  for (const cls of ["A", "B", "C"]) {
    const f = fs.readdirSync(DB_DIR).find(n => n.startsWith(cls + "_分类题库"));
    classSets[cls] = new Set(parseBank(readGbk(f)).keys());
  }
  // 试卷涉及题号文件与分类题库一致性
  for (const cls of ["A", "B", "C"]) {
    const f = fs.readdirSync(DB_DIR).find(n => n.startsWith(cls + "_试卷涉及题号"));
    const listed = new Set(readGbk(f).match(/LK\d+/g) || []);
    const diff = new Set([...listed].filter(x => !classSets[cls].has(x)).concat([...classSets[cls]].filter(x => !listed.has(x))));
    ok(diff.size === 0, `${cls} 卷题号文件与分类题库一致（${listed.size} 题）`);
  }
  ok(bank.size === 1237, `总题库题数为 1237（实际 ${bank.size}）`);
  for (const cls of ["A","B","C"]) {
    const exp = { A: 361, B: 685, C: 1061 }[cls];
    if (classSets[cls].size !== exp) ok(false, `${cls} 类题数应为 ${exp}（实际 ${classSets[cls].size}）`);
  }

  // 2) 提取内嵌数据
  console.log("\n· 提取内嵌数据");
  const embedded = extractEmbedded();
  const embMap = new Map(embedded.questions.map(q => [q.id, q]));
  ok(embedded.questions.length === 1237, `内嵌 DB_QUESTIONS 为 1237 题（实际 ${embedded.questions.length}）`);
  ok(new Set(embedded.questions.map(q => q.id)).size === 1237, "内嵌题号无重复");

  // 3) 补图规则（与 build.py 一致：LK<id>.jpg 存在且官方未声明 [P] → 补上关联）
  const jpgs = new Set(fs.readdirSync(IMG_DIR).filter(n => n.endsWith(".jpg")));
  const expectedImg = id => {
    const q = bank.get(id);
    if (q.img) return q.img;
    return jpgs.has(id + ".jpg") ? id + ".jpg" : null;
  };

  // 4) 逐题全量比对
  console.log("\n· 逐题全量比对（题干 / 四选项 / 正确答案 / 附图）");
  const norm = s => s.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
  let checked = 0;
  for (const id of bank.keys()) {
    const src = bank.get(id);
    const app = embMap.get(id);
    const ctx = id + "：";
    if (!app) { ok(false, ctx + "内嵌数据缺失该题"); continue; }
    let bad = 0;
    const cell = (c) => { if (!c) bad++; };
    cell(norm(app.q) === norm(src.q));                   // 题干
    cell(app.options.length === 4);                      // 选项数量
    cell(norm(app.options[0]) === norm(src.options[0])); // 正确答案（原 [A]）
    cell(norm(app.options[1]) === norm(src.options[1]));
    cell(norm(app.options[2]) === norm(src.options[2]));
    cell(norm(app.options[3]) === norm(src.options[3]));
    cell(app.img === expectedImg(id));                   // 附图关联
    const appCls = (app.classes || []).slice().sort().join("");
    const srcCls = ["A","B","C"].filter(c => classSets[c].has(id)).join("");
    cell(appCls === srcCls && app.classes.length === srcCls.length); // 类别归属
    if (bad === 0) checked++;
    else ok(false, `${ctx}${bad} 处不一致`);
    // 引用图必须真实内嵌
    if (app.img && !embedded.images[app.img]) ok(false, `${ctx}引用图 ${app.img} 未内嵌`);
  }
  const allMatch = checked === bank.size;
  ok(allMatch, `全部 ${bank.size} 题逐字段一致（领域/选项/答案/附图/类别）`);

  // 5) 考试规则
  console.log("\n· 考试规则");
  const rules = embedded.rules;
  for (const cls of ["A","B","C"]) {
    const r = rules[cls];
    const exp = { A: [30,40,25,361], B: [50,60,40,685], C: [80,90,60,1061] }[cls];
    ok(r && r.count === exp[0] && r.minutes === exp[1] && r.pass === exp[2] && r.total === exp[3],
      `${cls} 类规则 count=${r && r.count}/min=${r && r.minutes}/pass=${r && r.pass}/total=${r && r.total}（应为 count=${exp[0]}/min=${exp[1]}/pass=${exp[2]}/total=${exp[3]}）`);
  }

  // 6) 汇总
  console.log("\n=== 结论 ===");
  if (failures === 0) {
    console.log(`全部通过 ✅  ${bank.size} 题的答案与官方题库完全一致。`);
    process.exit(0);
  } else {
    console.log(`${failures} 项失败 ❌`);
    process.exit(1);
  }
}

try { main(); } catch (e) { console.error("测试崩溃:", e); process.exit(1); }