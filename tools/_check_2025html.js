/* 校验 2025 html 产物: 题量/规则/多选答案/图片/类别 */
"use strict";
const fs = require("fs");
const html = fs.readFileSync("dist/业余无线电模拟考试系统-2025.html", "utf8").replace(/\r\n/g, "\n");
const a = html.indexOf("const DB_QUESTIONS=") + "const DB_QUESTIONS=".length;
const b = html.indexOf(";\nconst DB_RULES=", a);
const c = html.indexOf(";\nconst DB_IMAGES=", b);
const imgStart = c + 2 + "const DB_IMAGES=".length;
const imgEnd = html.indexOf("};\n", imgStart) + 1;
const DB_QUESTIONS = JSON.parse(html.slice(a, b));
const rulesStart = b + 2 + "const DB_RULES=".length;
const DB_RULES = JSON.parse(html.slice(rulesStart, c));
const DB_IMAGES = JSON.parse(html.slice(imgStart, imgEnd));

let fails = 0;
const ok = (c, x) => { if (c) console.log("  ✓ " + x); else { fails++; console.log("  ✗ " + x); } };
ok(DB_QUESTIONS.length === 1375, `题量 ${DB_QUESTIONS.length}`);
ok(DB_RULES.A.count === 30 && DB_RULES.A.pass === 24, `A 规则 ${JSON.stringify(DB_RULES.A)}`);
ok(DB_RULES.B.count === 50 && DB_RULES.B.pass === 40, `B 规则 ${JSON.stringify(DB_RULES.B)}`);
ok(DB_RULES.C.count === 90 && DB_RULES.C.pass === 60, `C 规则 ${JSON.stringify(DB_RULES.C)}`);
ok(DB_RULES.A.total === 683 && DB_RULES.B.total === 1143 && DB_RULES.C.total === 1282, `各类 total ${DB_RULES.A.total}/${DB_RULES.B.total}/${DB_RULES.C.total}`);
ok(Object.keys(DB_IMAGES).length === 53, `图片 ${Object.keys(DB_IMAGES).length}`);

// 多选校验
const multi = DB_QUESTIONS.filter(q => q.ans.length > 1);
ok(multi.length === 252, `多选 ${multi.length}`);
const badAns = multi.filter(q => new Set(q.ans).size !== q.ans.length || q.ans.some(i => i < 0 || i > 3));
ok(badAns.length === 0, `多选答案索引合法(去重/0-3) ${badAns.length}`);
const sample = DB_QUESTIONS.find(q => q.id === "MC2-0001");
ok(sample && sample.ans.join(",") === "0,2" && sample.q.includes("行政法规"), `${sample && sample.id} 答案=${sample && sample.ans} ${sample && sample.q.slice(0, 24)}`);

// 图片挂接
const withImg = DB_QUESTIONS.filter(q => q.img);
ok(withImg.length === 53, `挂接图题 ${withImg.length}`);
const imgMissing = withImg.filter(q => !DB_IMAGES[q.img]);
ok(imgMissing.length === 0, `挂接图都有数据 ${imgMissing.length}`);
const sampleImg = withImg.find(q => q.id === "MC1-0497");
ok(!!sampleImg && DB_IMAGES[sampleImg.img]?.startsWith("data:image/jpeg"), `图题样例 MC1-0497 有图`);

// 类别
const clsCount = c => DB_QUESTIONS.filter(q => q.classes.includes(c)).length;
ok(clsCount("A") === 683 && clsCount("B") === 1143 && clsCount("C") === 1282, `类别计数 ${clsCount("A")}/${clsCount("B")}/${clsCount("C")}`);
const hasAnyCls = DB_QUESTIONS.every(q => q.classes.length >= 1);
ok(hasAnyCls, `每题至少一个类别 ${hasAnyCls}`);

// 选项完整性
const optsOk = DB_QUESTIONS.every(q => q.options.length === 4 && q.options.every(Boolean));
ok(optsOk, `每题4个非空选项 ${optsOk}`);

// 题号唯一
const ids = new Set(DB_QUESTIONS.map(q => q.id));
ok(ids.size === 1375, `题号唯一 ${ids.size}`);

console.log(fails ? `\nFAIL ${fails}` : "\nALL PASS");
process.exit(fails ? 1 : 0);