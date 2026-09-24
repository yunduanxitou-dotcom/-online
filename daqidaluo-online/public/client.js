// ============================================================
// client.js —— 《大起大落》联机版 客户端
// 只做两件事：把服务器推来的状态画出来；把玩家的操作发给服务器。
// 没有随机数、没有算钱逻辑 —— 一切由服务器说了算。
// ============================================================
"use strict";

const $ = (id) => document.getElementById(id);

// ---- 会话 ----
let my = null;              // { room, playerId }
let state = null;           // 服务器最新状态
let myId = null;
try { my = JSON.parse(localStorage.getItem("dql_session") || "null"); } catch (e) { my = null; }
if (my) myId = my.playerId;

// ---- 客户端本地 UI 状态 ----
let coinRot = 0;
let stakePct = 100;
let pickIdx = 0;
let prevPhase = null;
let prevRound = -1;
let renderedLogLen = 0;

const STAKE_PRESETS = [10, 25, 50, 100];
const LEVERAGE_DISPLAY = [
  { key: "light", name: "轻杠杆", mult: 1, rate: 0.90, desc: "稳稳续命" },
  { key: "mid",   name: "中杠杆", mult: 3, rate: 0.60, desc: "搏一把" },
  { key: "heavy", name: "加杠杆", mult: 8, rate: 0.30, desc: "一步登天，或一步归西" },
];

function me() { return state && state.players.find((p) => p.id === myId); }
function cur() { return state && state.players[state.turn]; }
function isMyTurn() { return state && cur() && cur().id === myId; }
function aliveCount() { return state ? state.players.filter((p) => p.alive).length : 0; }

// ================= 网络 =================
async function postJSON(url, body) {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } catch (e) {
    return { error: "连不上服务器" };
  }
}

async function send(type, payload) {
  if (!my) return;
  const r = await postJSON("/api/action", { room: my.room, playerId: my.playerId, type, payload: payload || {} });
  if (r.error) {
    if (r.error === "你不是本房成员") clearSession();
    else toast(r.error);
  }
}

function saveSession(r) {
  my = { room: r.room, playerId: r.playerId };
  myId = r.playerId;
  localStorage.setItem("dql_session", JSON.stringify(my));
  updateScreens();
}

function clearSession() {
  my = null; myId = null;
  localStorage.removeItem("dql_session");
  if (es) { es.close(); es = null; }
  state = null;
  updateScreens();
  toast("已断开连接，请重新加入");
}

let es = null;
function connect() {
  if (!my) return;
  if (es) es.close();
  es = new EventSource("/api/stream?room=" + my.room + "&playerId=" + my.playerId);
  es.onmessage = (ev) => {
    try { state = JSON.parse(ev.data); render(); } catch (e) {}
  };
  es.onerror = () => {
    // 404 等不可恢复错误会让 readyState 变成 CLOSED，自动重连不了
    if (es.readyState === EventSource.CLOSED) clearSession();
  };
}

// ================= 渲染 =================
function render() {
  if (!state) return;
  updateScreens();

  const inLobby = state.phase === "lobby";
  $("roomCode").textContent = "房间 " + state.code;
  $("roundMeta").textContent = inLobby ? "大厅 · " + state.players.length + " 人"
    : "第 " + Math.max(1, state.round) + " 手 · " + aliveCount() + " 人在场";
  $("quitBtn").style.display = (inLobby || state.phase === "over") ? "none" : "";

  // 硬币动画：flipping 时一次转到位，CSS transition 负责转的过程
  if (state.phase === "flipping" && state.round !== prevRound) {
    const target = state.lastResult === "head" ? 0 : 180;
    const now = coinRot % 360;
    coinRot += 360 * 6 + ((target - now) + 360) % 360;
    $("coin").style.transform = "rotateY(" + coinRot + "deg)";
  }

  // 每次进入新的借钱回合，选中项归零
  if (state.phase === "borrow" && prevPhase !== "borrow") pickIdx = 0;

  renderPlayers();
  renderStage();
  renderLog();
  renderLobbyCtrl();
  renderOver();

  prevPhase = state.phase;
  prevRound = state.round;
}

function updateScreens() {
  const hasSession = !!my;
  $("entry").classList.toggle("active", !hasSession);
  $("room").classList.toggle("active", hasSession);
  if (hasSession && !state) {
    $("turnName").textContent = "连接中…";
    $("turnSub").textContent = "";
  }
}

