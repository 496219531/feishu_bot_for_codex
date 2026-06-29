# 飞书连接 Hermes 正统方案

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 用飞书官方应用机器人 + 官方 Node SDK 长连接，把 Hermes/Codex 接到飞书里，并且与现有 openclaw bot 完全隔离运行。

**Architecture:** 不走自定义机器人 webhook，也不依赖公网回调隧道。采用飞书开放平台应用机器人，订阅消息事件，使用 `@larksuiteoapi/node-sdk` 的长连接模式直接收事件；本地保留一个仅用于 `GET /healthz` 的健康检查端口。运行时通过独立 env、独立端口、独立 tmux session、独立日志、独立状态文件来实现和旧 bot 的硬隔离。

**Tech Stack:** Node.js 18+, `@larksuiteoapi/node-sdk`, tmux, 飞书开放平台应用机器人, 本地 `codex`/Hermes 执行器

---

## 一、推荐架构（老板要的“正统”）

1. 飞书侧：创建“应用机器人”，不是“自定义 webhook 机器人”
2. 订阅方式：选择“使用长连接接收事件/回调”
3. 本地侧：Node 进程启动官方 SDK websocket 长连接客户端
4. 消息处理：收到 `im.message.receive_v1` 后，转成本地 agent 指令
5. 状态持久化：按 `chat_id + sender_open_id` 维度保存 thread/session
6. 访问控制：用 `ALLOWED_OPEN_IDS` 做白名单
7. 运维：tmux 常驻 + `/healthz` + 独立日志

这套比 webhook + tunnel 更正统，原因就三条：
- 官方支持路径，少一层第三方隧道
- 不需要公网暴露 `/feishu/events`
- 和现有 openclaw bot 更容易彻底隔离

## 二、为什么不推荐旧 webhook/tunnel 方案

旧方案的问题：
- 依赖公网入口，稳定性取决于 cloudflared/ngrok/frp
- Quick tunnel URL 会漂移，飞书后台回调地址容易失效
- 本地 bot 没问题时，也可能因为 tunnel 坏掉导致“看起来像机器人挂了”
- 运维排障要分 bot / credential / tunnel 三层，麻烦

所以如果目标是“长期稳定地在飞书里聊 Hermes”，长连接就是优先解。

## 三、当前仓库里已经具备的关键落地点

已存在并可复用：
- `package.json`
- `feishu_codex_bot.mjs`
- `.env.feishu.hermes`
- `scripts/feishu-hermes-start.sh`
- `scripts/feishu-hermes-status.sh`
- `scripts/feishu-hermes-stop.sh`
- `feishu-hermes-bot.log`
- `.feishu-hermes-bot-state.json`

已具备的关键配置：
- 独立端口：`8788`
- 独立状态文件：`.feishu-hermes-bot-state.json`
- 长连接模式：`FEISHU_CONNECTION_MODE=long`
- 官方 SDK 依赖：`@larksuiteoapi/node-sdk`
- 白名单：`ALLOWED_OPEN_IDS`

## 四、标准实施方案

### Task 1: 飞书应用侧配置

**Objective:** 在飞书开放平台把机器人配置成可收消息的官方应用。

**Files:**
- Modify: 飞书开放平台后台配置（非仓库文件）

**Step 1: 创建或使用独立飞书应用**
- 选择“企业自建应用”
- 开启机器人能力
- 不与 openclaw 共用 app_id / app_secret

**Step 2: 开启权限与事件**
- 权限：机器人收发消息相关权限
- 事件：至少订阅 `im.message.receive_v1`

**Step 3: 订阅方式改为长连接**
- Developer Console
- Events and Callbacks
- Mode of event/callback subscription
- 选择：`Receive events/callbacks through persistent connection`

**Verification:**
- 飞书后台能看到应用已发布并启用机器人
- 订阅方式明确显示为“长连接”

### Task 2: 本地运行时隔离

**Objective:** 确保 Hermes bot 与旧 openclaw bot 不共享运行态。

**Files:**
- Modify: `.env.feishu.hermes`
- Use: `scripts/feishu-hermes-start.sh`
- Use: `scripts/feishu-hermes-status.sh`
- Use: `scripts/feishu-hermes-stop.sh`

**Step 1: 独立 env**
必须单独维护：
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `ALLOWED_OPEN_IDS`
- `PORT=8788`
- `STATE_FILE=/Users/hankangkang/Documents/feishu_bot_for_codex/.feishu-hermes-bot-state.json`
- `FEISHU_CONNECTION_MODE=long`

