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
- `USER_DISPLAY_NAMES`（可选，按 `open_id -> 显示名` 注入给 Codex）

和 Codex 权限相关，建议额外关注:
- `CODEX_EXEC_MODE=config`：推荐；不再强制 `--full-auto`，改为读取 `~/.codex/config.toml` 和 Codex 默认配置
- `CODEX_EXEC_MODE=full-auto`：需要时再开启，等价于给 `codex exec` 追加 `--full-auto`
- `CODEX_MODEL=`：留空时直接使用 `~/.codex/config.toml` 里的模型；只有你明确想覆盖时才填写
- `CODEX_REASONING_EFFORT=`：留空时直接使用 `~/.codex/config.toml` 里的推理强度；只有你明确想覆盖时才填写

如果你希望飞书机器人和本机 `codex` 完全保持一致，建议：

- `CODEX_EXEC_MODE=config`
- 不设置 `CODEX_MODEL`
- 不设置 `CODEX_REASONING_EFFORT`

Hermes 机器人如果也要跟随这份配置，建议：

- 不设置 `HERMES_MODEL`
- 不设置 `HERMES_PROVIDER`
- 重启 `feishu-hermes` 后自动重新读取 `~/.codex/config.toml`

例如把某个飞书用户映射成“赵丹”：

```bash
USER_DISPLAY_NAMES='{"ou_xxxxxxxxxxxxx":"赵丹"}'
```

说明：
- 先让对应用户给 bot 发 `/whoami`，拿到 `open_id`
- 再把这个 `open_id` 配到 `USER_DISPLAY_NAMES`
- 重启 bot 后，消息会带着这个显示名注入给 Codex

## 3. 启动机器人

```bash
set -a; source .env.feishu; set +a
node feishu_codex_bot.mjs
```

默认监听 `8787` 端口，健康检查:

```bash
curl http://127.0.0.1:8787/healthz
```

默认推荐使用官方 SDK 长连接模式：

- 在 `.env.feishu` 中设置 `FEISHU_CONNECTION_MODE=long`
- 本机只需要出站联网，不需要公网回调地址
- 不需要 Cloudflare / ngrok / frp 之类 tunnel

## 4. 飞书后台配置

1. 开启机器人权限，订阅事件: `im.message.receive_v1`
2. 如果使用长连接模式：飞书后台无需配置公网请求地址，直接发布版本即可
3. 如果你仍想保留旧 webhook 模式，才需要配置：
   - `https://<你的公网域名>/feishu/events`
   - 或配合隧道工具把本地端口暴露出去（Cloudflare Tunnel / frp / ngrok）
4. 在飞书里给机器人发消息测试

## 5. 可用命令

- `/help` 查看帮助
- `/status` 查看会话状态（当前 thread、队列、worker）
- `/whoami` 查看你的 `open_id` 和 `chat_id`（方便配置白名单）
- `/new` 重置当前会话上下文（新建 thread）
- `/cancel` 取消当前运行任务
- `/restartbot` 重启 bot；当前默认长连接模式下不会再拉起 tunnel
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

当 `FEISHU_CONNECTION_MODE=long` 时，这些脚本只启动 bot，并自动停掉旧 tunnel 会话。

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

只重启 bot：

```bash
./scripts/feishu-bot-restart.sh
```

如果你希望 bot 自己安排一次重启，也可以在飞书里发:

```text
/restartbot
```

如果你想手工 `tmux` 方式，也可以继续用:

```bash
tmux new -s feishu-codex
set -a; source .env.feishu; set +a
node feishu_codex_bot.mjs
```

## 8. 安全建议

- 强烈建议配置 `ALLOWED_OPEN_IDS`
- 长连接模式下不需要公网回调，优先使用长连接
- `WORKSPACE_DIR` 只设置到你希望被操作的项目目录
