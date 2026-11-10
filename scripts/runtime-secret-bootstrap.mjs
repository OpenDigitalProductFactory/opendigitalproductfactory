#!/usr/bin/env node

import { readFile as readFileFromDisk } from "node:fs/promises";
import { spawn as spawnChild } from "node:child_process";
import { pathToFileURL } from "node:url";
import { scriptArgv } from "./lib/script-argv.mjs";

const ALLOWED_SECRET_NAMES = new Set([
  "AUTH_SECRET",
  "CREDENTIAL_ENCRYPTION_KEY",
  "DATABASE_URL",
]);
const DEFAULT_SECRET_NAMES = ["AUTH_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

export class RuntimeSecretBootstrapError extends Error {
  constructor(code, { provider = "environment", secretName } = {}) {
    const details = [code, `provider=${provider}`];
    if (secretName) details.push(`name=${secretName}`);
    super(details.join(" "));
    this.name = "RuntimeSecretBootstrapError";
    this.code = code;
    this.provider = provider;
    this.secretName = secretName;
  }
}

function refuse(code, context) {
  throw new RuntimeSecretBootstrapError(code, context);
}

function selectedSecretNames(env, provider) {
  const configured = env.DPF_RUNTIME_SECRET_NAMES;
  if (configured === undefined || configured === "") return [...DEFAULT_SECRET_NAMES];

  const names = configured.split(",").map((name) => name.trim());
  if (names.some((name) => name.length === 0)) {
    refuse("secret-name-empty", { provider });
  }

  const seen = new Set();
  for (const name of names) {
    if (!ALLOWED_SECRET_NAMES.has(name)) {
      refuse("secret-name-unsupported", { provider, secretName: name });
    }
    if (seen.has(name)) {
      refuse("secret-name-duplicate", { provider, secretName: name });
    }
    seen.add(name);
  }
  return names;
}

function requiredString(env, key, code, provider) {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") refuse(code, { provider });
  return value.trim();
}

function timeoutMs(env, provider) {
  const raw = env.DPF_SECRET_PROVIDER_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) refuse("timeout-invalid", { provider });
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    refuse("timeout-invalid", { provider });
  }
  return parsed;
}

async function connectToken(env, readFile, provider) {
  const inlineToken = env.DPF_ONEPASSWORD_CONNECT_TOKEN;
  const tokenFile = env.DPF_ONEPASSWORD_CONNECT_TOKEN_FILE;
  const hasInline = typeof inlineToken === "string" && inlineToken.trim() !== "";
  const hasFile = typeof tokenFile === "string" && tokenFile.trim() !== "";

  if (hasInline && hasFile) refuse("connect-token-ambiguous", { provider });
  if (!hasInline && !hasFile) refuse("connect-token-missing", { provider });
  if (hasInline) return inlineToken.trim();

  try {
    const value = await readFile(tokenFile.trim(), "utf8");
    if (typeof value !== "string" || value.trim() === "") {
      refuse("connect-token-missing", { provider });
    }
    return value.trim();
  } catch (error) {
    if (error instanceof RuntimeSecretBootstrapError) throw error;
    refuse("connect-token-read", { provider });
  }
}

