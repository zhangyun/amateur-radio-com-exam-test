/* 本地静态服务器：托管 dist 下的 2025 HTML 供内置浏览器访问(file:// 受限) */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "dist");
const FILE = path.join(ROOT, "业余无线电模拟考试系统-2025.html");
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(FILE));
}).listen(8971, () => console.log("serving 2025 html at http://localhost:8971"));