**Step 2: 独立进程与会话**
- bot tmux session：`feishu-hermes`
- tunnel tmux session：`feishu-hermes-tunnel`（长连接下应为空或停用）
- bot log：`feishu-hermes-bot.log`

**Step 3: 独立状态存储**
- Hermes bot 不复用 `.feishu-codex-bot-state.json`

**Verification:**
Run:
`./scripts/feishu-hermes-status.sh`

Expected:
- `[tmux] running (feishu-hermes)`
- `[mode] long connection via official Feishu SDK`
- `[tunnel] not required`

### Task 3: 本地 bot 启动与健康检查

**Objective:** 让本地 Hermes bot 稳定启动，并暴露健康检查。

**Files:**
- Use: `feishu_codex_bot.mjs`
- Use: `scripts/feishu-hermes-start.sh`

**Step 1: 启动 bot**
Run:
`cd /Users/hankangkang/Documents/feishu_bot_for_codex && ./scripts/feishu-hermes-start.sh`

**Step 2: 检查健康接口**
Run:
`curl -sS http://127.0.0.1:8788/healthz`

Expected:
- JSON 返回 `{"ok":true,...,"mode":"long"}`

**Step 3: 检查日志关键字**
关注日志出现：
- `event-dispatch is ready`
- `long connection client started`
- `ws client ready`

**Verification:**
bot log 中同时出现：
- `[ready] Feishu Codex bot listening on :8788`
- `[ready] mode: long`
- websocket ready 日志

### Task 4: 飞书消息闭环验证

**Objective:** 证明不是“进程活着”，而是真的能从飞书收到消息。

**Files:**
- Observe: `feishu-hermes-bot.log`

**Step 1: 私聊机器人发送测试消息**
发送：
- `你在吗`
- `/help`
- `/whoami`

**Step 2: 看日志是否收到事件**
期待日志包含：
- `[recv:longconn]`
- `chat_id=`
- `open_id=`
- `text="..."`

**Step 3: 如果收到了但没回复，先查白名单**
如果日志有：
- `[skip] longconn sender not allowed: ...`
说明不是连接问题，是 `ALLOWED_OPEN_IDS` 没配对。

**Verification:**
- 日志能看到真实入站事件
- 机器人能回消息
- `/whoami` 能拿到 `open_id`

### Task 5: 安全收口

**Objective:** 把“能用”提升成“可长期放心用”。

**Files:**
- Modify: `.env.feishu.hermes`
- Review: `README_FEISHU_BOT.md`

**Step 1: 锁白名单**
- `ALLOWED_OPEN_IDS` 只保留老板自己的 `open_id`

**Step 2: 工作目录最小化**
- `WORKSPACE_DIR` 只指向允许被 agent 操作的目录

**Step 3: 文档分流**
- 保留旧 README 讲 webhook 模式
- 新增一份文档专门讲 Hermes 长连接模式

**Verification:**
- 其他人给 bot 发消息不会触发执行
- 文档中能明确区分 webhook 模式与 long 模式

## 五、标准验收口径

只要下面 5 条同时成立，就算这套方案真正落地：

1. `./scripts/feishu-hermes-status.sh` 显示 bot running
2. `curl http://127.0.0.1:8788/healthz` 返回 `ok:true` 且 `mode: long`
3. 日志出现 `event-dispatch is ready`、`long connection client started`、`ws client ready`
4. 日志出现真实的 `[recv:longconn]` 入站消息
5. 机器人在飞书里能实际回复老板

## 六、当前机器上的实况判断

基于当前仓库和运行状态，这套“正统方案”不是纸面设计，而是已经基本跑通：
- 依赖已安装：`@larksuiteoapi/node-sdk`
- 独立 env 已存在：`.env.feishu.hermes`
- 端口已隔离：`8788`
- 状态文件已隔离：`.feishu-hermes-bot-state.json`
- status 脚本显示：`mode: long`
- bot 日志已出现 websocket ready
- bot 日志已出现真实 `[recv:longconn]` 消息

也就是说，老板现在最该做的不是重新造一套，而是：
1. 继续沿用这套 long connection 架构
2. 把 README 补成“webhook 旧方案 + long connection 新正统方案”双文档
3. 如需彻底品牌化，再把 bot 文案里的 `Codex` 字样清成 `Hermes`

## 七、我给老板的结论

如果老板要的是“正统、稳定、少折腾、和 openclaw 完全分开”的飞书连接方案，我的建议就一句：

`飞书官方应用机器人 + 官方 Node SDK 长连接 + 本地独立 Hermes 实例 + 白名单控制`。

这就是正解。webhook+tunnel 留作兼容，不要当主路径。