/* 业余无线电操作证书模拟考试系统 —— 前端应用
 * 数据由构建脚本注入: DB_QUESTIONS / DB_RULES / DB_IMAGES
 * 持久化: localStorage (错题本/进度/历史/设置/未交卷会话)
 */
"use strict";

/* ================= 基础数据 ================= */
const QMAP = Object.fromEntries(DB_QUESTIONS.map(q => [q.id, q]));
const IDS = DB_QUESTIONS.map(q => q.id);
const CLASS_META = {
  A: { name: "A 类操作证书", desc: "30–3000MHz，功率≤25W。新手首考类别。", icon: "🛰" },
  B: { name: "B 类操作证书", desc: "各业余频段，30MHz以下≤15W、以上≤25W。", icon: "📡" },
  C: { name: "C 类操作证书", desc: "各业余频段，30MHz以下功率可达1000W。", icon: "tower" },
};
const LS_PREFIX = "hamExam.v1.";

/* ================= 持久化 ================= */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(LS_PREFIX + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch {} },
};

let progress  = store.get("progress", {});   // {qid:{seen,right,wrong,ts}}
let wrongBook = store.get("wrongBook", {});  // {qid:{count,streak,lastChosen,ts}}
let history   = store.get("history", []);    // [{ts,mode,cls,correct,total,seconds,pass}]
let settings  = Object.assign(
  { shuffleOptions: true, instantFeedback: true, autoRemoveWrong: true, defaultClass: "A" },
  store.get("settings", {})
);
const saveAll = () => { store.set("progress", progress); store.set("wrongBook", wrongBook); store.set("history", history); store.set("settings", settings); };

/* ================= 会话 ================= */
let session = null; // {mode, cls, list, idx, startedAt, limitSec, remaining, timer, submitted, title}
let ui = { view: "home" };

/* ================= 工具 ================= */
const $ = sel => document.querySelector(sel);
const main = () => $("#main");
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const classOf = q => q.classes.join("/");
function toast(msg, ms = 1800) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.add("hidden"), ms);
}
function modal(html, onMount) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal">${html}</div>`;
  root.classList.remove("hidden");
  root.onclick = e => { if (e.target === root) closeModal(); };
  if (onMount) onMount(root.firstElementChild);
}
function closeModal() { const r = $("#modalRoot"); r.classList.add("hidden"); r.innerHTML = ""; }

/* 题库中各类别题号集合 */
function idsFor(cls) {
  if (cls === "ALL") return IDS;
  return IDS.filter(id => QMAP[id].classes.includes(cls));
}

/* ================= 统计刷新 ================= */
function refreshBadge() {
  const n = Object.keys(wrongBook).length;
  const b = $("#wrongBadge");
  b.textContent = n > 99 ? "99+" : n;
  b.classList.toggle("hidden", n === 0);
}
function classStat(cls) {
  const ids = idsFor(cls);
  let seen = 0, right = 0;
  for (const id of ids) { const p = progress[id]; if (p && p.seen) { seen++; right += p.right; } }
  const attempts = ids.reduce((s, id) => s + (progress[id]?.right || 0) + (progress[id]?.wrong || 0), 0);
  return { total: ids.length, seen, right, acc: attempts ? Math.round(right / attempts * 100) : null };
}

