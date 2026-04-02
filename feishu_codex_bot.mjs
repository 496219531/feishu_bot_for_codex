#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8787);
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || process.env.APP_ID || "";
const FEISHU_APP_SECRET =
  process.env.FEISHU_APP_SECRET || process.env.APP_SECRET || "";
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || "";
const ALLOWED_OPEN_IDS = new Set(
  (process.env.ALLOWED_OPEN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_MODEL = process.env.CODEX_MODEL || "";
const STATE_FILE =
  process.env.STATE_FILE ||
  path.join(process.cwd(), ".feishu-codex-bot-state.json");
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

async function runCodexTask(prompt, sessionId) {
  const tempFile = path.join(
    os.tmpdir(),
    `feishu-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const sharedArgs = [
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    tempFile,
    "--full-auto",
  ];
  if (CODEX_MODEL) {
    sharedArgs.push("--model", CODEX_MODEL);
  }

  const args = sessionId
    ? ["exec", "resume", ...sharedArgs, sessionId, prompt]
    : ["exec", ...sharedArgs, "--cd", WORKSPACE_DIR, prompt];

  let threadId = sessionId || "";
  let usage = null;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let fallbackText = "";

  const result = await new Promise((resolve) => {
    const child = spawn(CODEX_BIN, args, {
      cwd: WORKSPACE_DIR,
      env: { ...process.env, RUST_LOG: "error" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    currentChild = child;

    child.stdout.on("data", (buf) => {
      const text = buf.toString("utf8");
      stdoutBuffer += text;
      let idx;
      while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        if (!line.startsWith("{")) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "thread.started" && evt.thread_id) {
            threadId = evt.thread_id;
          }
          if (evt.type === "turn.completed" && evt.usage) {
            usage = evt.usage;
          }
          if (
            evt.type === "item.completed" &&
            evt.item?.type === "agent_message" &&
            typeof evt.item?.text === "string"
          ) {
            fallbackText = evt.item.text;
          }
        } catch {
          // ignore invalid json line
        }
      }
    });

    child.stderr.on("data", (buf) => {
      stderrBuffer += buf.toString("utf8");
    });

    child.on("close", async (code) => {
      currentChild = null;
      let finalText = "";
      try {
        finalText = (await fs.readFile(tempFile, "utf8")).trim();
      } catch {
        // ignore
      }
      try {
        await fs.unlink(tempFile);
      } catch {
        // ignore
      }

      if (!finalText) finalText = fallbackText;
      if (!finalText && code !== 0) {
        finalText = `执行失败 (exit=${code})\n${stderrBuffer.slice(0, 1200)}`;
      }
      if (!finalText) {
        finalText = "已执行，但没有拿到可读回复。";
      }

      resolve({
        code,
        threadId,
        usage,
        text: finalText,
      });
    });
  });

  return result;
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
  const { chatId, senderOpenId, text } = task;
  const conversationKey = `${chatId}:${senderOpenId}`;

  if (text === "/help") {
    await sendFeishuText(
      chatId,
      [
        "可用命令:",
        "/help 查看帮助",
        "/status 查看当前会话状态",
        "/whoami 查看你的 open_id（用于 ALLOWED_OPEN_IDS）",
        "/new 新建上下文（清空该会话 thread）",
        "/cancel 取消当前正在执行的任务",
        "",
        "直接发自然语言就是给 Codex 的指令。",
      ].join("\n"),
    );
    return;
  }

  if (text === "/status") {
    const sid = state.sessions[conversationKey] || "(none)";
    const q = queue.length;
    const runningText = running ? "running" : "idle";
    await sendFeishuText(
      chatId,
      `状态:\nworkspace=${WORKSPACE_DIR}\nthread=${sid}\nqueue=${q}\nworker=${runningText}`,
    );
    return;
  }

  if (text === "/whoami") {
    await sendFeishuText(
      chatId,
      `open_id=${senderOpenId || "(empty)"}\nchat_id=${chatId}`,
    );
    return;
  }

  if (text === "/new") {
    delete state.sessions[conversationKey];
    await persistState();
    await sendFeishuText(chatId, "已重置上下文，下一条消息会开启新会话。");
    return;
  }

  if (text === "/cancel") {
    if (currentTask && currentTask.conversationKey === conversationKey && currentChild) {
      currentChild.kill("SIGTERM");
      await sendFeishuText(chatId, "已发送取消信号，任务正在停止。");
    } else {
      await sendFeishuText(chatId, "当前没有你可以取消的运行任务。");
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
    const { chatId, conversationKey, prompt } = task;
    const sessionId = state.sessions[conversationKey] || "";

    try {
      const result = await runCodexTask(prompt, sessionId);
      if (result.threadId) {
        state.sessions[conversationKey] = result.threadId;
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      return safeJson(res, { ok: true, running, queue: queue.length });
    }

    if (req.method !== "POST" || req.url !== "/feishu/events") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const bodyText = await collectBody(req);
    const body = JSON.parse(bodyText || "{}");

    if (body?.type === "url_verification" && body?.challenge) {
      if (FEISHU_VERIFICATION_TOKEN && body.token !== FEISHU_VERIFICATION_TOKEN) {
        return safeJson(res, { challenge: "" });
      }
      return safeJson(res, { challenge: body.challenge });
    }

    if (body?.schema !== "2.0") {
      return safeJson(res, { code: 0 });
    }

    const header = body.header || {};
    const event = body.event || {};
    const eventId = header.event_id || "";
    if (eventId) {
      cleanupRecentEvents();
      if (recentEventIds.has(eventId)) {
        return safeJson(res, { code: 0 });
      }
      recentEventIds.set(eventId, Date.now());
    }

    if (FEISHU_VERIFICATION_TOKEN && header.token !== FEISHU_VERIFICATION_TOKEN) {
      return safeJson(res, { code: 0 });
    }

    if (header.event_type !== "im.message.receive_v1") {
      return safeJson(res, { code: 0 });
    }

    if (event?.message?.message_type !== "text") {
      return safeJson(res, { code: 0 });
    }

    const senderOpenId = event?.sender?.sender_id?.open_id || "";
    if (ALLOWED_OPEN_IDS.size > 0 && !ALLOWED_OPEN_IDS.has(senderOpenId)) {
      return safeJson(res, { code: 0 });
    }

    const chatId = event?.message?.chat_id;
    const userText = parseFeishuMessageText(event?.message?.content);
    if (!chatId || !userText) {
      return safeJson(res, { code: 0 });
    }

    void handleUserText({ chatId, senderOpenId, text: userText }).catch((err) =>
      log("[error] handleUserText failed:", err),
    );
    return safeJson(res, { code: 0 });
  } catch (err) {
    log("[error] request handling failed:", err);
    safeJson(res, { code: 0 });
  }
});

await ensureStateLoaded();

server.listen(PORT, () => {
  log(`[ready] Feishu Codex bot listening on :${PORT}`);
  log(`[ready] callback path: POST /feishu/events`);
  log(`[ready] workspace: ${WORKSPACE_DIR}`);
  log(
    `[ready] allowed_open_ids: ${
      ALLOWED_OPEN_IDS.size > 0 ? [...ALLOWED_OPEN_IDS].join(",") : "(all)"
    }`,
  );
});
