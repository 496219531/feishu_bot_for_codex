#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  getCodexTopLevelValue,
  loadCodexConfig,
  mapCodexProviderToHermes,
} from "./codex_config.mjs";

const PORT = Number(process.env.PORT || 8787);
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || process.env.APP_ID || "";
const FEISHU_APP_SECRET =
  process.env.FEISHU_APP_SECRET || process.env.APP_SECRET || "";
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || "";
const FEISHU_CONNECTION_MODE = (process.env.FEISHU_CONNECTION_MODE || "long")
  .trim()
  .toLowerCase();
const FEISHU_ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY || "";
const ALLOWED_OPEN_IDS = new Set(
  (process.env.ALLOWED_OPEN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const USER_DISPLAY_NAMES = parseUserDisplayNames(
  process.env.USER_DISPLAY_NAMES || "",
);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const CODEX_CONFIG = await loadCodexConfig();
const CODEX_MODEL = getCodexTopLevelValue(CODEX_CONFIG.data, "model");
const CODEX_PROVIDER = getCodexTopLevelValue(
  CODEX_CONFIG.data,
  "model_provider",
);
const HERMES_MODEL = process.env.HERMES_MODEL || CODEX_MODEL || "";
const HERMES_PROVIDER =
  process.env.HERMES_PROVIDER || mapCodexProviderToHermes(CODEX_PROVIDER) || "";
const HERMES_TOOLSETS = process.env.HERMES_TOOLSETS || "";
const HERMES_SKILLS = process.env.HERMES_SKILLS || "";
const HERMES_MAX_TURNS = Number(process.env.HERMES_MAX_TURNS || 90);
const HERMES_YOLO = /^(1|true|yes|on)$/i.test(process.env.HERMES_YOLO || "");
const BOT_RESTART_SCRIPT =
  process.env.BOT_RESTART_SCRIPT ||
  path.join(process.cwd(), "scripts", "feishu-hermes-self-restart.sh");
const STATE_FILE =
  process.env.STATE_FILE ||
  path.join(process.cwd(), ".feishu-hermes-bot-state.json");
const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS || 1800);

if (!FEISHU_APP_ID) {
  console.error("[fatal] Missing required env: FEISHU_APP_ID (or APP_ID)");
  process.exit(1);
}
if (!FEISHU_APP_SECRET) {
  console.error("[fatal] Missing required env: FEISHU_APP_SECRET (or APP_SECRET)");
  process.exit(1);
}

const state = {
  sessions: {},
};

let tokenCache = {
  value: "",
  expiresAtMs: 0,
};

const queue = [];
let running = false;
let currentTask = null;
let currentChild = null;
const recentEventIds = new Map();
const longConnState = {
  enabled: FEISHU_CONNECTION_MODE === "long",
  status: FEISHU_CONNECTION_MODE === "long" ? "starting" : "disabled",
  healthy: FEISHU_CONNECTION_MODE !== "long",
  startedAtMs: Date.now(),
  lastReadyAtMs: 0,
  lastReconnectAtMs: 0,
  lastEventAtMs: 0,
  lastErrorAtMs: 0,
  lastError: "",
  reconnectCount: 0,
};

process.on("unhandledRejection", (err) => {
  log("[fatal] unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  log("[fatal] uncaughtException:", err);
});

async function ensureStateLoaded() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data.sessions) {
      state.sessions = data.sessions;
    }
  } catch {
    await persistState();
  }
}

async function persistState() {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function log(...args) {
  const now = new Date().toISOString();
  console.log(now, ...args);
}

function parseUserDisplayNames(raw) {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([k, v]) => typeof k === "string" && typeof v === "string")
        .map(([k, v]) => [k.trim(), v.trim()])
        .filter(([k, v]) => k && v),
    );
  } catch (err) {
    console.error("[fatal] Invalid USER_DISPLAY_NAMES:", err);
    process.exit(1);
  }
}

async function getTenantAccessToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAtMs - 60_000) {
    return tokenCache.value;
  }

  const resp = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    },
  );

  const data = await resp.json();
  if (!resp.ok || data.code !== 0) {
    throw new Error(
      `get tenant_access_token failed: status=${resp.status} body=${JSON.stringify(data)}`,
    );
  }

  tokenCache = {
    value: data.tenant_access_token,
    expiresAtMs: now + (data.expire || 7200) * 1000,
  };
  return tokenCache.value;
}

function splitText(text, maxChars) {
  if (!text) return [""];
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + maxChars));
    i += maxChars;
  }
  return out;
}

