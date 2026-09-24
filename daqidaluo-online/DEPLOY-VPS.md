# 云服务器部署教程（命令行版）

目标：把《大起大落》联机版部署到一台云服务器上，朋友用公网 IP 就能玩。

> 前置：你得先买好一台**轻量应用服务器**（阿里云或腾讯云，Ubuntu 22.04 / Debian 12 镜像，2 核 2G 够用），并记下三样东西：
> - **公网 IP**（如 `123.45.67.89`）
> - **登录用户名**（阿里云轻量默认 `root`，腾讯云 Ubuntu 镜像默认 `ubuntu` 或 `root`）
> - **登录密码 / 密钥**

---

## 第 0 步：把游戏代码放到 GitHub 仓库

（如果之前为了 Render 已经传过了，跳过这步。）

把 `daqidaluo-online` 里这几个文件传到 GitHub 一个新仓库：
- `package.json`、`server.js`、`engine.js`
- `public/` 整个文件夹（index.html / client.js / style.css）

记下仓库地址，形如 `https://github.com/你的用户名/daluo-online.git`。

---

## 第 1 步：SSH 连上服务器

在你**自己电脑**上打开 **PowerShell**（Windows 自带），输入：

```powershell
ssh root@123.45.67.89
```

把 `root` 换成你的用户名、`123.45.67.89` 换成你的公网 IP。第一次连接会问 "yes/no"，输入 `yes`，然后输密码。

连上后，命令行提示符会变成服务器的（比如 `root@xxx:~#`），下面所有命令都在**这里**敲。

---

## 第 2 步：装 Node.js

先看看镜像有没有预装：

```bash
node -v
```

- **如果打印出版本号**（如 `v20.x`）→ 已装好，跳到第 3 步。
- **如果报 "command not found"** → 用下面命令装（国内镜像，稳）：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
nvm install 20
node -v
```

看到版本号即成功。

## 第 3 步：配 npm 国内镜像（加速）

```bash
npm config set registry https://registry.npmmirror.com
```

## 第 4 步：拉取游戏代码

```bash
git clone https://github.com/你的用户名/daluo-online.git
cd daluo-online
```

## 第 5 步：用 pm2 启动并保活

```bash
npm install -g pm2
pm2 start server.js --name daluo
pm2 save
pm2 startup
```

最后一条 `pm2 startup` 会打印出一行让你复制的命令，**复制它、回车**，这样服务器重启后游戏会自动恢复。

查看状态：`pm2 status`（看到 `online` 就对了）。

## 第 6 步：开放 3000 端口（在网页控制台，不是命令行）

回到你买服务器的**云控制台**（阿里云/腾讯云的网页）：

1. 找到这台服务器 → **防火墙 / 安全组**。
2. 添加一条规则：协议 **TCP**、端口 **3000**、来源 **0.0.0.0/0**（所有人）。
3. 保存。

> 漏了这步，朋友会打不开——这是最常见的坑。

## 第 7 步：测试

浏览器打开：

```
http://你的公网IP:3000
```

能打开建房页面，就成功了。把这个网址发给朋友，任何人都能玩。

---

## 常见问题

**Q：打不开？**
- 先确认第 6 步端口放行做了没有；
- 再 `pm2 status` 看进程是否 `online`；
- `pm2 logs daluo` 看报错。

**Q：想让网址不带 `:3000`？**
把服务器端口改成 80：先停掉 `pm2 delete daluo`，再 `PORT=80 pm2 start server.js --name daluo`，然后在安全组放行 80 端口。这样 `http://IP` 就能直接访问。（国内服务器用域名才需要备案，纯 IP 访问一般没事。）

**Q：更新代码后怎么重新部署？**
```bash
cd ~/daluo-online
git pull
pm2 restart daluo
```