/* ================= 视图切换 ================= */
function setNav(view) {
  document.querySelectorAll(".nav-btn[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view));
}
function go(view) {
  ui.view = view;
  stopTimer();
  if (view === "home") renderHome();
  else if (view === "wrong") renderWrong();
  else if (view === "stats") renderStats();
  setNav(view);
}

/* ================= 首页 ================= */
function renderHome() {
  const cards = ["A", "B", "C", "ALL"].map(c => {
    const meta = CLASS_META[c] || { name: "全部题库", desc: "A/B/C 三类合集，共 1237 题（含重叠）", icon: "📚" };
    const st = classStat(c);
    const pct = st.total ? Math.round(st.seen / st.total * 100) : 0;
    const rule = DB_RULES[c];
    const ruleTxt = rule ? `考试 ${rule.count} 题 · ${rule.minutes} 分钟 · 答对 ${rule.pass} 题合格` : "仅练习用";
    return `<button class="class-card ${settings.defaultClass === c ? "selected" : ""}" data-cls="${c}">
      <h3><span class="class-tag" style="${c === "ALL" ? "background:#64748b" : ""}">${c === "ALL" ? "全" : c}</span>${meta.name}</h3>
      <p>${meta.desc}</p>
      <div class="cls-stat">${ruleTxt} · 题库 ${st.total} 题 · 已练 ${st.seen} (${pct}%)${st.acc != null ? ` · 正确率 ${st.acc}%` : ""}</div>
      <div class="cls-bar"><i style="width:${pct}%"></i></div>
    </button>`;
  }).join("");

  const wrongN = Object.keys(wrongBook).length;
  const modes = [
    { id: "mock", icon: "📝", name: "全真模拟考试", desc: "按真实考试规则随机抽题、限时作答、选项乱序，交卷后判分并计入错题本。", needCls: true },
    { id: "seq", icon: "📖", name: "顺序练习", desc: "按题库编号顺序逐题复习，即时判定对错并显示正确答案。", needCls: true },
    { id: "rand", icon: "🎲", name: "随机练习", desc: "随机顺序抽取指定数量的题目复习，即时判定对错。", needCls: true },
    { id: "wrong", icon: "❌", name: "错题重考", desc: `只考错题本中的题目（当前 ${wrongN} 题），彻底消灭薄弱点。`, needCls: false, disabled: wrongN === 0 },
  ].map(m => `
    <button class="mode-card ${m.disabled ? "disabled" : ""}" data-mode="${m.id}">
      <span class="mode-icon">${m.icon}</span>
      <span><h4>${m.name}</h4><p>${m.desc}</p></span>
    </button>`).join("");

  main().innerHTML = `
    <div class="section-title">① 选择题库类别</div>
    <div class="class-cards">${cards}</div>
    <div class="section-title">② 选择模式</div>
    <div class="mode-grid">${modes}</div>
    <div class="hint-box">💡 答错会自动进入错题本；练习中连续答对 2 次可自动移出。考试题目从对应类别题库随机抽取，选项顺序随机打乱，与真实机考一致。</div>`;

  main().querySelectorAll(".class-card").forEach(el =>
    el.onclick = () => { settings.defaultClass = el.dataset.cls; store.set("settings", settings); renderHome(); });
  main().querySelectorAll(".mode-card").forEach(el => {
    el.onclick = () => {
      if (el.classList.contains("disabled")) { toast("错题本为空，先去练习吧"); return; }
      startSession(el.dataset.mode);
    };
  });
}

/* ================= 会话启动 ================= */
function pickIds(mode, cls) {
  const pool = idsFor(cls);
  if (mode === "mock") {
    const n = DB_RULES[cls].count;
    return shuffle(pool.filter(id => QMAP[id])).slice(0, n);
  }
  if (mode === "wrong") return shuffle(Object.keys(wrongBook).filter(id => QMAP[id]));
  if (mode === "seq") return pool.slice().sort();
  return pool; // rand: 数量由调用方截取
}

function startSession(mode, optCount) {
  const cls = settings.defaultClass;
  let ids = pickIds(mode, cls);
  if (mode === "rand") {
    if (optCount == null) {
      return modal(`<h3>随机练习 · ${cls === "ALL" ? "全部题库" : cls + " 类题库"}</h3>
        <p style="font-size:14px;color:var(--text2)">选择抽题数量：</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          ${[10, 25, 50, 100, 200, ids.length].map(n =>
            `<button class="chip" data-n="${n}">${n === ids.length ? "全部 " + n : n + " 题"}</button>`).join("")}
        </div>
        <div style="margin-top:18px;text-align:right"><button class="btn" id="mCancel">取消</button></div>`, m => {
        m.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { closeModal(); startSession(mode, +b.dataset.n); });
        m.querySelector("#mCancel").onclick = closeModal;
      });
    }
    ids = shuffle(ids).slice(0, optCount);
  }
  if (!ids.length) { toast("没有可用题目"); return; }

  const rule = DB_RULES[mode === "mock" ? cls : null];
  session = {
    mode, cls, ids,
    list: ids.map(id => ({ qid: id, perm: settings.shuffleOptions ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3], chosen: null, marked: false })),
    idx: 0,
    startedAt: Date.now(),
    limitSec: mode === "mock" ? DB_RULES[cls].minutes * 60 : null,
    remaining: mode === "mock" ? DB_RULES[cls].minutes * 60 : 0,
    submitted: false,
    title: { mock: `${cls} 类全真模拟考试`, seq: `顺序练习 · ${cls === "ALL" ? "全部" : cls + " 类"}`, rand: `随机练习 · ${cls === "ALL" ? "全部" : cls + " 类"}`, wrong: "错题重考" }[mode],
  };
  if (mode === "mock") store.set("session", { ids, cls, startedAt: session.startedAt });
  ui.view = "quiz"; setNav("");
  renderQuiz();
  startTimer();
}

