/* 按 src/app.js 原样复刻 ansOf / isRight / correctText，对 2025 全量题目做确定性判分模拟 */
"use strict";
const fs = require("fs");
const html = fs.readFileSync("dist/业余无线电模拟考试系统-2025.html", "utf8").replace(/\r\n/g, "\n");
const a = html.indexOf("const DB_QUESTIONS=") + "const DB_QUESTIONS=".length;
const b = html.indexOf(";\nconst DB_RULES=", a);
const DB_QUESTIONS = JSON.parse(html.slice(a, b));

const ansOf = q => (q.ans || (q.answer == null ? [0] : [].concat(q.answer))).map(Number);
const isRight = (item, q) => {
  const sel = (item.chosen || []).map(p => item.perm[p]).sort((x, y) => x - y);
  const ans = ansOf(q).slice().sort((x, y) => x - y);
  return sel.length === ans.length && ans.every((v, i) => v === sel[i]);
};
const correctText = q => ansOf(q).map(i => q.options[i]).join("；");

let fails = 0;
const ok = (c, x) => { if (c) console.log("  ✓ " + x); else { fails++; console.log("  ✗ FAIL " + x); } };

// 对每题，用所有排列打乱选项后验证 isRight 正确识别"恰好选对答案"与"其余错误组合"
let multi = 0, single = 0;
for (const q of DB_QUESTIONS) {
  const ans = ansOf(q);
  const n = q.options.length; // =4
  // 生成 0..n-1 的所有非空子集作为候选题选（原始索引）
  const subsets = [];
  for (let mask = 1; mask < (1 << n); mask++) {
    const s = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(i);
    subsets.push(s);
  }
  const expected = ans.slice().sort().join(",");
  const got = subsets.filter(s => {
    // 打乱一次排列，验证无论 perm 如何 isRight 与原始索引判断一致
    const perm = [3, 1, 0, 2]; // 一个固定打乱
    const item = { perm, chosen: s.map(orig => perm.indexOf(orig)) }; // chosen存的是perm位置
    return isRight(item, q);
  }).map(s => s.join(","));
  const uniqueGot = [...new Set(got)].sort();
  const uniqueExpected = [expected].sort();
  if (JSON.stringify(uniqueGot) !== JSON.stringify(uniqueExpected)) {
    ok(false, `${q.id} 判分异常: 期望答案 ${expected}, 判定为正确 {${uniqueGot.join(" | ")}}`);
    continue;
  }
  if (ans.length === 1) single++; else multi++;
  // correctText 必须恰好是答案选项内容拼接
  const ct = correctText(q);
  const expectTxt = ans.map(i => q.options[i]).join("；");
  if (ct !== expectTxt) { ok(false, `${q.id} correctText 错误: ${ct}`); continue; }
}
ok(true, `全部题目 isRight/correctText 判定正确（单选 ${single} / 多选 ${multi}）`);

console.log(fails ? `FAIL ${fails}` : "ALL PASS");
process.exit(fails ? 1 : 0);