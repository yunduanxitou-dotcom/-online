// ============================================================
// server.js —— 《大起大落》联机版 服务器（零依赖，只用 Node 自带模块）
// 跑法：node server.js  然后浏览器打开 http://localhost:3000
// 通信：浏览器用 fetch 发指令，服务器用 SSE 把状态推回每个客户端。
// ============================================================
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const engine = require("./engine");

const PORT = process.env.PORT || 3000;
const rooms = new Map();   // 房间码 -> room（含 streams: Set, nextId: number）

// ---------- 静态文件 ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function serveStatic(req, res) {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(__dirname, "public", p));
  if (!file.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- 工具 ----------
function json(res, obj, status) {
  res.writeHead(status || 200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

function genCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  return code;
}

// ---------- SSE 广播 ----------
function broadcast(room) {
  const msg = "data: " + JSON.stringify(engine.publicState(room)) + "\n\n";
  for (const res of room.streams) { try { res.write(msg); } catch (e) {} }
}

function handleStream(req, res, query) {
  const room = rooms.get(query.room);
  const pid = Number(query.playerId);
  if (!room || !room.players.some((x) => x.id === pid)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("room not found");
    return;
  }
  const player = room.players.find((x) => x.id === pid);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": ok\n\n");
  res.write("data: " + JSON.stringify(engine.publicState(room)) + "\n\n");

  // 连上 / 重连
  player.connected = true;
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  room.streams.add(res);
  broadcast(room);

  req.on("close", () => {
    room.streams.delete(res);
    player.connected = false;
    broadcast(room);
    // 15 秒宽限：没重连才按离场处理（手机切后台能缓口气）
    player.dropTimer = setTimeout(() => {
      if (!player.connected) {
        engine.dropPlayer(room, pid);
        broadcast(room);
      }
    }, 15000);
  });
}

// ---------- 操作分发（服务器权威 + 时间编排） ----------
function maybeAdvance(room) {
  if (room.phase === "waiting") {
    setTimeout(() => { engine.advanceTurn(room); broadcast(room); }, 700);
  }
}

function handleAction(room, pid, type, payload) {
  const p = engine.current(room);

  switch (type) {
    case "start":
      if (room.phase !== "lobby") return "不在大厅阶段";
      if (room.hostId !== pid) return "只有房主能开局";
      if (!engine.startGame(room)) return "至少 2 人才能开局";
      broadcast(room);
      return null;

    case "flip": {
      if (room.phase !== "idle") return "现在不能抛币";
      if (!p || p.id !== pid) return "还没轮到你";
      const result = engine.flip(room, payload.stake);
      if (result === null) return "押注无效";
      broadcast(room);
      setTimeout(() => {
        if (room.phase !== "flipping") return;   // 中途有人撤离，这次抛币作废
        engine.settle(room, result);
        broadcast(room);
        maybeAdvance(room);
      }, 1400);
      return null;
    }

    case "push": {
      if (room.phase !== "choice") return "现在不能继续浪";
      if (!p || p.id !== pid) return "还没轮到你";
      const result = engine.push(room);
      if (result === null) return "无法继续浪";
      broadcast(room);
      setTimeout(() => {
        if (room.phase !== "flipping") return;
        engine.settle(room, result);
        broadcast(room);
        maybeAdvance(room);
      }, 1400);
      return null;
    }

    case "keep":
      if (room.phase !== "choice") return "现在不能见好就收";
      if (!p || p.id !== pid) return "还没轮到你";
      engine.keep(room);
      broadcast(room);
      maybeAdvance(room);
      return null;

    case "borrow": {
      if (room.phase !== "borrow") return "现在不能借钱";
      if (!p || p.id !== pid) return "还没轮到你";
      if (!engine.doBorrow(room, payload.itemIdx, payload.levelKey)) return "借钱参数无效";
      broadcast(room);
      maybeAdvance(room);
      return null;
    }

    case "quit":
      if (room.phase === "lobby" || room.phase === "over") return "现在不能撤离";
      engine.quit(room, pid);
      broadcast(room);
      maybeAdvance(room);
      return null;

    case "rematch":
      if (room.phase !== "over") return "本局还没结束";
      if (room.hostId !== pid) return "只有房主能开下一局";
      engine.rematch(room);
      broadcast(room);
      return null;

    default:
      return "未知操作";
  }
}

// ---------- HTTP 主入口 ----------
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const pathname = u.pathname;

  // 健康检查（部署平台探测用）
  if (req.method === "GET" && pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  // 静态资源
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    if (pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    serveStatic(req, res);
    return;
  }

  // SSE 状态流
  if (req.method === "GET" && pathname === "/api/stream") {
    handleStream(req, res, u.query);
    return;
  }

  // 建房
  if (req.method === "POST" && pathname === "/api/create") {
    const body = await readBody(req);
    const name = String(body.name || "玩家").slice(0, 8) || "玩家";
    const code = genCode();
    const room = engine.newRoom(code, 0);
    room.streams = new Set();
    room.nextId = 0;
    const pid = room.nextId++;
    engine.addPlayer(room, pid, name);
    room.hostId = pid;
    rooms.set(code, room);
    json(res, { room: code, playerId: pid });
    return;
  }

  // 加入
  if (req.method === "POST" && pathname === "/api/join") {
    const body = await readBody(req);
    const code = String(body.room || "").trim();
    const name = String(body.name || "玩家").slice(0, 8) || "玩家";
    const room = rooms.get(code);
    if (!room) { json(res, { error: "房间不存在" }, 404); return; }
    if (room.phase !== "lobby") { json(res, { error: "游戏已开始，不能加入" }, 409); return; }
    if (room.players.length >= 6) { json(res, { error: "房间已满（最多 6 人）" }, 409); return; }
    const pid = room.nextId++;
    engine.addPlayer(room, pid, name);
    json(res, { room: code, playerId: pid });
    broadcast(room);
    return;
  }

  // 操作
  if (req.method === "POST" && pathname === "/api/action") {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || ""));
    const pid = Number(body.playerId);
    if (!room) { json(res, { error: "房间不存在" }, 404); return; }
    if (!room.players.some((x) => x.id === pid)) { json(res, { error: "你不是本房成员" }, 403); return; }
    const err = handleAction(room, pid, body.type, body.payload || {});
    if (err) { json(res, { error: err }, 400); return; }
    json(res, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log("==============================================");
  console.log("《大起大落》联机版 已启动");
  console.log("本机打开: http://localhost:" + PORT);
  console.log("同一 WiFi 的朋友用你的局域网 IP + 端口访问");
  console.log("==============================================");
});