/* ================= 计时 ================= */
let timerHandle = null;
function stopTimer() { clearInterval(timerHandle); timerHandle = null; }
function startTimer() {
  stopTimer();
  timerHandle = setInterval(() => {
    if (!session) return stopTimer();
    if (session.mode === "mock") {
      session.remaining--;
      if (session.remaining <= 60) toast("⚠ 距离考试结束还有 1 分钟", 2500);
      if (session.remaining <= 0) { toast("⏰ 考试时间到，自动交卷"); submitExam(true); return; }
      const t = $("#timerVal");
      if (t) { t.textContent = fmtTime(session.remaining); t.classList.toggle("warn", session.remaining <= 120); }
    } else {
      session.remaining = Math.floor((Date.now() - session.startedAt) / 1000);
      const t = $("#timerVal"); if (t) t.textContent = fmtTime(session.remaining);
    }
  }, 1000);
}

/* ================= 答题页 ================= */
function renderQuiz(keepScroll) {
  const s = session;
  if (!s || !s.list?.length) { go("home"); return; }
  if (s.idx < 0) s.idx = 0;
  if (s.idx >= s.list.length) s.idx = s.list.length - 1;
  const item = s.list[s.idx];
  const q = QMAP[item.qid];
  const answered = s.list.filter(i => i.chosen != null).length;
  const pct = Math.round((s.idx + 1) / s.list.length * 100);
  const isMock = s.mode === "mock";

  const optHtml = item.perm.map((orig, pos) => {
    let cls = "opt";
    if (item.chosen === pos) cls += " chosen";
    if (s.submitted || (!isMock && settings.instantFeedback && item.chosen != null)) {
      if (orig === 0) cls += " correct";
      else if (item.chosen === pos) cls += " wrong";
    }
    return `<button class="${cls}" data-pos="${pos}" ${(s.submitted || (!isMock && item.chosen != null)) ? "disabled" : ""}>
      <span class="key">${"ABCD"[pos]}</span><span>${esc(q.options[orig])}</span></button>`;
  }).join("");

  let feedback = "";
  if (!isMock && item.chosen != null) {
    const ok = item.perm[item.chosen] === 0;
    feedback = `<div class="feedback ${ok ? "ok" : "no"}">${ok ? "✓ 回答正确" : `✗ 回答错误，正确答案：${esc(q.options[0])}`}</div>`;
  }

  const imgHtml = q.img ? `<div class="q-img-wrap"><img src="${DB_IMAGES[q.img]}" alt="${q.img}" data-zoom="${q.img}"></div>` : "";
  const clsTag = isMock ? s.cls : s.cls === "ALL" ? "全部" : s.cls;

  main().innerHTML = `
    <div class="quiz-top">
      <div class="quiz-info">
        <span class="qmeta"><b>${esc(s.title)}</b> · 第 <b>${s.idx + 1}</b> / ${s.list.length} 题 · ${q.id}${q.img ? " · 🖼" : ""}</span>
        <span class="timer ${isMock && session.remaining <= 120 ? "warn" : ""}">${isMock ? "⏱ 剩余 " : "⏱ "}<span id="timerVal">${fmtTime(isMock ? session.remaining : session.remaining)}</span></span>
      </div>
      <div class="progress"><i style="width:${pct}%"></i></div>
    </div>
    <div class="q-card">
      <div class="q-id">${clsTag} 类 · 题号 ${q.id} · 适用类别 ${classOf(q)}</div>
      <div class="q-text">${esc(q.q)}</div>
      ${imgHtml}
      <div class="q-options">${optHtml}</div>
      ${feedback}
      <div class="quiz-actions">
        <button class="btn" id="btnPrev" ${s.idx === 0 ? "disabled" : ""}>← 上一题</button>
        <button class="btn" id="btnMark">${item.marked ? "★ 已标记" : "☆ 标记"}</button>
        <span class="spacer"></span>
        ${s.idx < s.list.length - 1
          ? `<button class="btn primary" id="btnNext">下一题 →</button>`
          : (isMock ? `<button class="btn primary" id="btnSubmit">交卷</button>` : `<button class="btn primary" id="btnFinish">完成练习</button>`)}
        ${isMock && !s.submitted ? `<button class="btn danger" id="btnSubmitEarly">提前交卷</button>` : ""}
      </div>
    </div>
    <div class="answer-sheet">
      <div style="font-size:14px;font-weight:600">答题卡 <span style="font-weight:400;color:var(--text2);font-size:12.5px">已答 ${answered}/${s.list.length} · 点击序号跳转</span></div>
      <div class="sheet-grid">${s.list.map((it, i) => {
        let c = "sheet-cell";
        if (s.submitted) {
          const right = it.perm[it.chosen] === 0;
          c += it.chosen == null ? "" : right ? " result-right" : " result-wrong";
        } else if (it.chosen != null) c += " answered";
        if (i === s.idx) c += " current";
        return `<button class="${c}" data-jump="${i}">${i + 1}${it.marked ? '<i class="mark-dot"></i>' : ""}</button>`;
      }).join("")}</div>
      <div class="sheet-legend">
        <span class="lg-answered">已作答</span><span class="lg-mark">★ 标记待复查</span>
        ${s.submitted ? '<span style="color:var(--green)">✓ 正确</span><span style="color:var(--red)">✗ 错误</span>' : ""}
      </div>
    </div>`;

  // 事件绑定
  main().querySelectorAll(".opt").forEach(b => b.onclick = () => chooseOption(+b.dataset.pos));
  main().querySelectorAll("[data-jump]").forEach(b => b.onclick = () => { s.idx = +b.dataset.jump; renderQuiz(); });
  main().querySelector("[data-zoom]")?.addEventListener("click", e =>
    modal(`<h3>附图 · ${esc(q.img)}</h3><img class="zoomed" src="${DB_IMAGES[e.currentTarget ? q.img : q.img]}"><div style="margin-top:14px;text-align:right"><button class="btn" onclick="closeModal()">关闭</button></div>`));
  $("#btnPrev").onclick = () => { if (s.idx > 0) { s.idx--; renderQuiz(); } };
  $("#btnMark").onclick = () => { item.marked = !item.marked; renderQuiz(); };
  $("#btnNext") && ($("#btnNext").onclick = () => { s.idx++; renderQuiz(); });
  $("#btnFinish") && ($("#btnFinish").onclick = () => finishPractice());
  $("#btnSubmit") && ($("#btnSubmit").onclick = () => confirmSubmit());
  $("#btnSubmitEarly") && ($("#btnSubmitEarly").onclick = () => confirmSubmit());

  if (!keepScroll) window.scrollTo({ top: 0 });
}

