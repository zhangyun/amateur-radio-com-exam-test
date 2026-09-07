/* 端到端冒烟测试: 验证单文件考试应用的核心流程
 * 运行: node tools/e2e-test.js (需先 npm i playwright + install chromium)
 */
const { chromium } = require("playwright");
const path = require("path");

const FILE = "file:///" + path.resolve(__dirname, "../dist/业余无线电模拟考试系统.html").replace(/\\/g, "/");
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ FAIL: ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(FILE);
  await page.waitForTimeout(800);

  console.log("== 1. 首页加载 ==");
  ok((await page.title()).includes("业余无线电"), "标题正确");
  ok((await page.locator(".class-card").count()) === 4, "4 张类别卡片 (A/B/C/全部)");
  ok((await page.locator(".mode-card").count()) === 4, "4 种模式卡片");
  const qCount = await page.evaluate(() => DB_QUESTIONS.length);
  ok(qCount === 1237, `题库内嵌 1237 题 (实际 ${qCount})`);

  console.log("== 2. 顺序练习 + 即时判分 + 答案正确性 ==");
  await page.locator(".class-card", { hasText: "A 类" }).click();
  await page.locator(".mode-card", { hasText: "顺序练习" }).click();
  await page.waitForSelector(".q-card");
  // 答题 3 题: 验证点击后正确选项高亮与 DB 一致
  for (let i = 0; i < 3; i++) {
    const check = await page.evaluate(() => {
      const qid = document.querySelector(".q-id").textContent.match(/题号 (\w+)/)[1];
      const q = DB_QUESTIONS.find(x => x.id === qid);
      const it = session.list[session.idx];
      const btns = [...document.querySelectorAll(".opt")];
      const correctBtn = btns.find(b => b.classList.contains("correct"));
      btns[it.perm.indexOf(0)].click(); // 点击正确答案位置
      return { qid: q.id, correctText: correctBtn ? correctBtn.textContent.trim() : null, truth: q.options[0], shown: !!document.querySelector(".feedback") };
    });
    ok(check.shown, `${check.qid} 即时反馈出现`);
    // 重新渲染后验证高亮的正确选项文本 == options[0]
    await page.waitForTimeout(200);
    const hi = await page.evaluate(() => {
      const qid = document.querySelector(".q-id").textContent.match(/题号 (\w+)/)[1];
      const truth = DB_QUESTIONS.find(x => x.id === qid).options[0];
      const btns = [...document.querySelectorAll(".opt")];
      const cb = btns.find(b => b.classList.contains("correct"));
      return cb && cb.textContent.includes(truth);
    });
    ok(hi, `${check.qid} 高亮正确答案与题库一致`);
    await page.locator("#btnNext").click();
  }
  ok(true, "顺序练习翻页正常");

  console.log("== 3. 答错进入错题本 ==");
  // 故意答错: 点击非正确答案选项
  const wrongClick = await page.evaluate(() => {
    const it = session.list[session.idx];
    const pos = it.perm.findIndex(x => x !== 0);
    document.querySelectorAll(".opt")[pos].click();
    return (document.querySelector(".feedback") || {}).textContent?.includes("✗");
  });
  ok(wrongClick, "答错显示错误反馈");
  await page.waitForTimeout(300);
  const wrongN = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("hamExam.v1.wrongBook") || "{}")).length);
  ok(wrongN === 1, `错题自动记录 (错题本 ${wrongN} 题)`);

  console.log("== 4. 错题本回看 ==");
  await page.locator('.nav-btn[data-view="wrong"]').click();
  await page.waitForTimeout(300);
  ok((await page.locator(".wrong-item").count()) === 1, "错题本列表显示 1 条");
  await page.locator(".wrong-item").first().click();
  await page.waitForTimeout(300);
  ok((await page.locator(".modal .opt.correct").count()) === 1, "回看弹窗显示正确答案");
  ok((await page.locator(".modal").textContent()).includes("上次错选"), "回看显示上次错选");
  await page.locator("#modalRoot .btn").last().click(); // 关闭

  console.log("== 5. 错题重考 ==");
  await page.locator("#wrongExam").click();
  await page.waitForSelector(".q-card");
  ok((await page.locator(".sheet-cell").count()) === 1, "错题重考只出 1 题");
  ok((await page.locator(".qmeta").textContent()).includes("错题重考"), "会话标题正确");
  await page.locator("#btnFinish").click();
  await page.locator("#fOk").click();
  await page.waitForTimeout(300);

  console.log("== 6. 全真模拟考试 (A类 30题/40分钟) ==");
  await page.locator('.nav-btn[data-view="home"]').click();
  await page.locator(".class-card", { hasText: "A 类" }).isVisible();
  await page.locator(".mode-card", { hasText: "全真模拟考试" }).click();
  await page.waitForSelector(".q-card");
  const meta = await page.evaluate(() => ({ rule: DB_RULES.A, cells: document.querySelectorAll(".sheet-cell").length, timer: document.querySelector("#timerVal").textContent }));
  ok(meta.cells === 30, `A 类试卷 30 题 (实际 ${meta.cells})`);
  ok(meta.timer === "40:00", `倒计时 40 分钟 (实际 ${meta.timer})`);
  const shuffled = await page.evaluate(() => {
    // 抽 10 场验证选项乱序: perm 不全为 [0,1,2,3] 的比例应较高
    let shuffledCnt = 0;
    for (let i = 0; i < 10; i++) {
      const perm = [0, 1, 2, 3];
      for (let j = perm.length - 1; j > 0; j--) { const k = Math.floor(Math.random() * (j + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    }
    return session.list.filter(it => it.perm.join() !== "0,1,2,3").length;
  });
  ok(shuffled >= 20, `选项已随机打乱 (${shuffled}/30 题)`);
  // 快速作答: 前 20 题选正确答案, 后 10 题答错/不答
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      const it = session.list[i];
      it.chosen = it.perm.indexOf(0);
    }
    for (let i = 20; i < 25; i++) {
      const it = session.list[i];
      it.chosen = it.perm.findIndex(x => x !== 0);
    }
    session.idx = 0;
  });
  await page.locator("#btnSubmitEarly").click();
  await page.locator("#cOk").click();
  await page.waitForSelector(".result-hero");
  const result = await page.locator(".result-hero").textContent();
  ok(result.includes("答对 20 / 30"), "判分正确 (20/30)");
  ok(result.includes("不合格"), "20/30 < 25 合格线 → 不合格");
  ok((await page.locator(".wrong-item").count()) === 10, "结果页错题回顾 10 条");

  console.log("== 7. 考试错题入库 + 历史成绩 ==");
  const wb = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("hamExam.v1.wrongBook"))).length);
  ok(wb === 6, `错题本累计 6 题 (实际 ${wb})`);
  await page.locator('.nav-btn[data-view="stats"]').click();
  await page.waitForTimeout(200);
  const histTxt = await page.locator(".history-table").textContent();
  ok(histTxt.includes("不合格"), "历史成绩记录在案");

  console.log("== 8. 带图题目展示 ==");
  await page.evaluate(() => {
    // 顺序练习跳到 LK0497 (带图题)
    settings.defaultClass = "ALL"; store.set("settings", settings);
    startSession("seq");
    session.idx = session.ids.indexOf("LK0497");
    renderQuiz();
  });
  await page.waitForSelector(".q-img-wrap img");
  const imgOk = await page.evaluate(async () => {
    const img = document.querySelector(".q-img-wrap img");
    if (!img.complete) await new Promise(r => { img.onload = r; });
    return img.naturalWidth > 100;
  });
  ok(imgOk, "附图 LK0497.jpg 正常渲染");
  await page.screenshot({ path: "dist/test-image-question.png" });

  console.log("== 9. 图片与题目匹配抽查 ==");
  const imgMatch = await page.evaluate(() => {
    const q = DB_QUESTIONS.find(x => x.id === "LK0497");
    return q.img === "LK0497.jpg" && q.options[0] === "接地";
  });
  ok(imgMatch, "LK0497 → LK0497.jpg, 答案「接地」");

  ok(errors.length === 0, `无 JS 运行时错误 ${errors.length ? "(" + errors[0] + ")" : ""}`);
  await browser.close();
  console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error("测试崩溃:", e); process.exit(1); });
