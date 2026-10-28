// apps/web/lib/inference/dmr-runtime-config.ts
//
// Read/write Docker Model Runner (DMR) per-model RUNTIME configuration — most
// importantly the served context window (`context-size`) — over DMR's HTTP API,
// so an operator can raise a local coding model to >= 22k tokens from the admin
// UX WITHOUT touching Docker.
//
// Why HTTP and not the CLI: `docker model configure --context-size N` is the
// supported host-side mechanism, but the portal image ships `/usr/bin/docker`
// WITHOUT the `docker model` CLI plugin (`docker: unknown command: docker
// model`). The CLI is a thin client over a model-runner HTTP endpoint that the
// portal CAN reach at the management root:
//
//   GET  /engines/_configure?model=<name>
//        -> [{ Backend, Model, ModelID, Mode, Config: { "context-size": N } }]
//   POST /engines/_configure   body: {"model":"<name>","context-size":<N>}
//
// (Contract captured live against docker-model-cli/v1.1.37 + Docker Desktop
// DMR, 2026-06-15 — re-verify on a DMR bump. The `_configure` path is an
// internal engines sub-route; treat a 404 as "this endpoint does not support
// runtime configuration" and degrade gracefully rather than throwing.)
//
// The model name is matched leniently by DMR (short `qwen3-coder`, `ai/...`,
// and the full `docker.io/ai/qwen3-coder:latest` tag all resolve), so callers
// pass the same model id the OpenAI `/v1/models` endpoint reports.
//
// `apiRoot` is the management root (NO `/v1` suffix) — callers compute it with
// `getOllamaApiRoot()`, which strips the OpenAI-compatible inference prefix.

import { createHash } from "node:crypto";
import { canonicalLocalModelKey, validateLocalModelReference } from "./local-model-management";
import type { LocalThinkingBudgetEvidence } from "@/lib/routing/types";

/** DMR `_configure` GET response shape (array, one entry per backend/model). */
type DmrConfigureEntry = {
  Backend?: string;
  Model?: string;
  ModelID?: string;
  Mode?: string;
  Config?: { "context-size"?: number; keep_alive?: string } & Record<string, unknown>;
};

/**
 * Keep the local generation runner resident (BI-34F71E9D). DMR honours
 * keep-alive only as stored per-model configuration (`keep_alive`, Go duration
 * or "-1" = never idle-evict); the `keep_alive` field DPF puts in OpenAI chat
 * bodies is ignored on that route. Without this, DMR's 5-minute default
 * unloads the model on every idle gap: the next turn re-reads the whole GGUF
 * from disk and re-prefills from a cold prompt cache. DMR still evicts an
 * unused resident runner under memory pressure, so this never strands VRAM.
 */
export const LOCAL_RUNNER_KEEP_ALIVE = "-1";

/** Config keys that set runner lifecycle only and cannot alter the template or parser. */
const LIFECYCLE_ONLY_CONFIG_KEYS = new Set(["context-size", "keep_alive"]);

export type ServedContextResult = {
  /** The served context window in tokens, or null when DMR doesn't report one. */
  contextTokens: number | null;
  /** The stored per-model keep_alive, or null when DMR applies its default. */
  keepAlive: string | null;
  /**
   * Every other stored key (runtime-flags, speculative, ...). DMR replaces the
   * whole config on each configure, so a context write must carry these back
   * or it silently drops an operator's or qualification run's settings.
   */
  retained?: Record<string, unknown>;
  /** False when configuration is unreachable, unsupported, or invalid. */
  supported: boolean;
  /** Human-readable detail when supported === false. */
  reason: string | null;
};

export type ApplyContextResult = {
  ok: boolean;
  /** Echoed served context after the write, when DMR reports it back. */
  contextTokens: number | null;
  reason: string | null;
};

function configureUrl(apiRoot: string): string {
  return `${apiRoot.replace(/\/$/, "")}/engines/_configure`;
}