async function sendFeishuText(chatId, text) {
  const token = await getTenantAccessToken();
  const chunks = splitText(text, MAX_TEXT_CHARS);

  for (const chunk of chunks) {
    const resp = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: chunk }),
        }),
      },
    );

    const data = await resp.json();
    if (!resp.ok || data.code !== 0) {
      throw new Error(
        `send message failed: status=${resp.status} body=${JSON.stringify(data)}`,
      );
    }
  }
}

function normalizeUserText(raw) {
  if (!raw) return "";
  return raw.replace(/<at\s+user_id="[^"]+">[^<]*<\/at>/g, "").trim();
}

function parseFeishuMessageText(content) {
  try {
    const parsed = JSON.parse(content);
    return normalizeUserText(parsed?.text || "");
  } catch {
    return normalizeUserText(content || "");
  }
}

function normalizeCommandText(raw) {
  if (!raw) return "";
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\u3000/g, " ")
    .replace(/^／/, "/")
    .trim()
    .replace(/^\/\s+/, "/")
    .replace(/\s+/g, " ");
}

function buildRuntimeContext({ senderName, senderOpenId }) {
  const lines = [
    "运行环境说明：你当前运行在本机 Hermes Agent 中。",
    "当前会话允许联网搜索和打开网页；如果用户的问题涉及最新信息、新闻、天气、价格、版本、文档、规则或要求你核实，请直接联网查询，不要声称自己无法联网。",
    "如果当前对话里出现过旧的“不能联网”表述，以这条最新运行环境说明为准。",
  ];

  if (senderName) {
    lines.push(`当前发消息的用户是：${senderName}`);
  }
  if (senderOpenId) {
    lines.push(`该用户的飞书 open_id 是：${senderOpenId}`);
  }

  return `${lines.join("\n")}\n\n用户消息：`;
}