function renderPlayers() {
  const box = $("players");
  box.innerHTML = "";
  if (!state) return;
  state.players.forEach((p, i) => {
    const d = document.createElement("div");
    const inGame = state.phase !== "lobby" && state.phase !== "over";
    d.className = "pcard" + (inGame && i === state.turn ? " cur" : "") + (p.alive ? "" : " out");

    const av = document.createElement("div");
    av.className = "avatar"; av.style.background = p.color; av.textContent = p.name.slice(0, 1);

    const info = document.createElement("div"); info.className = "info";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = p.name;

    const tags = document.createElement("div"); tags.className = "tags";
    if (p.id === state.hostId) addTag(tags, "房主");
    if (p.id === myId) addTag(tags, "我");
    if (p.connected === false) addTag(tags, "离线");
    if (!p.alive) addTag(tags, "已下桌");
    else if (inGame && i === state.turn) addTag(tags, "该你了");

    const co = document.createElement("div");
    co.className = "coins" + (p.coins <= 0 ? " zero" : "");
    co.textContent = p.coins.toLocaleString();

    info.appendChild(nm);
    if (tags.children.length) info.appendChild(tags);
    info.appendChild(co);

    if (p.debt > 0) {
      const db = document.createElement("div");
      db.className = "debt"; db.textContent = "负债 " + p.debt.toLocaleString();
      info.appendChild(db);
    }

    const it = document.createElement("div");
    it.className = "items";
    it.textContent = "🏷 抵押物 " + p.collateral.length + (p.streak >= 2 ? " · 连中 " + p.streak : "");
    info.appendChild(it);

    d.appendChild(av); d.appendChild(info);
    box.appendChild(d);
  });
}

function addTag(parent, text) {
  const s = document.createElement("span");
  s.className = "tag"; s.textContent = text;
  parent.appendChild(s);
}

function renderStage() {
  const actions = $("actions");
  const slot = $("borrowSlot");
  slot.innerHTML = "";
  actions.innerHTML = "";

  if (!state || state.phase === "lobby") {
    $("turnName").textContent = state ? "等待开局" : "连接中…";
    $("turnSub").textContent = state ? "房主点「开局」开始" : "";
    $("potVal").textContent = "0";
    $("potVal").classList.add("dim");
    $("stakeBox").style.display = "none";
    $("streak").textContent = "";
    return;
  }

  const p = cur();
  $("potVal").textContent = state.pot.toLocaleString();
  $("potVal").classList.toggle("dim", state.pot === 0);
  $("streak").innerHTML = p && p.streak >= 1
    ? "当前连中 <b>" + p.streak + "</b> 次" : "";

  const myTurn = isMyTurn();

  if (state.phase === "idle") {
    $("turnName").textContent = p.name + " 的回合";
    if (myTurn) {
      $("turnSub").textContent = "选好押注，抛吧";
      const stake = stakeAmount();
      actions.appendChild(btn("抛 硬 币（押 " + stake.toLocaleString() + "）", "btn-flip", () => send("flip", { stake })));
      renderStakeBox();
    } else {
      $("stakeBox").style.display = "none";
      $("turnSub").textContent = "等 " + p.name + " 押注…";
      actions.appendChild(btn("等 " + p.name + " 操作…", "btn-flip", null, true));
    }
  } else if (state.phase === "flipping") {
    $("stakeBox").style.display = "none";
    $("turnName").textContent = "硬币在天上转……";
    $("turnSub").textContent = "别眨眼";
  } else if (state.phase === "choice") {
    $("stakeBox").style.display = "none";
    $("turnName").textContent = "正面！" + p.name + " 你选";
    $("turnSub").textContent = "桌上已经滚到 " + state.pot.toLocaleString() + " 风浪币";
    if (myTurn) {
      actions.appendChild(btn("见 好 就 收", "btn-keep", () => send("keep")));
      actions.appendChild(btn("继 续 浪", "btn-push", () => send("push")));
    } else {
      actions.appendChild(btn("等 " + p.name + " 选择…", "btn-flip", null, true));
    }
  } else if (state.phase === "borrow") {
    $("stakeBox").style.display = "none";
    $("turnName").textContent = p.name + " 没钱了";
    if (myTurn) {
      $("turnSub").textContent = "先点选一件物品，再选杠杆借钱";
      renderBorrow();
    } else {
      $("turnSub").textContent = "等 " + p.name + " 借钱…";
      actions.appendChild(btn("等 " + p.name + "…", "btn-flip", null, true));
    }
  } else if (state.phase === "waiting") {
    $("stakeBox").style.display = "none";
    $("turnName").textContent = "换下一位……";
    $("turnSub").textContent = "";
  } else if (state.phase === "over") {
    $("stakeBox").style.display = "none";
    $("turnName").textContent = "散场";
    $("turnSub").textContent = "";
  }
}

