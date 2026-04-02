# Feishu -> Codex 本机执行机器人

这个脚本让你在飞书里发消息，直接驱动电脑上的 `codex` 在本地项目继续工作，并自动续接上下文。

## 1. 先决条件

- 本机可运行 `codex`（你这台机器已满足）
- Node.js 18+（你这台机器已满足）
- 飞书开放平台里创建了一个**应用机器人（事件订阅）**

说明:
- 如果你现在用的是「自定义机器人 Webhook」(只能发消息)，它不能接收聊天消息，无法驱动本机执行。
- 本方案依赖「应用机器人 + 事件订阅」接收消息事件。

## 2. 环境变量

最省事方式（推荐）：

```bash
./scripts/feishu-bot-init.sh
```

或者手工方式：

```bash
cp .env.feishu.example .env.feishu
```

编辑 `.env.feishu`，至少填这几个:

- `FEISHU_APP_ID`（等同于飞书的 App ID，也可用别名 `APP_ID`）
- `FEISHU_APP_SECRET`（等同于飞书的 App Secret，也可用别名 `APP_SECRET`）
- `WORKSPACE_DIR`（你的项目目录）

建议填:
- `FEISHU_VERIFICATION_TOKEN`
- `ALLOWED_OPEN_IDS`（只允许你自己的 open_id，避免他人触发）

## 3. 启动机器人

```bash
set -a; source .env.feishu; set +a
node feishu_codex_bot.mjs
```

默认监听 `8787` 端口，健康检查:

```bash
curl http://127.0.0.1:8787/healthz
```

## 4. 飞书后台配置

1. 开启机器人权限，订阅事件: `im.message.receive_v1`
2. 请求地址填:
   - `https://<你的公网域名>/feishu/events`
3. 如果你本机没有公网地址，用隧道工具把本地端口暴露出去（例如 Cloudflare Tunnel / frp / ngrok）
4. 在飞书里给机器人发消息测试

当前仓库已附带 Cloudflare quick tunnel 脚本：

```bash
./scripts/feishu-tunnel-start.sh
./scripts/feishu-tunnel-status.sh
```

看到公网地址后，把飞书事件订阅回调填成：

```bash
https://<你的trycloudflare域名>/feishu/events
```

注意:
- `trycloudflare` 是临时域名，重启隧道后 URL 可能变化
- 如果要固定域名，需要额外登录 Cloudflare 账户并配置 named tunnel，或登录 Tailscale 并启用 Funnel

## 5. 可用命令

- `/help` 查看帮助
- `/status` 查看会话状态（当前 thread、队列、worker）
- `/whoami` 查看你的 `open_id` 和 `chat_id`（方便配置白名单）
- `/new` 重置当前会话上下文（新建 thread）
- `/cancel` 取消当前运行任务
- 其他文本: 直接当成给 Codex 的指令

## 6. 会话续接机制

- 机器人会按 `chat_id + sender_open_id` 维度保存 `thread_id`
- 状态持久化在 `.feishu-codex-bot-state.json`
- 所以你在手机上连续发指令，会自动接着上一次上下文继续

## 7. 常驻运行（推荐）

一键脚本方式:

```bash
./scripts/feishu-stack-start.sh
./scripts/feishu-stack-status.sh
```

查看日志:

```bash
tail -f ./feishu-bot.log
```

进入 tmux 会话:

```bash
./scripts/feishu-bot-attach.sh
```

停止:

```bash
./scripts/feishu-stack-stop.sh
```

如果你想手工 `tmux` 方式，也可以继续用:

```bash
tmux new -s feishu-codex
set -a; source .env.feishu; set +a
node feishu_codex_bot.mjs
```

## 8. 安全建议

- 强烈建议配置 `ALLOWED_OPEN_IDS`
- 尽量不要把回调服务裸露在公网，优先走受控隧道
- `WORKSPACE_DIR` 只设置到你希望被操作的项目目录
