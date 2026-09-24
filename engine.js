// ============================================================
// engine.js —— 《大起大落》联机版 纯逻辑引擎
// 不碰网络、不碰界面，只负责：状态 + 规则 + 随机数（服务器权威）。
// 随机数、算钱、判谁赢全部在这里发生 —— 浏览器只能"发指令"，改不了结果。
// ============================================================
"use strict";

const COLLATERAL_POOL = [
  "祖传泡面盖", "隔壁老王的塑料凳", "一枚写着「再来一次」的硬币",
  "发圈上最爱的限量橡皮", "高中三年的错题本", "只剩一只的蓝牙耳机",
  "室友的考研英语词汇书", "外婆的腌菜坛子", "会唱歌的电子贺卡",
  "半箱没拆的快递", "传说中的第四块拼图", "一张过期的游泳卡",
  "存了三年的表情包硬盘", "自称能许愿的鹅卵石", "印着校徽的保温杯",
  "全场唯一的备用充电线", "写满「下次一定」的便利贴", "一只假装是猫的拖鞋",
  "用了四年的鼠标垫", "宿舍门后那块活动海报"
];

const LEVERAGE = {
  light: { name: "轻杠杆", mult: 1, rate: 0.90 },
  mid:   { name: "中杠杆", mult: 3, rate: 0.60 },
  heavy: { name: "加杠杆", mult: 8, rate: 0.30 },
};

const COLORS = ["#ffcf5c", "#7ee0ff", "#a9f3c4", "#ffa8c5", "#c9a6ff", "#ffbe8a"];

function randInt(n) { return Math.floor(Math.random() * n); }

function drawCollateral(n) {
  const pool = COLLATERAL_POOL.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(randInt(pool.length), 1)[0]);
  return out;
}

function aliveCount(room) { return room.players.filter((p) => p.alive).length; }
function current(room) { return room.players[room.turn]; }
function playerById(room, id) { return room.players.find((p) => p.id === id); }

function addLog(room, text, kind) {
  room.log.push({ text, kind: kind || "dim", t: Date.now() });
  if (room.log.length > 200) room.log.shift();
}

// ---------------- 房间生命周期 ----------------
function newRoom(code, hostId) {
  return {
    code, hostId,
    phase: "lobby",
    players: [],
    turn: 0, pot: 0, base: 100, round: 0, lastResult: null,
    log: [],
  };
}

function addPlayer(room, playerId, name) {
  if (room.phase !== "lobby" || room.players.length >= 6) return null;
  const p = {
    id: playerId, name, color: COLORS[playerId % COLORS.length],
    coins: 100, debt: 0, collateral: [], alive: true,
    streak: 0, bestStreak: 0, peak: 100, wipeouts: 0, borrows: 0, connected: true,
  };
  room.players.push(p);
  addLog(room, "🚪 " + name + " 加入房间。", "dim");
  return p;
}

// 有人掉线/离开：大厅里直接移除；对局中按「撤离」处理
function dropPlayer(room, playerId) {
  const p = playerById(room, playerId);
  if (!p) return;
  if (room.phase === "lobby") {
    room.players = room.players.filter((x) => x.id !== playerId);
    addLog(room, "👋 " + p.name + " 离开房间。", "dim");
  } else {
    quit(room, playerId);
  }
}

// ---------------- 开局 ----------------
function startGame(room) {
  if (room.phase !== "lobby" || room.players.length < 2) return false;
  room.base = 100;
  room.players.forEach((p) => {
    p.coins = 100;
    p.debt = 0;
    p.collateral = drawCollateral(3);
    p.alive = true;
    p.streak = 0; p.bestStreak = 0; p.peak = 100; p.wipeouts = 0; p.borrows = 0;
  });
  room.turn = 0; room.pot = 0; room.round = 0; room.lastResult = null;
  room.phase = "playing";
  room.log = [];
  addLog(room, "—— 开局。每人 100 风浪币，3 件抵押物 ——", "big");
  beginTurn(room);
  return true;
}

function beginTurn(room) {
  const p = current(room);
  if (!p.alive) { nextTurn(room); return; }
  if (p.coins <= 0) {
    if (p.collateral.length > 0) {
      room.phase = "borrow";
      addLog(room, p.name + " 手上一个风浪币都没有了，得抵押点东西……", "loan");
    } else {
      p.alive = false;
      addLog(room, "💀 " + p.name + " 连抵押物都用光了，彻底下桌。", "tail");
      nextTurn(room);
    }
  } else {
    room.phase = "idle";
  }
}

function nextTurn(room) {
  room.pot = 0;
  if (endGameIfTooFew(room)) return;
  const total = room.players.length;
  for (let step = 1; step <= total; step++) {
    const idx = (room.turn + step) % total;
    if (room.players[idx].alive) {
      room.turn = idx;
      beginTurn(room);
      return;
    }
  }
}

function shouldEndGame(room) { return aliveCount(room) === 0; }
function endGameIfTooFew(room) {
  if (!shouldEndGame(room)) return false;
  room.phase = "over";
  room.pot = 0;
  addLog(room, "🏁 所有人都下桌了。", "big");
  return true;
}

// ---------------- 抛币 ----------------
function clampStake(amount, coins) {
  const n = Math.floor(Number(amount));
  if (!isFinite(n) || n <= 0 || coins <= 0) return 0;
  return Math.min(coins, n);
}

// 从 idle 抛币：先收注再抛
function flip(room, stakeAmount) {
  if (room.phase !== "idle") return null;
  const p = current(room);
  const stake = clampStake(stakeAmount, p.coins);
  if (stake <= 0) return null;
  room.pot = stake;
  p.coins -= stake;
  addLog(room, "▶ " + p.name + " 押上 " + stake + " 风浪币"
    + (p.coins > 0 ? "（手上还留着 " + p.coins + "）" : "（全押！）") + "。");
  return doFlipCore(room);
}