async function runHermesTask(prompt, sessionId) {
  async function runOnce(resumeSessionId) {
    const args = [
      "chat",
      "-q",
      prompt,
      "-Q",
      "--accept-hooks",
      "--source",
      "tool",
    ];

    if (Number.isFinite(HERMES_MAX_TURNS) && HERMES_MAX_TURNS > 0) {
      args.push("--max-turns", String(HERMES_MAX_TURNS));
    }
    if (HERMES_MODEL) {
      args.push("-m", HERMES_MODEL);
    }
    if (HERMES_PROVIDER) {
      args.push("--provider", HERMES_PROVIDER);
    }
    if (HERMES_TOOLSETS) {
      args.push("-t", HERMES_TOOLSETS);
    }
    if (HERMES_SKILLS) {
      args.push("-s", HERMES_SKILLS);
    }
    if (HERMES_YOLO) {
      args.push("--yolo");
    }
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }

    return await new Promise((resolve) => {
      let stdoutBuffer = "";
      let stderrBuffer = "";

      const child = spawn(HERMES_BIN, args, {
        cwd: WORKSPACE_DIR,
        env: { ...process.env, HERMES_ACCEPT_HOOKS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      currentChild = child;

      child.stdout.on("data", (buf) => {
        stdoutBuffer += buf.toString("utf8");
      });

      child.stderr.on("data", (buf) => {
        stderrBuffer += buf.toString("utf8");
      });

      child.on("close", (code) => {
        currentChild = null;

        const combined = stripAnsi(`${stderrBuffer}\n${stdoutBuffer}`).replace(/\r/g, "");
        const sessionMatches = [...combined.matchAll(/^session_id:\s+(.+)$/gm)];
        const nextSessionId = sessionMatches.length > 0
          ? sessionMatches[sessionMatches.length - 1][1].trim()
          : (resumeSessionId || "");

        let finalText = stripHermesSessionNoise(stdoutBuffer);
        if (!finalText) {
          finalText = stripHermesSessionNoise(combined);
        }
        if (!finalText && code !== 0) {
          finalText = `执行失败 (exit=${code})\n${combined.slice(0, 1200)}`;
        }
        if (!finalText) {
          finalText = "已执行，但没有拿到可读回复。";
        }

        resolve({
          code,
          sessionId: nextSessionId,
          usage: null,
          text: finalText,
          combined,
        });
      });
    });
  }

  const firstResult = await runOnce(sessionId);
  if (sessionId && shouldRetryHermesFreshSession(firstResult)) {
    log(
      `[warn] stale hermes session detected, retrying fresh session: ${sessionId}`,
    );
    return await runOnce("");
  }

  return firstResult;
}

function stripAnsi(text) {
  return text.replace(/\[[0-9;]*[A-Za-z]/g, "");
}

function stripHermesSessionNoise(text) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("session_id:")) return false;
      if (trimmed.startsWith("↻ Resumed session ")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

function shouldRetryHermesFreshSession(result) {
  const combined = result?.combined || "";
  const text = result?.text || "";

  if (/Session not found:/i.test(combined)) {
    return true;
  }

  const resumedOnly =
    /↻ Resumed session /i.test(combined) &&
    /^session_id:\s+/m.test(combined) &&
    !stripHermesSessionNoise(combined);

  if (resumedOnly) {
    return true;
  }

  if (
    result?.code !== 0 &&
    (
      text === "已执行，但没有拿到可读回复。" ||
      /^执行失败 \(exit=\d+\)\s*$/m.test(text) ||
      !stripHermesSessionNoise(combined)
    )
  ) {
    return true;
  }

  return false;
}

async function scheduleBotRestart() {

  await fs.access(BOT_RESTART_SCRIPT);

  const child = spawn(BOT_RESTART_SCRIPT, [], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (err) => {
    log("[error] failed to spawn bot restart:", err);
  });
  child.unref();
}

function cleanupRecentEvents() {
  const now = Date.now();
  for (const [k, ts] of recentEventIds.entries()) {
    if (now - ts > 10 * 60 * 1000) {
      recentEventIds.delete(k);
    }
  }
}

async function handleUserText(task) {
  const { chatId, senderOpenId, senderName, text } = task;
  const conversationKey = `${chatId}:${senderOpenId}`;
  const commandText = normalizeCommandText(text);

  if (commandText === "/help") {
    await sendFeishuText(
      chatId,
      [
        "可用命令:",
        "/help 查看帮助",
        "/status 查看当前会话状态",
        "/whoami 查看你的 open_id（用于 ALLOWED_OPEN_IDS）",
        "/new 新建上下文（清空该会话 thread）",
        "/cancel 取消当前正在执行的任务",
        "/restartbot 重启长连接 bot",
        "",
        "直接发自然语言就是给 Hermes 的指令。",
      ].join("\n"),
    );
    return;
  }

  if (commandText === "/status") {
    const sid = state.sessions[conversationKey] || "(none)";
    const q = queue.length;
    const runningText = running ? "running" : "idle";
    await sendFeishuText(
      chatId,
      `状态:\nworkspace=${WORKSPACE_DIR}\nsession=${sid}\nqueue=${q}\nworker=${runningText}`,
    );
    return;
  }

  if (commandText === "/whoami" || commandText === "whoami") {
    log(
      `[whoami] chat_id=${chatId} open_id=${senderOpenId || "(empty)"} name=${senderName || "(empty)"} raw_text=${JSON.stringify(text)}`,
    );
    await sendFeishuText(
      chatId,
      [
        `name=${senderName || "(empty)"}`,
        `open_id=${senderOpenId || "(empty)"}`,
        `chat_id=${chatId}`,
      ].join("\n"),
    );
    return;
  }

  if (commandText === "/new") {
    delete state.sessions[conversationKey];
    await persistState();
    await sendFeishuText(chatId, "已重置上下文，下一条消息会开启新会话。");
    return;
  }

  if (commandText === "/cancel") {
    if (currentTask && currentTask.conversationKey === conversationKey && currentChild) {
      currentChild.kill("SIGTERM");
      await sendFeishuText(chatId, "已发送取消信号，任务正在停止。");
    } else {
      await sendFeishuText(chatId, "当前没有你可以取消的运行任务。");
    }
    return;
  }

  if (commandText === "/restartbot") {
    try {
      await fs.access(BOT_RESTART_SCRIPT);
      await sendFeishuText(
        chatId,
        "已安排长连接 bot 重启。当前队列会清空，约 3-5 秒恢复。",
      );
      queue.length = 0;
      if (currentChild) {
        currentChild.kill("SIGTERM");
      }
      await scheduleBotRestart();
    } catch (err) {
      await sendFeishuText(chatId, `安排 bot 重启失败: ${String(err)}`);
    }
    return;
  }

  if (running) {
    await sendFeishuText(chatId, `收到，已入队。前面还有 ${queue.length} 个任务。`);
  } else {
    await sendFeishuText(chatId, "收到，开始执行。");
  }

  queue.push({
    chatId,
    senderOpenId,
    senderName,
    conversationKey,
    prompt: text,
  });

  if (!running) {
    void processQueue();
  }
}

async function processQueue() {
  running = true;
  while (queue.length > 0) {
    const task = queue.shift();
    currentTask = task;
    const { chatId, conversationKey, prompt, senderName, senderOpenId } = task;
    const sessionId = state.sessions[conversationKey] || "";
    const promptWithUser = `${buildRuntimeContext({
      senderName,
      senderOpenId,
    })}\n${prompt}`;

    try {
      const result = await runHermesTask(promptWithUser, sessionId);
      if (result.sessionId) {
        state.sessions[conversationKey] = result.sessionId;
        await persistState();
      }

      let suffix = "";
      if (result.usage) {
        const inTok = result.usage.input_tokens ?? 0;
        const outTok = result.usage.output_tokens ?? 0;
        suffix = `\n\n[usage] input=${inTok}, output=${outTok}`;
      }
      await sendFeishuText(chatId, `${result.text}${suffix}`);
    } catch (err) {
      await sendFeishuText(chatId, `执行异常: ${String(err)}`);
    } finally {
      currentTask = null;
      currentChild = null;
    }
  }
  running = false;
}

function safeJson(res, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function rememberEvent(eventId) {
  if (!eventId) return false;
  cleanupRecentEvents();
  if (recentEventIds.has(eventId)) {
    return true;
  }
  recentEventIds.set(eventId, Date.now());
  return false;
}

function extractSenderOpenId(event) {
  return event?.sender?.sender_id?.open_id || event?.sender?.sender_id?.user_id || "";
}

async function enqueueFeishuTextEvent({
  eventId = "",
  chatId,
  senderOpenId,
  senderName,
  userText,
  source,
}) {
  if (eventId && rememberEvent(eventId)) {
    return;
  }

  if (ALLOWED_OPEN_IDS.size > 0 && !ALLOWED_OPEN_IDS.has(senderOpenId)) {
    log(`[skip] ${source} sender not allowed: ${senderOpenId || "(empty)"}`);
    return;
  }

  if (!chatId || !userText) {
    log(`[skip] ${source} missing chatId/text`);
    return;
  }

  log(
    `[recv:${source}] event=${eventId || "(none)"} chat_id=${chatId} open_id=${senderOpenId || "(empty)"} text=${JSON.stringify(userText)}`,
  );

  void handleUserText({
    chatId,
    senderOpenId,
    senderName,
    text: userText,
  }).catch((err) => log("[error] handleUserText failed:", err));
}

async function handleWebhookEvent(body) {
  if (body?.type === "url_verification" && body?.challenge) {
    if (FEISHU_VERIFICATION_TOKEN && body.token !== FEISHU_VERIFICATION_TOKEN) {
      return { challenge: "" };
    }
    return { challenge: body.challenge };
  }

  if (body?.schema !== "2.0") {
    return { code: 0 };
  }

  const header = body.header || {};
  const event = body.event || {};

  if (FEISHU_VERIFICATION_TOKEN && header.token !== FEISHU_VERIFICATION_TOKEN) {
    return { code: 0 };
  }

  if (header.event_type !== "im.message.receive_v1") {
    return { code: 0 };
  }

  if (event?.message?.message_type !== "text") {
    return { code: 0 };
  }

  const senderOpenId = extractSenderOpenId(event);
  const senderName = USER_DISPLAY_NAMES[senderOpenId] || "";
  const chatId = event?.message?.chat_id;
  const userText = parseFeishuMessageText(event?.message?.content);

  await enqueueFeishuTextEvent({
    eventId: header.event_id || event?.message?.message_id || "",
    chatId,
    senderOpenId,
    senderName,
    userText,
    source: "webhook",
  });

  return { code: 0 };
}

async function handleLongConnectionEvent(data) {
  markLongConnEvent();
  const message = data?.message || {};
  if (message?.message_type !== "text") {
    return;
  }

  const senderOpenId = extractSenderOpenId(data);
  const senderName = USER_DISPLAY_NAMES[senderOpenId] || data?.sender?.sender_type || "";
  const chatId = message?.chat_id;
  const userText = parseFeishuMessageText(message?.content);

  await enqueueFeishuTextEvent({
    eventId: message?.message_id || data?.event_id || "",
    chatId,
    senderOpenId,
    senderName,
    userText,
    source: "longconn",
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      return safeJson(res, {
        ok: true,
        running,
        queue: queue.length,
        mode: FEISHU_CONNECTION_MODE,
        longconn: getLongConnHealth(),
      });
    }

    if (req.method !== "POST" || req.url !== "/feishu/events") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const bodyText = await collectBody(req);
    const body = JSON.parse(bodyText || "{}");
    return safeJson(res, await handleWebhookEvent(body));
  } catch (err) {
    log("[error] request handling failed:", err);
    safeJson(res, { code: 0 });
  }
});

async function startLongConnectionClient() {
  const eventDispatcher = new lark.EventDispatcher(
    FEISHU_ENCRYPT_KEY ? { encryptKey: FEISHU_ENCRYPT_KEY } : {},
  ).register({
    "im.message.receive_v1": async (data) => {
      await handleLongConnectionEvent(data);
      return undefined;
    },
  });

  const wsClient = new lark.WSClient({
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    loggerLevel: lark.LoggerLevel.info,
    onReady: () => {
      markLongConnReady("ready");
    },
    onError: (err) => {
      markLongConnError(err);
    },
    onReconnecting: () => {
      markLongConnReconnecting();
    },
    onReconnected: () => {
      markLongConnReady("reconnected");
    },
  });

  await wsClient.start({ eventDispatcher });
  log("[ready] long connection client started");
}

function markLongConnReady(source) {
  const now = Date.now();
  longConnState.status = source;
  longConnState.healthy = true;
  longConnState.lastReadyAtMs = now;
  longConnState.lastError = "";
}

function markLongConnReconnecting() {
  longConnState.status = "reconnecting";
  longConnState.healthy = false;
  longConnState.lastReconnectAtMs = Date.now();
  longConnState.reconnectCount += 1;
}

function markLongConnError(err) {
  longConnState.status = "error";
  longConnState.healthy = false;
  longConnState.lastErrorAtMs = Date.now();
  longConnState.lastError = err instanceof Error ? err.message : String(err || "");
}

function markLongConnEvent() {
  longConnState.lastEventAtMs = Date.now();
}

function getLongConnHealth() {
  return {
    enabled: longConnState.enabled,
    status: longConnState.status,
    healthy: longConnState.healthy,
    started_at: toIso(longConnState.startedAtMs),
    last_ready_at: toIso(longConnState.lastReadyAtMs),
    last_reconnect_at: toIso(longConnState.lastReconnectAtMs),
    last_event_at: toIso(longConnState.lastEventAtMs),
    last_error_at: toIso(longConnState.lastErrorAtMs),
    last_error: longConnState.lastError || null,
    reconnect_count: longConnState.reconnectCount,
  };
}

function toIso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

await ensureStateLoaded();

server.listen(PORT, async () => {
  log(`[ready] Feishu Hermes bot listening on :${PORT}`);
  log(`[ready] mode: ${FEISHU_CONNECTION_MODE}`);
  if (FEISHU_CONNECTION_MODE === "long") {
    log(`[ready] health only: GET /healthz`);
  } else {
    log(`[ready] callback path: POST /feishu/events`);
  }
  log(`[ready] workspace: ${WORKSPACE_DIR}`);
  log(`[ready] hermes_bin: ${HERMES_BIN}`);
  log(
    `[ready] hermes_provider_source: ${
      process.env.HERMES_PROVIDER
        ? `env(${process.env.HERMES_PROVIDER})`
        : CODEX_PROVIDER
          ? `${CODEX_CONFIG.path} -> ${CODEX_PROVIDER}`
          : "(default)"
    }`,
  );
  log(
    `[ready] hermes_model_source: ${
      process.env.HERMES_MODEL
        ? `env(${process.env.HERMES_MODEL})`
        : CODEX_MODEL
          ? `${CODEX_CONFIG.path} -> ${CODEX_MODEL}`
          : "(default)"
    }`,
  );
  log(`[ready] hermes_provider: ${HERMES_PROVIDER || "(default)"}`);
  log(`[ready] hermes_model: ${HERMES_MODEL || "(default)"}`);
  log(`[ready] hermes_toolsets: ${HERMES_TOOLSETS || "(default)"}`);
  log(`[ready] hermes_max_turns: ${HERMES_MAX_TURNS}`);
  log(`[ready] hermes_yolo: ${HERMES_YOLO ? "on" : "off"}`);
  log(
    `[ready] allowed_open_ids: ${
      ALLOWED_OPEN_IDS.size > 0 ? [...ALLOWED_OPEN_IDS].join(",") : "(all)"
    }`,
  );

  if (FEISHU_CONNECTION_MODE === "long") {
    try {
      await startLongConnectionClient();
    } catch (err) {
      log("[fatal] failed to start long connection client:", err);
      process.exit(1);
    }
  }
});
