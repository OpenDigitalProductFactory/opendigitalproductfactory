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

/** DMR `_configure` GET response shape (array, one entry per backend/model). */
type DmrConfigureEntry = {
  Backend?: string;
  Model?: string;
  ModelID?: string;
  Mode?: string;
  Config?: { "context-size"?: number } & Record<string, unknown>;
};

export type ServedContextResult = {
  /** The served context window in tokens, or null when DMR doesn't report one. */
  contextTokens: number | null;
  /** False only when the configure endpoint isn't reachable/supported. */
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
      return { contextTokens: null, supported: false, reason: "Local runtime does not expose a context-size configuration API." };
    }
    if (!res.ok) {
      return { contextTokens: null, supported: false, reason: `Configure endpoint returned HTTP ${res.status}.` };
    }
    const body = (await res.json()) as DmrConfigureEntry[] | DmrConfigureEntry;
    const entries = Array.isArray(body) ? body : [body];
    for (const entry of entries) {
      const size = entry?.Config?.["context-size"];
      if (typeof size === "number" && size > 0) {
        return { contextTokens: size, supported: true, reason: null };
      }
    }
    // Endpoint exists but no runtime override is set for this model.
    return { contextTokens: null, supported: true, reason: null };
  } catch (err) {
    return { contextTokens: null, supported: false, reason: `Configure endpoint unreachable: ${(err as Error).message}` };
  }
}

/**
 * Set the served context window for a local model via DMR's configure API.
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
): Promise<ApplyContextResult> {
  const url = configureUrl(apiRoot);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, "context-size": contextTokens }),
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