function chooseOption(pos) {
  const item = session.list[session.idx];
  if (session.submitted || item.chosen != null && session.mode !== "mock") return;
  item.chosen = pos;
  if (session.mode !== "mock") { recordAnswer(item, Date.now()); saveAll(); refreshBadge(); }
  else store.set("session", { ids: session.ids, cls: session.cls, startedAt: session.startedAt, answers: session.list.map(i => i.chosen) });
  renderQuiz(true);
}

function confirmSubmit() {
  const unanswered = session.list.filter(i => i.chosen == null).length;
  modal(`<h3>确认交卷？</h3>
    <p style="font-size:14px;color:var(--text2)">${unanswered ? `还有 <b style="color:var(--red)">${unanswered}</b> 题未作答，未作答按错误计。` : "所有题目均已作答。"}</p>
    <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" id="cCancel">继续作答</button>
      <button class="btn primary" id="cOk">确认交卷</button>
    </div>`, m => {
    m.querySelector("#cCancel").onclick = closeModal;
    m.querySelector("#cOk").onclick = () => { closeModal(); submitExam(false); };
  });
}

/* ================= 判分 / 记录 ================= */
/* 单题结果写入进度与错题本 */
function recordAnswer(item, now) {
  const q = QMAP[item.qid];
  const right = item.perm[item.chosen] === 0;
  const p = progress[item.qid] || (progress[item.qid] = { seen: 0, right: 0, wrong: 0 });
  p.seen++; right ? p.right++ : p.wrong++; p.ts = now;

  if (right) {
    if (wrongBook[item.qid]) {
      wrongBook[item.qid].streak++;
      if (settings.autoRemoveWrong && wrongBook[item.qid].streak >= 2) {
        delete wrongBook[item.qid];
        toast(`「${item.qid}」已连对 2 次，移出错题本`);
      }
    }
  } else {
    const w = wrongBook[item.qid] || (wrongBook[item.qid] = { count: 0, streak: 0 });
    w.count++; w.streak = 0; w.lastChosen = q.options[item.perm[item.chosen]]; w.ts = now;
  }
}

function applyAnswerRecords() {
  const now = Date.now();
  for (const item of session.list) {
    if (item.chosen == null) continue;
    if (session.mode !== "mock") continue; // 练习模式已在作答时实时记录
    recordAnswer(item, now);
  }
  if (session.mode === "mock") {
    const correct = session.list.filter(i => i.chosen != null && i.perm[i.chosen] === 0).length;
    history.unshift({
      ts: now, mode: session.mode, cls: session.cls, correct, total: session.list.length,
      seconds: Math.floor((Date.now() - session.startedAt) / 1000),
      pass: correct >= DB_RULES[session.cls].pass,
    });
    history = history.slice(0, 60);
    store.set("session", null);
  }
  saveAll(); refreshBadge();
}

