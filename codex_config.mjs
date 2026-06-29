import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_CODEX_CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");

export async function loadCodexConfig(configPath = DEFAULT_CODEX_CONFIG_PATH) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return {
      path: configPath,
      exists: true,
      data: parseSimpleToml(raw),
    };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return {
        path: configPath,
        exists: false,
        data: {},
      };
    }
    throw err;
  }
}

export function getCodexTopLevelValue(config, key) {
  if (!config || typeof config !== "object") {
    return "";
  }
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

export function mapCodexProviderToHermes(providerName) {
  const normalized = String(providerName || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const knownMappings = {
    auto: "auto",
    anthropic: "anthropic",
    arcee: "arcee",
    codex: "openai-codex",
    copilot: "copilot",
    "copilot-acp": "copilot-acp",
    gemini: "gemini",
    huggingface: "huggingface",
    kilocode: "kilocode",
    "kimi-coding": "kimi-coding",
    "kimi-coding-cn": "kimi-coding-cn",
    minimax: "minimax",
    "minimax-cn": "minimax-cn",
    nous: "nous",
    nvidia: "nvidia",
    ollama: "ollama-cloud",
    "ollama-cloud": "ollama-cloud",
    "openai-codex": "openai-codex",
    openrouter: "openrouter",
    stepfun: "stepfun",
    xai: "xai",
    xiaomi: "xiaomi",
    zai: "zai",
  };

  return knownMappings[normalized] || "";
}

function parseSimpleToml(raw) {
  const root = {};
  let currentTarget = root;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentTarget = ensureSection(root, sectionMatch[1].trim());
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }

    currentTarget[kvMatch[1]] = parseTomlValue(kvMatch[2]);
  }

  return root;
}

function ensureSection(root, dottedPath) {
  let node = root;
  for (const segment of dottedPath.split(".")) {
    if (!segment) {
      continue;
    }
    if (!node[segment] || typeof node[segment] !== "object" || Array.isArray(node[segment])) {
      node[segment] = {};
    }
    node = node[segment];
  }
  return node;
}

function parseTomlValue(rawValue) {
  const value = stripInlineComment(rawValue).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return value;
}

function stripInlineComment(value) {
  let inQuote = false;
  let quoteChar = "";
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
        quoteChar = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }
    if (char === "#") {
      return value.slice(0, i);
    }
  }

  return value;
}