function btn(text, cls, fn, disabled) {
  const b = document.createElement("button");
  b.className = cls; b.textContent = text;
  b.disabled = !!disabled;
  if (fn) b.onclick = fn;
  return b;
}

function stakeAmount() {
  const p = me();
  if (!p || p.coins <= 0) return 0;
  if (stakePct >= 100) return p.coins;
  return Math.min(p.coins, Math.max(1, Math.round(p.coins * stakePct / 100)));
}

function renderStakeBox() {
  const p = me();
  const box = $("stakeBox");
  box.style.display = "";
  const stake = stakeAmount();
  const rest = p.coins - stake;
  $("stakeNum").textContent = stake.toLocaleString();
  $("stakePct").textContent = stakePct >= 100 ? "全押 100%" : stakePct + "% 手上";
  $("stakeNote").innerHTML = "手上 <b>" + p.coins.toLocaleString() + "</b> · 押 <b>"
    + stake.toLocaleString() + "</b> · 留 <b>" + rest.toLocaleString() + "</b>";
  const r = $("stakeRange");
  if (r.value !== String(stakePct)) r.value = String(stakePct);
  r.style.background = "linear-gradient(90deg, var(--gold) 0%, var(--gold) " + stakePct
    + "%, #2a3554 " + stakePct + "%, #2a3554 100%)";
  const q = $("stakeQuick");
  q.innerHTML = "";
  STAKE_PRESETS.forEach((pct) => {
    const b = document.createElement("button");
    b.className = stakePct === pct ? "on" : "";
    b.textContent = pct === 100 ? "全 押" : pct + "%";
    b.onclick = () => { stakePct = pct; renderStage(); };
    q.appendChild(b);
  });
}

function renderBorrow() {
  const p = me();
  const tpl = $("borrowTpl").content.cloneNode(true);
  $("borrowSlot").appendChild(tpl);

  if (pickIdx >= p.collateral.length) pickIdx = 0;
  const tags = $("borrowTags");
  tags.innerHTML = "";
  if (p.collateral.length) {
    p.collateral.forEach((item, idx) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "borrow-tag" + (idx === pickIdx ? " picked" : "");
      t.textContent = "🏷 " + item;
      t.onclick = () => { pickIdx = idx; render(); };
      tags.appendChild(t);
    });
  } else {
    tags.innerHTML = '<span class="borrow-tag">一件都没有了</span>';
  }

  const row = $("levRow");
  LEVERAGE_DISPLAY.forEach((lv) => {
    const b = document.createElement("button");
    b.className = "lev-btn";
    b.innerHTML = '<div class="n">' + lv.name + "</div>"
      + '<div class="a">' + (state.base * lv.mult).toLocaleString() + "</div>"
      + '<div class="r">到手概率 ' + Math.round(lv.rate * 100) + "%</div>"
      + '<div class="d">' + lv.desc + "</div>";
    b.onclick = () => send("borrow", { itemIdx: pickIdx, levelKey: lv.key });
    row.appendChild(b);
  });
}

function renderLog() {
  const box = $("log");
  const logs = state.log || [];
  if (logs.length < renderedLogLen) { box.innerHTML = ""; renderedLogLen = 0; }
  for (let i = renderedLogLen; i < logs.length; i++) {
    const li = document.createElement("div");
    li.className = "li " + (logs[i].kind || "dim");
    li.textContent = logs[i].text;
    box.appendChild(li);
    if (logs[i].kind === "head") flash("gold");
    if (logs[i].kind === "tail") { flash("red"); shake(); }
  }
  renderedLogLen = logs.length;
  box.scrollTop = box.scrollHeight;
}