function submitExam(auto) {
  stopTimer();
  if (session.submitted) return;
  session.submitted = true;
  applyAnswerRecords();
  renderResult(auto);
}

function finishPractice() {
  stopTimer();
  const answered = session.list.filter(i => i.chosen != null).length;
  const unanswered = session.list.length - answered;
  modal(`<h3>结束本次练习？</h3>
    <p style="font-size:14px;color:var(--text2)">${unanswered ? `还有 ${unanswered} 题未作答（不计入成绩），已答题目结果已实时记录。` : "已答题目结果均已实时记录。"}</p>
    <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" id="fBack">继续练习</button>
      <button class="btn primary" id="fOk">结束并回首页</button>
    </div>`, m => {
    m.querySelector("#fBack").onclick = closeModal;
    m.querySelector("#fOk").onclick = () => { closeModal(); session = null; go("home"); };
  });
}

/* ================= 结果页 ================= */
function renderResult(auto) {
  const s = session;
  const rule = DB_RULES[s.cls];
  const list = s.list;
  const answered = list.filter(i => i.chosen != null).length;
  const correct = list.filter(i => i.chosen != null && i.perm[i.chosen] === 0).length;
  const pass = correct >= rule.pass;
  const wrongItems = list.filter(i => !(i.chosen != null && i.perm[i.chosen] === 0));
  const dur = Math.floor((Date.now() - s.startedAt) / 1000);
  const score = Math.round(correct / list.length * 100);

  const body = wrongItems.length ? wrongItems.map(item => {
    const q = QMAP[item.qid];
    const chosenTxt = item.chosen == null ? "未作答" : esc(q.options[item.perm[item.chosen]]);
    return `<div class="wrong-item" data-review="${item.qid}">
      <span class="wid">${q.id}</span>
      <span class="wq">${esc(q.q)}</span>
      <span class="wcls" style="color:var(--red);background:var(--red-weak)">你的答案: ${chosenTxt}</span>
    </div>`;
  }).join("") : `<div class="empty-tip">🎉 全部答对，没有错题！</div>`;

  main().innerHTML = `
    <div class="result-hero ${pass ? "" : "fail"}">
      <div class="verdict ${pass ? "pass" : "fail"}">${auto ? "⏰ 时间到 · 自动交卷<br>" : ""}${pass ? "✓ 合格" : "✗ 不合格"}</div>
      <div class="score-big">${score}<span style="font-size:24px;color:var(--text2)">分</span></div>
      <div class="result-sub">答对 ${correct} / ${list.length} 题（合格线 ${rule.pass} 题）${s.mode === "mock" ? ` · 用时 ${fmtTime(dur)} / ${rule.minutes} 分钟` : ` · 用时 ${fmtTime(dur)}`}</div>
      <div class="result-stats">
        <div><b>${answered}</b><span>已作答</span></div>
        <div><b style="color:var(--green)">${correct}</b><span>答对</span></div>
        <div><b style="color:var(--red)">${list.length - answered}</b><span>未作答</span></div>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn" onclick="go('home')">返回首页</button>
        <button class="btn" onclick="go('wrong')">查看错题本</button>
        <button class="btn primary" onclick="startSession('mock')">再考一次</button>
      </div>
    </div>
    <div class="section-title">错题回顾（${wrongItems.length} 题 · 点击查看完整题目）</div>
    <div class="panel"><div class="wrong-list">${body}</div></div>`;

  main().querySelectorAll("[data-review]").forEach(el =>
    el.onclick = () => showQuestionModal(el.dataset.review));
}

