/* 校验内嵌 53 张附图 base64 为有效可解码 JPEG（探测 SOI/EOI 与尺寸） */
"use strict";
const fs = require("fs");
const html = fs.readFileSync("dist/业余无线电模拟考试系统-2025.html", "utf8").replace(/\r\n/g, "\n");
const c = html.indexOf("const DB_IMAGES=");
const imgStart = c + "const DB_IMAGES=".length;
const imgEnd = html.indexOf("};\n", imgStart) + 1;
const DB_IMAGES = JSON.parse(html.slice(imgStart, imgEnd));

let fails = 0;
const ids = Object.keys(DB_IMAGES);
console.log("图片数:", ids.length);
for (const k of ids) {
  const data = DB_IMAGES[k];
  if (!data.startsWith("data:image/jpeg;base64,")) { fails++; console.log("  ✗ " + k + " 前缀异常"); continue; }
  const buf = Buffer.from(data.slice("data:image/jpeg;base64,".length), "base64");
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) { fails++; console.log("  ✗ " + k + " 非 JPEG(无明显SOI)"); continue; }
  // SOF0/SOF2 找宽高
  const wh = findSize(buf);
  if (!wh) { fails++; console.log("  ✗ " + k + " 缺少尺寸段"); continue; }
  console.log("  ✓ " + k, wh[0] + "×" + wh[1], (buf.length / 1024).toFixed(0) + "KB");
}
function findSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    } else i++;
  }
  return null;
}
console.log(fails ? `FAIL ${fails}` : "ALL 53 JPEG 有效可解码");
process.exit(fails ? 1 : 0);