function connectHost(env, provider) {
  const raw = requiredString(
    env,
    "DPF_ONEPASSWORD_CONNECT_HOST",
    "connect-host-missing",
    provider,
  );
  let url;
  try {
    url = new URL(raw);
  } catch {
    refuse("connect-host-invalid", { provider });
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    refuse("connect-host-invalid", { provider });
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function environmentOverlay(env, names, provider) {
  const overlay = {};
  for (const name of names) {
    const value = env[name];
    if (typeof value !== "string" || value.length === 0) {
      refuse("secret-missing", { provider, secretName: name });
    }
    overlay[name] = value;
  }
  return overlay;
}

async function resolveOnePasswordConnect({ env, fetch, readFile, signal, names, provider }) {
  if (typeof fetch !== "function") refuse("connect-fetch-unavailable", { provider });

  const host = connectHost(env, provider);
  const vaultId = requiredString(
    env,
    "DPF_ONEPASSWORD_VAULT_ID",
    "connect-vault-missing",
    provider,
  );
  const itemId = requiredString(
    env,
    "DPF_ONEPASSWORD_ITEM_ID",
    "connect-item-missing",
    provider,
  );
  const token = await connectToken(env, readFile, provider);
  const controller = new AbortController();
  const timeout = timeoutMs(env, provider);
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeout);
  timer.unref?.();

  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  const url = new URL(host);
  const basePath = host.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/vaults/${encodeURIComponent(vaultId)}/items/${encodeURIComponent(itemId)}`;

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch {
    refuse(didTimeout ? "connect-timeout" : "connect-network", { provider });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abortFromCaller);
  }

  if (!response || response.ok !== true) refuse("connect-http", { provider });

  let body;
  try {
    body = await response.json();
  } catch {
    refuse("connect-json", { provider });
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.fields)) {
    refuse("connect-shape", { provider });
  }

  const overlay = {};
  for (const name of names) {
    const matches = body.fields.filter((field) => field?.label === name);
    if (matches.length === 0) refuse("secret-missing", { provider, secretName: name });
    if (matches.length > 1) refuse("secret-duplicate", { provider, secretName: name });
    const value = matches[0]?.value;
    if (typeof value !== "string" || value.length === 0) {
      refuse("secret-empty", { provider, secretName: name });
    }
    overlay[name] = value;
  }
  return overlay;
}

export async function resolveRuntimeSecrets({
  env = process.env,
  fetch = globalThis.fetch,
  readFile = readFileFromDisk,
  signal,
} = {}) {
  const configuredProvider = env.DPF_SECRET_PROVIDER;
  const provider =
    configuredProvider === undefined || configuredProvider.trim() === ""
      ? "environment"
      : configuredProvider.trim();
  if (provider !== "environment" && provider !== "onepassword-connect") {
    refuse("provider-unsupported", { provider });
  }

  const names = selectedSecretNames(env, provider);
  if (provider === "environment") return environmentOverlay(env, names, provider);
  return resolveOnePasswordConnect({ env, fetch, readFile, signal, names, provider });
}

function defaultSpawn(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, options);
    const forwardTerm = () => child.kill("SIGTERM");
    const forwardInterrupt = () => child.kill("SIGINT");
    const cleanup = () => {
      process.removeListener("SIGTERM", forwardTerm);
      process.removeListener("SIGINT", forwardInterrupt);
    };
    process.once("SIGTERM", forwardTerm);
    process.once("SIGINT", forwardInterrupt);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve({ code, signal });
    });
  });
}

export async function runRuntimeSecretCommand({
  argv,
  env = process.env,
  fetch = globalThis.fetch,
  readFile = readFileFromDisk,
  signal,
  spawn = defaultSpawn,
} = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv[0]) {
    refuse("command-missing", { provider: env.DPF_SECRET_PROVIDER || "environment" });
  }
  const overlay = await resolveRuntimeSecrets({ env, fetch, readFile, signal });
  const childEnv = { ...env, ...overlay };
  delete childEnv.DPF_ONEPASSWORD_CONNECT_TOKEN;
  return spawn(argv[0], argv.slice(1), {
    env: childEnv,
    stdio: "inherit",
  });
}

async function main() {
  const argv = scriptArgv();
  try {
    const result = await runRuntimeSecretCommand({ argv });
    if (result?.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = Number.isInteger(result?.code) ? result.code : 1;
  } catch (error) {
    if (error instanceof RuntimeSecretBootstrapError) {
      console.error(`[runtime-secret-bootstrap] FATAL: ${error.message}`);
    } else {
      console.error("[runtime-secret-bootstrap] FATAL: command-failed provider=unknown");
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