/* 单题回看弹窗 */
function showQuestionModal(qid) {
  const q = QMAP[qid];
  const w = wrongBook[qid];
  const p = progress[qid];
  modal(`<h3>${q.id} <span style="font-size:12px;color:var(--text2);font-weight:400">适用类别 ${classOf(q)}</span></h3>
    <div style="font-size:16px;font-weight:600;white-space:pre-wrap">${esc(q.q)}</div>
    ${q.img ? `<div class="q-img-wrap"><img class="zoomed" src="${DB_IMAGES[q.img]}"></div>` : ""}
    <div class="q-options" style="margin-top:14px">
      ${q.options.map((o, i) => `<div class="opt ${i === 0 ? "correct" : ""}" style="cursor:default"><span class="key">${"ABCD"[i]}</span><span>${esc(o)}</span></div>`).join("")}
    </div>
    <div style="margin-top:12px;font-size:13px;color:var(--text2)">
      <span class="pill" style="background:var(--green-weak);color:var(--green)">正确答案: ${esc(q.options[0])}</span>
      ${w ? `<span class="pill" style="background:var(--red-weak);color:var(--red);margin-left:6px">上次错选: ${esc(w.lastChosen || "未作答")} · 错 ${w.count} 次</span>` : ""}
      ${p ? `<span style="margin-left:6px">个人累计: 练 ${p.seen} 次 · 对 ${p.right} / 错 ${p.wrong}</span>` : ""}
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
      ${w ? `<button class="btn danger" id="rmWrong">标记已掌握并移出</button>` : ""}
      <button class="btn" onclick="closeModal()">关闭</button>
    </div>`, m => {
    m.querySelector("#rmWrong")?.addEventListener("click", () => {
      delete wrongBook[qid]; saveAll(); refreshBadge(); closeModal(); toast("已移出错题本");
      if (ui.view === "wrong") renderWrong();
    });
  });
}

