# 远程联机部署指南

目标是让**不在同一 WiFi 的朋友**也能玩。两条路：

- **路线 A（今天就能测）**：用 Cloudflare 隧道，把本机服务器临时映射成一个公网网址，**不用注册任何账号**。
- **路线 B（永久网址）**：部署到 Render（免费），拿到固定网址。

---

## 路线 A：Cloudflare 临时隧道（零账号，几分钟）

1. 下载 `cloudflared`（选 Windows 版）：
   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   （或 GitHub releases：https://github.com/cloudflare/cloudflared/releases）
2. 先启动游戏服务器（命令行）：
   ```
   node server.js
   ```
3. 另开一个命令行，运行：
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
4. 它会打印出一行形如 `https://xxxx-xxxx.trycloudflare.com` 的网址。**把这个网址发给朋友，任何人点开都能玩。**

注意：这个网址是**随机 + 临时**的——关掉命令就失效，每次重开网址会变。适合快速测试，不适合长期使用。

---

## 路线 B：Render 免费部署（永久网址）

1. 把 `daqidaluo-online` 整个文件夹传到 GitHub 一个新仓库（和之前传网页版一样的操作，但这次传的是联机版那 6 个文件）。
2. 打开 render.com，用 GitHub 账号登录。
3. **New → Web Service**，选择你刚建的仓库。
4. 关键配置：
   - **Build Command**：留空（或填 `npm install`）
   - **Start Command**：`npm start`（= `node server.js`）
   - **Instance Type**：选 **Free**
5. 点 **Create Web Service**，等一两分钟，它会给出一个 `https://xxx.onrender.com` 的网址。**这个网址就能发给任何人。**

### Render 免费层的两个注意点

- **休眠**：15 分钟没人玩会睡，下次打开要等约 30~50 秒冷启动（页面会一直转，正常，等它醒）。
- **房间会丢**：免费实例重启后，还没结束的房间会消失（数据存在内存里）。不影响正常玩，只是重开。