function renderLobbyCtrl() {
  const box = $("lobbyCtrl");
  if (!state || state.phase !== "lobby") { box.innerHTML = ""; return; }
  if (myId === state.hostId) {
    box.innerHTML =
      '<div class="lobby-config">'
      + '<label>初始风浪币<input type="number" id="cfgCoins" value="100" min="10" step="10"></label>'
      + '<label>每人抵押物<input type="number" id="cfgCollateral" value="3" min="0" max="10"></label>'
      + '</div>'
      + '<button class="btn-main" id="startBtn" style="margin-top:10px;">开 局（' + state.players.length + ' 人）</button>';
    $("startBtn").onclick = () => send("start", {
      coins: Number($("cfgCoins").value) || 100,
      collateral: Number($("cfgCollateral").value) || 3,
    });
  } else {
    box.innerHTML = '<div class="hint">等房主开局…</div>';
  }
}

function renderOver() {
  const over = $("over");
  if (!state || state.phase !== "over") { over.classList.remove("show"); return; }

  const ranked = state.players
    .map((p) => Object.assign({}, p, { net: p.coins - p.debt }))
    .sort((a, b) => b.net - a.net);

  const isHost = myId === state.hostId;
  $("overSub").textContent = "按总资产排名 · 负债已扣除" + (isHost ? "" : "（等房主开下一局）");

  const list = $("recapList");
  list.innerHTML = "";
  const head = document.createElement("div");
  head.className = "recap board-head";
  head.innerHTML = '<span class="rank-no">名次</span><span class="board-main"><span class="nm">玩家</span></span><span class="fin">总资产</span>';
  list.appendChild(head);

  const MEDALS = ["🥇", "🥈", "🥉"];
  ranked.forEach((p, i) => {
    const d = document.createElement("div");
    d.className = "recap rank rank-" + (i + 1) + (p.alive ? "" : " out-rec");
    const neg = p.net < 0 ? " neg" : "";
    const title = i === 0 ? ' <span class="champ">冠军</span>' : "";
    const detail = ["风浪币 " + p.coins.toLocaleString()];
    if (p.debt > 0) detail.push("负债 " + p.debt.toLocaleString());
    detail.push("最高 " + p.peak.toLocaleString());
    detail.push("连中 " + p.bestStreak + " 次");
    d.innerHTML = '<span class="rank-no">' + (MEDALS[i] || (i + 1)) + "</span>"
      + '<span class="board-main"><span class="nm" style="color:' + p.color + '">' + p.name + title + "</span>"
      + (p.alive ? "" : ' <span class="out-tag">已下桌</span>')
      + '<span class="bd-detail">' + detail.join(" · ") + "</span></span>"
      + '<span class="fin' + neg + '">' + p.net.toLocaleString() + "</span>";
    list.appendChild(d);
  });

  $("againBtn").style.display = isHost ? "" : "none";
  over.classList.add("show");
}

// ================= 特效 / 提示 =================
function flash(color) {
  const f = $("flash");
  f.className = "";
  void f.offsetWidth;
  f.className = color;
}
function shake() {
  document.body.classList.remove("shake");
  void document.body.offsetWidth;
  document.body.classList.add("shake");
}
let toastTimer = null;
function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

// ================= 事件绑定 =================
$("createBtn").onclick = async () => {
  const name = ($("nameInput").value.trim() || "玩家");
  const r = await postJSON("/api/create", { name });
  if (r.error) { $("entryError").textContent = r.error; return; }
  $("entryError").textContent = "";
  saveSession(r);
  connect();
};

$("joinBtn").onclick = async () => {
  const code = $("codeInput").value.trim();
  const name = ($("nameInput").value.trim() || "玩家");
  if (!code) { $("entryError").textContent = "请输入 4 位房间码"; return; }
  const r = await postJSON("/api/join", { room: code, name });
  if (r.error) { $("entryError").textContent = r.error; return; }
  $("entryError").textContent = "";
  saveSession(r);
  connect();
};

$("quitBtn").onclick = () => send("quit");
$("againBtn").onclick = () => send("rematch");

$("stakeRange").addEventListener("input", (e) => {
  stakePct = Math.max(1, Math.min(100, Number(e.target.value) || 1));
  renderStakeBox();
});

// 启动：有会话就自动重连
updateScreens();
if (my) connect();