/* ================= 错题本 ================= */
let wrongFilter = { cls: "ALL", kw: "" };
function renderWrong() {
  const ids = Object.keys(wrongBook).filter(id => QMAP[id]).sort();
  const fIds = ids.filter(id => {
    const q = QMAP[id];
    if (wrongFilter.cls !== "ALL" && !q.classes.includes(wrongFilter.cls)) return false;
    if (wrongFilter.kw && !(q.q.includes(wrongFilter.kw) || id.includes(wrongFilter.kw.toUpperCase()))) return false;
    return true;
  });
  const byCls = c => ids.filter(id => QMAP[id].classes.includes(c)).length;

  main().innerHTML = `
    <div class="section-title">错题本（${ids.length} 题）</div>
    <div class="panel">
      <div class="filter-row">
        ${["ALL", "A", "B", "C"].map(c => `<button class="chip ${wrongFilter.cls === c ? "active" : ""}" data-fcls="${c}">${c === "ALL" ? "全部" : c + " 类"} (${c === "ALL" ? ids.length : byCls(c)})</button>`).join("")}
        <input type="text" id="wrongKw" placeholder="搜索题干或题号…" value="${esc(wrongFilter.kw)}">
      </div>
      ${fIds.length ? `
      <div class="wrong-list">${fIds.map(id => {
        const q = QMAP[id], w = wrongBook[id];
        return `<div class="wrong-item" data-q="${id}">
          <span class="wid">${id}</span>
          <span class="wq">${esc(q.q)}</span>
          <span class="wcls">${q.classes.join("/")}</span>
        </div>`;
      }).join("")}</div>
      <div class="quiz-actions" style="margin-top:16px">
        <button class="btn primary" id="wrongExam">🎯 错题重考（${fIds.length} 题）</button>
        <button class="btn danger" id="wrongClear">清空错题本</button>
        <span class="spacer"></span>
        <button class="btn" id="wrongExport">导出 JSON</button>
        <button class="btn" id="wrongImport">导入 JSON</button>
      </div>` : `<div class="empty-tip">${ids.length ? "没有符合筛选条件的错题" : "错题本为空，去做题吧！<br>练习或考试中答错的题目会自动出现在这里。"}</div>`}
    </div>`;

  main().querySelectorAll("[data-fcls]").forEach(b => b.onclick = () => { wrongFilter.cls = b.dataset.fcls; renderWrong(); });
  main().querySelectorAll("[data-q]").forEach(el => el.onclick = () => showQuestionModal(el.dataset.q));
  const kw = $("#wrongKw");
  kw && (kw.oninput = () => { wrongFilter.kw = kw.value.trim(); clearTimeout(renderWrong._h); renderWrong._h = setTimeout(() => { const keep = wrongFilter.kw; renderWrong(); $("#wrongKw").focus(); $("#wrongKw").value = keep; wrongFilter.kw = keep; const el = $("#wrongKw"); el.setSelectionRange(el.value.length, el.value.length); }, 300); });
  $("#wrongExam") && ($("#wrongExam").onclick = () => {
    const pool = fIds;
    session = {
      mode: "wrong", cls: settings.defaultClass, ids: pool,
      list: pool.map(id => ({ qid: id, perm: settings.shuffleOptions ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3], chosen: null, marked: false })),
      idx: 0, startedAt: Date.now(), limitSec: null, remaining: 0, submitted: false, title: "错题重考",
    };
    ui.view = "quiz"; setNav(""); renderQuiz(); startTimer();
  });
  $("#wrongClear") && ($("#wrongClear").onclick = () => {
    modal(`<h3>清空错题本？</h3><p style="font-size:14px;color:var(--text2)">将删除全部 ${ids.length} 道错题记录，不可恢复。</p>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="n">取消</button><button class="btn danger" id="y">确认清空</button></div>`, m => {
      m.querySelector("#n").onclick = closeModal;
      m.querySelector("#y").onclick = () => { wrongBook = {}; saveAll(); refreshBadge(); closeModal(); renderWrong(); toast("错题本已清空"); };
    });
  });
  $("#wrongExport") && ($("#wrongExport").onclick = () => {
    const blob = new Blob([JSON.stringify(wrongBook, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ham-exam-错题本.json"; a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#wrongImport") && ($("#wrongImport").onclick = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      f.text().then(t => {
        try {
          const data = JSON.parse(t);
          let n = 0;
          for (const [id, v] of Object.entries(data)) if (QMAP[id] && typeof v === "object") { wrongBook[id] = { count: v.count || 1, streak: 0, lastChosen: v.lastChosen, ts: Date.now() }; n++; }
          saveAll(); refreshBadge(); renderWrong(); toast(`导入 ${n} 道错题`);
        } catch { toast("文件格式错误"); }
      });
    };
    inp.click();
  });
}

/* ================= 统计页 ================= */
function renderStats() {
  const totalQ = IDS.length;
  const seenIds = IDS.filter(id => progress[id]?.seen);
  const attempts = seenIds.reduce((s, id) => s + progress[id].right + progress[id].wrong, 0);
  const rights = seenIds.reduce((s, id) => s + progress[id].right, 0);
  const acc = attempts ? Math.round(rights / attempts * 100) : 0;
  const mockTests = history.filter(h => h.mode === "mock");

  main().innerHTML = `
    <div class="section-title">学习总览</div>
    <div class="stat-grid">
      <div class="stat-box"><b>${seenIds.length}<span style="font-size:14px;color:var(--text2)"> / ${totalQ}</span></b><span>已练习题数（覆盖率 ${Math.round(seenIds.length / totalQ * 100)}%）</span></div>
      <div class="stat-box"><b>${attempts}</b><span>累计答题次数</span></div>
      <div class="stat-box"><b style="color:${acc >= 80 ? "var(--green)" : "var(--amber)"}">${acc}%</b><span>总正确率</span></div>
      <div class="stat-box"><b style="color:var(--red)">${Object.keys(wrongBook).length}</b><span>错题本待攻克</span></div>
      <div class="stat-box"><b>${mockTests.length}</b><span>模拟考试次数</span></div>
    </div>

    <div class="section-title">各类别掌握情况</div>
    <div class="stat-grid">
      ${["A", "B", "C"].map(c => {
        const st = classStat(c);
        return `<div class="stat-box">
          <b>${c} 类</b>
          <span>覆盖率 ${st.total ? Math.round(st.seen / st.total * 100) : 0}%（${st.seen}/${st.total}）</span>
          <div class="cls-bar" style="margin-top:8px"><i style="width:${st.total ? st.seen / st.total * 100 : 0}%"></i></div>
          <span style="display:block;margin-top:6px">正确率 ${st.acc == null ? "—" : st.acc + "%"}</span>
        </div>`;
      }).join("")}
    </div>

    <div class="section-title">模拟考试成绩单</div>
    <div class="panel">
      ${history.length ? `<table class="history-table">
        <tr><th>时间</th><th>类别</th><th>成绩</th><th>用时</th><th>结果</th></tr>
        ${history.map(h => `<tr>
          <td>${new Date(h.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
          <td>${h.cls} 类${h.mode !== "mock" ? " · " + ({ seq: "顺序", rand: "随机", wrong: "错题" }[h.mode] || "") : ""}</td>
          <td>${h.correct} / ${h.total}</td>
          <td>${fmtTime(h.seconds)}</td>
          <td><span class="pill ${h.pass ? "pass" : "fail"}">${h.pass ? "合格" : "不合格"}</span></td>
        </tr>`).join("")}
      </table>` : `<div class="empty-tip">暂无考试记录，去首页参加一次全真模拟考试吧</div>`}
    </div>

    <div class="section-title">数据管理</div>
    <div class="panel">
      <div class="quiz-actions" style="margin-top:0">
        <button class="btn" id="expAll">导出全部学习数据</button>
        <button class="btn" id="impAll">导入学习数据</button>
        <button class="btn danger" id="resetAll">重置全部数据</button>
      </div>
      <p style="font-size:12.5px;color:var(--text2);margin-top:10px">所有数据保存在本机浏览器 localStorage 中，清除浏览器数据会丢失记录，建议定期导出备份。</p>
    </div>`;

  $("#expAll").onclick = () => {
    const blob = new Blob([JSON.stringify({ progress, wrongBook, history, settings, _exportedAt: Date.now() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ham-exam-学习数据.json"; a.click();
    URL.revokeObjectURL(a.href);
  };
  $("#impAll").onclick = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      f.text().then(t => {
        try {
          const d = JSON.parse(t);
          if (d.progress) progress = d.progress;
          if (d.wrongBook) wrongBook = d.wrongBook;
          if (d.history) history = d.history;
          if (d.settings) settings = Object.assign(settings, d.settings);
          saveAll(); refreshBadge(); renderStats(); toast("导入成功");
        } catch { toast("文件格式错误"); }
      });
    };
    inp.click();
  };
  $("#resetAll").onclick = () => {
    modal(`<h3>重置全部数据？</h3><p style="font-size:14px;color:var(--text2)">将清除错题本、练习进度、考试记录与设置，不可恢复。</p>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="n">取消</button><button class="btn danger" id="y">确认重置</button></div>`, m => {
      m.querySelector("#n").onclick = closeModal;
      m.querySelector("#y").onclick = () => {
        progress = {}; wrongBook = {}; history = [];
        settings = { shuffleOptions: true, instantFeedback: true, autoRemoveWrong: true, defaultClass: "A" };
        saveAll(); refreshBadge(); closeModal(); go("home"); toast("已重置");
      };
    });
  };
}

/* ================= 设置 ================= */
function openSettings() {
  const rows = [
    { key: "shuffleOptions", label: "打乱选项顺序", desc: "开启后与真实机考一致，正确答案内容不变" },
    { key: "instantFeedback", label: "练习即时判分", desc: "练习模式中选择后立即显示对错与正确答案" },
    { key: "autoRemoveWrong", label: "错题连对 2 次自动移出", desc: "在错题本中的题目连续答对 2 次后自动移出" },
  ].map(r => `<div class="setting-row">
      <div><div class="s-label">${r.label}</div><div class="s-desc">${r.desc}</div></div>
      <label class="switch"><input type="checkbox" data-set="${r.key}" ${settings[r.key] ? "checked" : ""}><i></i></label>
    </div>`).join("");

  modal(`<h3>设置</h3>${rows}
    <div class="setting-row"><div><div class="s-label">关于</div>
    <div class="s-desc">题库：中国无线电协会公布的业余无线电台操作技术能力验证题库 v171031，共 ${IDS.length} 题，附图 ${Object.keys(DB_IMAGES).length} 张。所有数据仅保存在本机。</div></div></div>
    <div style="margin-top:16px;text-align:right"><button class="btn primary" onclick="closeModal()">完成</button></div>`, m => {
    m.querySelectorAll("[data-set]").forEach(cb => cb.onchange = () => {
      settings[cb.dataset.set] = cb.checked; store.set("settings", settings); toast("已保存");
    });
  });
}

/* ================= 未完成会话恢复 ================= */
function tryRestoreSession() {
  const saved = store.get("session", null);
  if (!saved || !saved.ids?.length) return;
  modal(`<h3>检测到一场未完成的模拟考试</h3>
    <p style="font-size:14px;color:var(--text2)">${saved.cls} 类 · ${saved.ids.length} 题 · ${saved.answers ? `已答 ${saved.answers.filter(a => a != null).length} 题` : "未开始作答"}。<br>计时已重置，是否继续作答？</p>
    <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" id="rDiscard">放弃</button>
      <button class="btn primary" id="rResume">继续考试</button>
    </div>`, m => {
    m.querySelector("#rDiscard").onclick = () => { store.set("session", null); closeModal(); };
    m.querySelector("#rResume").onclick = () => {
      closeModal();
      session = {
        mode: "mock", cls: saved.cls, ids: saved.ids,
        list: saved.ids.map((id, i) => ({ qid: id, perm: settings.shuffleOptions ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3], chosen: saved.answers?.[i] ?? null, marked: false })),
        idx: 0, startedAt: Date.now(), limitSec: DB_RULES[saved.cls].minutes * 60,
        remaining: DB_RULES[saved.cls].minutes * 60, submitted: false, title: `${saved.cls} 类全真模拟考试`,
      };
      ui.view = "quiz"; setNav(""); renderQuiz(); startTimer();
    };
  });
}

/* ================= 启动 ================= */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-btn[data-view]").forEach(b => b.onclick = () => go(b.dataset.view));
  $("#settingsBtn").onclick = openSettings;
  refreshBadge();
  go("home");
  setTimeout(tryRestoreSession, 300);
});