/** Read-only support proof for the exact installed parser; never infer it from a provider label. */
export async function getLocalThinkingBudgetEvidence(
  apiRoot: string, model: string, fetchImpl: typeof fetch = fetch,
): Promise<LocalThinkingBudgetEvidence | undefined> {
  try {
    validateLocalModelReference(model);
    const root = apiRoot.replace(/\/$/, "");
    const read = async (url: string): Promise<unknown> => {
      const res = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error("Runtime evidence unavailable");
      return res.json();
    };
    const [configs, engines, metadata] = await Promise.all([
      read(`${configureUrl(root)}?model=${encodeURIComponent(model)}`),
      read(`${root}/engines/status`),
      read(`${root}/models/${model.split("/").map(encodeURIComponent).join("/")}`),
    ]);
    if (!Array.isArray(configs) || configs.length !== 1) return undefined;
    const entry = configs[0] as DmrConfigureEntry;
    if (entry?.Backend !== "llama.cpp" || entry.Mode !== "completion" ||
        typeof entry.Model !== "string" || canonicalLocalModelKey(entry.Model) !== canonicalLocalModelKey(model) ||
        !/^sha256:[a-f0-9]{64}$/.test(entry.ModelID ?? "")) return undefined;
    // Unknown flags may override the template/parser. A narrow observed config
    // is preferable to silently claiming support for an unverified override.
    if (!entry.Config || Object.keys(entry.Config).some(key => !LIFECYCLE_ONLY_CONFIG_KEYS.has(key))) return undefined;
    if (entry.Config.keep_alive !== undefined && typeof entry.Config.keep_alive !== "string") return undefined;
    const context = entry.Config["context-size"];
    if (context !== undefined && (typeof context !== "number" || !Number.isSafeInteger(context) || context <= 0)) return undefined;
    const statuses = engines as Record<string, unknown>;
    const identity = statuses?.["llama.cpp"];
    if (typeof identity !== "string" || !/^Running: llama\.cpp b9879(?:-|\s)/.test(identity) ||
        Object.entries(statuses).some(([key, value]) => key !== "llama.cpp" && typeof value === "string" && value.startsWith("Running"))) return undefined;
    const card = metadata as { id?: string; config?: { gguf?: Record<string, unknown> } };
    if (card?.id !== entry.ModelID) return undefined;
    const template = card.config?.gguf?.["tokenizer.chat_template"];
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    // Audited Qwen3.8 GGUF template captured without a trailing newline in the
    // adjacent regression fixture (2026-10-14). Arbitrary Jinja source text
    // cannot establish effective delimiters: comments and dead branches lie.
    // This is dialect recognition, not model-selection pinning or live quality.
    const templateDigest = typeof template === "string" ? digest(template) : null;
    if (templateDigest !== "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041") return undefined;
    return { dialect: "llama.cpp-b9879", modelDigest: entry.ModelID!, engineIdentity: identity,
      templateDigest, configDigest: digest(JSON.stringify(entry.Config)), observedAt: Date.now() };
  } catch { return undefined; }
}

/**
 * Read the runtime-configured served context window for a local model from DMR.
 *
 * Best-effort: returns `{ supported: false }` (never throws) when the endpoint
 * is missing (non-DMR local server, older DMR) or unreachable, so callers can
 * fall back to the `/v1/models`-reported context or the documented floor.
 */
export async function getServedContextTokens(
  apiRoot: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ServedContextResult> {
  const url = `${configureUrl(apiRoot)}?model=${encodeURIComponent(model)}`;
  try {
    const res = await fetchImpl(url, { method: "GET" });
    if (res.status === 404) {
      return { contextTokens: null, keepAlive: null, supported: false, reason: "Local runtime does not expose a context-size configuration API." };
    }
    if (!res.ok) {
      return { contextTokens: null, keepAlive: null, supported: false, reason: `Configure endpoint returned HTTP ${res.status}.` };
    }
    const body = (await res.json()) as DmrConfigureEntry[] | DmrConfigureEntry;
    const entries = Array.isArray(body) ? body : [body];
    for (const entry of entries) {
      const size = entry?.Config?.["context-size"];
      if (entry?.Config && Object.hasOwn(entry.Config, "context-size")) {
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
          return { contextTokens: null, keepAlive: null, supported: false, reason: "Configure endpoint returned invalid context capacity." };
        }
        const { "context-size": _size, keep_alive: storedKeepAlive, ...retained } = entry.Config;
        const keepAlive = typeof storedKeepAlive === "string" ? storedKeepAlive : null;
        return { contextTokens: size, keepAlive, retained, supported: true, reason: null };
      }
    }
    // Endpoint exists but no runtime override is set for this model.
    return { contextTokens: null, keepAlive: null, supported: true, reason: null };
  } catch (err) {
    return { contextTokens: null, keepAlive: null, supported: false, reason: `Configure endpoint unreachable: ${(err as Error).message}` };
  }
}

/**
 * Set the served context window for a local model via DMR's configure API,
 * keeping the runner resident (`LOCAL_RUNNER_KEEP_ALIVE`).
 *
 * The runtime config persists across model loads (it is stored by DMR, not the
 * loaded runner). A change takes effect the next time the model is loaded; DMR
 * refuses to reconfigure a model whose runner is already active ("runner
 * already active"), which is surfaced in `reason` so the caller can ask the
 * operator to retry once the model idles/unloads.
 */