// 继续浪：整堆再押（pot 已有值，不收新注）
function push(room) {
  if (room.phase !== "choice") return null;
  addLog(room, "🎲 " + current(room).name + " 选择继续浪：整堆 " + room.pot + " 再押一次！", "big");
  return doFlipCore(room);
}

function doFlipCore(room) {
  const result = Math.random() < 0.5 ? "head" : "tail";
  room.lastResult = result;
  room.round++;
  room.phase = "flipping";
  return result;
}

// 服务器会在 1.4 秒动画后调用 settle
function settle(room, result) {
  const p = current(room);
  if (result === "head") {
    room.pot *= 2;
    p.streak++;
    if (p.streak > p.bestStreak) p.bestStreak = p.streak;
    const cheer = p.streak >= 5 ? " 🔥 连中 " + p.streak + " 次！" : p.streak >= 3 ? " 手气有点热…" : "";
    addLog(room, "🪙 正面！" + p.name + " 桌上筹码翻倍 → " + room.pot + cheer, "head");
    room.phase = "choice";
  } else {
    const lost = room.pot;
    room.pot = 0;
    p.streak = 0;
    p.wipeouts++;
    addLog(room, "🌊 反面！" + p.name + " 押的 " + lost + " 风浪币被浪卷走了"
      + (p.coins > 0 ? "，手上还剩 " + p.coins + "。" : "，手上清零。"), "tail");
    room.phase = "waiting";   // 服务端 delay 后调 advanceTurn
  }
}

// 反面的 0.7 秒「看一眼 0」之后，换下一位
function advanceTurn(room) {
  if (room.phase === "waiting") nextTurn(room);
}

// ---------------- 见好就收 ----------------
function keep(room) {
  if (room.phase !== "choice") return false;
  const p = current(room);
  p.coins += room.pot;
  if (p.coins > p.peak) p.peak = p.coins;
  const got = room.pot;
  room.pot = 0;
  addLog(room, "💰 " + p.name + " 见好就收，落袋 " + got + " 风浪币（现共 " + p.coins + "）。", "big");
  nextTurn(room);
  return true;
}

// ---------------- 抵押借钱（玩家选物品 + 杠杆） ----------------
function doBorrow(room, itemIdx, levelKey) {
  if (room.phase !== "borrow") return false;
  const p = current(room);
  const lv = LEVERAGE[levelKey];
  if (!lv) return false;
  const item = p.collateral.splice(itemIdx, 1)[0];
  if (!item) return false;

  const amount = room.base * lv.mult;
  const success = Math.random() < lv.rate;
  if (success) {
    p.coins += amount;
    p.borrows++;
    p.debt += amount;
    if (p.coins > p.peak) p.peak = p.coins;
    addLog(room, "✅ " + p.name + " 抵押「" + item + "」换来 " + amount + " 风浪币（负债 +" + amount + "）。", "loan");
  } else {
    addLog(room, "❌ " + p.name + " 抵押「" + item + "」想借 " + amount + " 风浪币 —— 没批，东西也没了。", "loan");
  }

  room.pot = 0;
  if (p.coins <= 0 && p.collateral.length === 0) {
    p.alive = false;
    addLog(room, "💀 " + p.name + " 借不到钱，也没东西可押了，下桌。", "tail");
    room.phase = "waiting";
  } else if (p.coins <= 0) {
    room.phase = "borrow";
  } else {
    room.phase = "idle";
  }
  return true;
}

// ---------------- 中途撤离 ----------------
function quit(room, playerId) {
  const p = playerById(room, playerId);
  if (!p || !p.alive || room.phase === "over" || room.phase === "lobby") return false;
  const isCurrent = room.players[room.turn].id === playerId;
  const abandoned = isCurrent ? room.pot : 0;
  p.alive = false;
  addLog(room, "🚪 " + p.name + " 中途撤离，下桌。"
    + (abandoned > 0 ? "桌上那 " + abandoned + " 风浪币没人管，被浪收走。" : ""), "tail");
  if (endGameIfTooFew(room)) return true;
  if (isCurrent) nextTurn(room);
  return true;
}

// ---------------- 重开一局 ----------------
function rematch(room) {
  if (room.phase !== "over") return false;
  room.phase = "lobby";
  room.log = [];
  room.players.forEach((p) => { p.alive = true; p.connected = p.connected !== false; });
  addLog(room, "—— 准备再来一局，等人到齐后房主开局 ——", "dim");
  return true;
}

// ---------------- 结算排行：总资产 = 风浪币 - 负债 ----------------
function ranked(room) {
  return room.players
    .map((p) => Object.assign({}, p, { net: p.coins - p.debt }))
    .sort((a, b) => b.net - a.net);
}

// ---------------- 对外广播的公共状态 ----------------
function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    turn: room.turn,
    pot: room.pot,
    base: room.base,
    round: room.round,
    lastResult: room.lastResult,
    log: room.log.slice(-60),
    players: room.players.map((p) => ({
      id: p.id, name: p.name, color: p.color,
      coins: p.coins, debt: p.debt, collateral: p.collateral.slice(), alive: p.alive,
      streak: p.streak, bestStreak: p.bestStreak, peak: p.peak,
      wipeouts: p.wipeouts, borrows: p.borrows, connected: p.connected,
    })),
  };
}

module.exports = {
  LEVERAGE, COLORS,
  newRoom, addPlayer, dropPlayer, startGame,
  flip, push, settle, advanceTurn, keep, doBorrow, quit, rematch,
  ranked, publicState, current, playerById, aliveCount, shouldEndGame,
};