export async function setServedContextTokens(
  apiRoot: string,
  model: string,
  contextTokens: number,
  fetchImpl: typeof fetch = fetch,
  /**
   * Other stored keys to keep (`ServedContextResult.retained`). Omitted, the
   * stored config is read first so a caller that only knows the context (the
   * Build Studio action) cannot drop runtime-flags or speculative settings.
   */
  retained?: Record<string, unknown>,
): Promise<ApplyContextResult> {
  const url = configureUrl(apiRoot);
  try {
    retained ??= (await getServedContextTokens(apiRoot, model, fetchImpl)).retained ?? {};
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // DMR replaces the stored per-model config on every configure, so the
      // residency setting and any retained keys travel with each context write.
      body: JSON.stringify({ ...retained, model, "context-size": contextTokens, keep_alive: LOCAL_RUNNER_KEEP_ALIVE }),
    });
    if (res.status === 404) {
      return { ok: false, contextTokens: null, reason: "Local runtime does not expose a context-size configuration API (Docker Model Runner update may be required)." };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = text.trim().slice(0, 300);
      return { ok: false, contextTokens: null, reason: `Configure request failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}.` };
    }
    // Confirm by reading the value back — DMR's POST body is often empty `{}`.
    const verify = await getServedContextTokens(apiRoot, model, fetchImpl);
    return { ok: true, contextTokens: verify.contextTokens, reason: null };
  } catch (err) {
    return { ok: false, contextTokens: null, reason: `Configure endpoint unreachable: ${(err as Error).message}` };
  }
}

/**
 * Keep the local embedder off the GPU (BI-B60AFE7B). DMR loads it with
 * `-ngl 999` by default; beside a generation model that fills the card, each
 * embedder load overcommits VRAM, Windows spills to shared memory and
 * generation decode collapses (~0.02 tok/s on a 24 GB 4090 for minutes). A
 * ~137M embedder on CPU costs ~0.1–0.5 s per request and no VRAM.
 *
 * Two modes are pinned, completion first: DMR preloads every configured model
 * through `/v1/chat/completions`, so an embedding-mode write alone would load
 * a default GPU completion copy. That path is CPU-only and unloads at once;
 * the embedding runner is CPU-only and resident.
 */
export const LOCAL_EMBEDDER_RUNTIME_FLAGS = ["--device", "none"] as const;

const EMBEDDER_MODE_CONFIG = [
  { mode: "completion", keepAlive: "0", echoes: ["0", "0s"] },
  { mode: "embedding", keepAlive: LOCAL_RUNNER_KEEP_ALIVE, echoes: [LOCAL_RUNNER_KEEP_ALIVE] },
] as const;

export type EmbedderPlacementResult = {
  status: "ok" | "applied" | "deferred" | "unsupported";
  reason: string | null;
};

export async function ensureLocalEmbedderOffGpu(
  apiRoot: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedderPlacementResult> {
  const url = configureUrl(apiRoot);
  try {
    const res = await fetchImpl(`${url}?model=${encodeURIComponent(model)}`, { method: "GET" });
    if (res.status === 404) return { status: "unsupported", reason: "Local runtime does not expose a configuration API." };
    if (!res.ok) return { status: "unsupported", reason: `Configure endpoint returned HTTP ${res.status}.` };
    const body = (await res.json()) as DmrConfigureEntry[] | DmrConfigureEntry;
    const entries = Array.isArray(body) ? body : [body];
    let wrote = false;
    for (const want of EMBEDDER_MODE_CONFIG) {
      const config = entries.find((entry) => entry?.Mode === want.mode)?.Config;
      const flags = config?.["runtime-flags"];
      const placed = Array.isArray(flags) && JSON.stringify(flags) === JSON.stringify(LOCAL_EMBEDDER_RUNTIME_FLAGS) &&
        (want.echoes as readonly string[]).includes(String(config?.keep_alive));
      if (placed) continue;
      const write = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, mode: want.mode, keep_alive: want.keepAlive, "runtime-flags": LOCAL_EMBEDDER_RUNTIME_FLAGS }),
      });
      if (!write.ok) {
        const detail = (await write.text().catch(() => "")).trim().slice(0, 300);
        return { status: "deferred", reason: `Configure ${want.mode} failed: HTTP ${write.status}${detail ? ` — ${detail}` : ""}.` };
      }
      wrote = true;
    }
    return { status: wrote ? "applied" : "ok", reason: null };
  } catch (err) {
    return { status: "unsupported", reason: `Configure endpoint unreachable: ${(err as Error).message}` };
  }
}
