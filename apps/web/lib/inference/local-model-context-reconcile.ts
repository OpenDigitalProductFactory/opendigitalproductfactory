// apps/web/lib/inference/local-model-context-reconcile.ts
//
// Self-heal the local GENERATION model's served context window.
//
// Docker Model Runner stores a per-model `context-size` runtime override, but a
// Docker Desktop / DMR restart wipes it back to the model card's small default
// (qwen3-coder ships 4096). At 4096 EVERY local coworker turn overflows —
// `exceed_context_size_error: request (24234 tokens) exceeds context size (4096)`
// — because a real turn (capped tool surface + system prompt + history) is ~20k+.
// The first-run bootstrap raises it once (bootstrap-first-run.ts), but nothing
// re-asserts it, so the very first restart silently bricks every coworker.
//
// This reconcile re-asserts RECOMMENDED_BUILD_CONTEXT_TOKENS. It is wired into
// instrumentation `register()` to run on every boot (catches the common case:
// Docker Desktop restart restarts the portal too) plus a periodic net (catches a
// DMR-only restart while the portal stays up). Idempotent + best-effort: never
// throws, and only POSTs when the TRUE served context (read from DMR's
// `_configure` endpoint, NOT the static `/v1/models` metadata which always
// reports the 4k card default) is below target — so the steady state is two
// cheap GETs and zero writes.

import { prisma } from "@dpf/db";
import { getOllamaBaseUrl, getOllamaApiRoot } from "./ollama-url";
import {
  isEmbeddingModelId,
  RECOMMENDED_BUILD_CONTEXT_TOKENS,
  REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS,
  clampServedContextTokens,
  computeServedContextCeiling,
  isLocalServedContextEligibleForReasoning,
  parseHostMemory,
  recommendServedContextTokens,
  estimateModelVramGb,
  type HostMemory,
} from "./local-model-policy";
import { getServedContextTokens, setServedContextTokens } from "./dmr-runtime-config";
import type { LocalPresence } from "@/lib/routing/local-tool-ceiling";

/**
 * The host memory profile + installer-selected model, normalized from the
 * persisted `PlatformConfig.host_profile` (written at install by
 * detect-hardware.ts). This is the runtime VRAM/RAM source the served-context
 * sizing needs — Docker Model Runner does NOT report VRAM (`getOllamaHardwareInfo`
 * returns null), which is why sizing silently degraded to the flat floor before.
 * Best-effort: any read/parse failure returns null → callers degrade to the floor.
 */
export async function resolveHostMemoryProfile(): Promise<
  { host: HostMemory; selectedModel: string | null } | null
> {
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key: "host_profile" } });
    return parseHostMemory(row?.value ?? null);
  } catch {
    return null;
  }
}

/**
 * PlatformConfig key holding the operator-chosen served context (tokens) for the
 * local generation model. The reconcile target is this value (clamped) when set,
 * else RECOMMENDED_BUILD_CONTEXT_TOKENS. Stored here — NOT in ModelProfile — so it
 * survives model re-profiling, which periodically rewrites ModelProfile columns
 * from the model card's small default. First-run bootstrap seeds a host-aware
 * default; an operator can pin a specific value (e.g. raise a capable box to 128k
 * so the heaviest coworkers fit).
 */
export const LOCAL_SERVED_CONTEXT_CONFIG_KEY = "local.servedContextTokens";

/**
 * The reconcile target, RESOURCE-AWARE (BI-3E614946, revised BI-F4D3B9E9):
 *   - operator override present → clamped to `[floor, MAX_LOCAL_CONTEXT_TOKENS]`.
 *     An EXPLICIT pin is trusted above the estimated resource ceiling — the
 *     ceiling is a weights+KV estimate, and it measurably under-sizes MoE
 *     models (qwen3-coder 30B-A3B serves 40k on the 24 GB host the estimate
 *     capped at the 24k floor, hard-excluding every restricted-sensitivity
 *     coworker turn from its only eligible endpoint). The module contract has
 *     always named the override as "the mechanism for going higher"; when the
 *     pin exceeds the estimate we honor it and WARN loudly so the choice stays
 *     legible. DMR/llama.cpp degrades by offloading rather than hard-failing,
 *     and the reconcile's deferred/unreachable statuses catch a refused load.
 *   - no override → the resource-aware default sized to the host's VRAM/RAM budget
 *     minus model weights + headroom (`recommendServedContextTokens`), which itself
 *     returns the build floor when the host is unknown — a safe degrade.
 * Best-effort — any read error falls back to the floor so a DB hiccup never lowers
 * a healthy install below where it was.
 */
export async function resolveServedContextTarget(): Promise<number> {
  const profile = await resolveHostMemoryProfile();
  const host = profile?.host ?? null;
  const selectedModel = profile?.selectedModel ?? null;
  const ceiling = computeServedContextCeiling(host, selectedModel);

  try {
    const row = await prisma.platformConfig.findUnique({
      where: { key: LOCAL_SERVED_CONTEXT_CONFIG_KEY },
    });
    const raw =
      typeof row?.value === "number"
        ? row.value
        : typeof row?.value === "string"
          ? Number(row.value)
          : null;
    if (raw != null && Number.isFinite(raw)) {
      const pinned = clampServedContextTokens(Math.floor(raw));
      if (pinned > ceiling) {
        console.warn(
          `[local-model-context] operator pin ${pinned} tokens exceeds the estimated resource ceiling ${ceiling} ` +
            `for this host — honoring the pin (explicit operator choice; serving may offload layers). ` +
            `Lower ${LOCAL_SERVED_CONTEXT_CONFIG_KEY} if local inference degrades.`,
        );
      }
      return pinned;
    }
  } catch {
    // best-effort — fall through to the resource-aware default
  }

  // No override → resource-aware default (floor when the host is unknown).
  return host
    ? recommendServedContextTokens(host, selectedModel ? estimateModelVramGb(selectedModel) : null)
    : RECOMMENDED_BUILD_CONTEXT_TOKENS;
}

/**
 * Everything the Platform > AI surface needs to make the (previously invisible)
 * local served-context limit legible: the LIVE served window, the reconcile
 * target, the resource-aware ceiling, and — the SPOF flag — whether local clears
 * the reasoning-phase envelope or those phases are cloud-only on this
 * hardware/model. Best-effort; the served read has its own short timeouts.
 */
export async function resolveServedContextInfo(fetchImpl: typeof fetch = fetch): Promise<{
  served: number | null;
  target: number;
  ceiling: number;
  reasoningEnvelope: number;
  reasoningEligible: boolean;
  host: HostMemory | null;
  selectedModel: string | null;
}> {
  const profile = await resolveHostMemoryProfile();
  const host = profile?.host ?? null;
  const selectedModel = profile?.selectedModel ?? null;
  const [target, served] = await Promise.all([
    resolveServedContextTarget(),
    resolveLocalServedContextTokens(fetchImpl),
  ]);
  return {
    served,
    target,
    ceiling: computeServedContextCeiling(host, selectedModel),
    reasoningEnvelope: REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS,
    // Reflect reality when the live window is known; else the intended target.
    reasoningEligible: isLocalServedContextEligibleForReasoning(served ?? target),
    host,
    selectedModel,
  };
}

export type ContextReconcileStatus =
  | "raised" // was below target; override applied (and ModelProfile synced)
  | "ok" // already at/above target; no write
  | "deferred" // below target but DMR refused the write (runner active); applies on next load
  | "no-model" // no local generation model installed
  | "unsupported" // local runtime exposes no context-size configuration API
  | "unreachable"; // local runtime / models endpoint not reachable

export type ContextReconcileResult = {
  status: ContextReconcileStatus;
  modelId: string | null;
  /** Served context BEFORE the reconcile — null when DMR has no override set. */
  before: number | null;
  /** Served context AFTER the reconcile (target when raised). */
  after: number | null;
  reason: string | null;
};

/**
 * Ensure the local generation model serves at least the reconcile target — the
 * operator override (PlatformConfig) when set, else RECOMMENDED_BUILD_CONTEXT_TOKENS.
 * Best-effort and idempotent — safe to call on every boot and on an interval.
 *
 * Also REPAIRS the routing source of truth (ModelProfile.maxContextTokens) when
 * the served context already meets target but the DB column has drifted below it
 * (model re-profiling resets the column to the card's small default). Routing's
 * context-window filter reads that column, so a stale value silently excludes the
 * heaviest coworker even though DMR is serving plenty of context.
 */
export async function reconcileLocalModelContext(
  fetchImpl: typeof fetch = fetch,
): Promise<ContextReconcileResult> {
  const target = await resolveServedContextTarget();
  const none = (status: ContextReconcileStatus, reason: string | null): ContextReconcileResult => ({
    status,
    modelId: null,
    before: null,
    after: null,
    reason,
  });

  try {
    const oaiBase = getOllamaBaseUrl().replace(/\/$/, "");
    const apiRoot = getOllamaApiRoot();
    const modelsUrl = oaiBase.endsWith("/v1") ? `${oaiBase}/models` : `${oaiBase}/v1/models`;

    // Find the installed generation model (the embedder is left alone).
    let modelId: string | null = null;
    try {
      const res = await fetchImpl(modelsUrl, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return none("unreachable", `models endpoint returned HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      modelId = (body.data ?? []).find((m) => m.id && !isEmbeddingModelId(m.id))?.id ?? null;
    } catch (err) {
      return none("unreachable", `models endpoint unreachable: ${(err as Error).message}`);
    }
    if (!modelId) return none("no-model", "no local generation model installed");

    // TRUTH source for the served context — the `_configure` override, NOT the
    // static `/v1/models` context_window (which always reports the 4k card default).
    const served = await getServedContextTokens(apiRoot, modelId, fetchImpl);
    if (!served.supported) {
      return { status: "unsupported", modelId, before: null, after: null, reason: served.reason };
    }
    const before = served.contextTokens; // null = no override set (DMR default ~4k)
    if (before !== null && before >= target) {
      // DMR already serves enough. Repair the routing column if re-profiling has
      // drifted it below what is actually served — best-effort, conditional so the
      // steady state stays write-free.
      await prisma.modelProfile
        .updateMany({
          where: {
            providerId: { in: ["local", "ollama"] },
            modelId,
            OR: [{ maxContextTokens: null }, { maxContextTokens: { lt: before } }],
          },
          data: { maxContextTokens: before },
        })
        .catch(() => {});
      return { status: "ok", modelId, before, after: before, reason: null };
    }

    const applied = await setServedContextTokens(apiRoot, modelId, target, fetchImpl);
    if (!applied.ok) {
      // DMR refuses while a runner is active; the override applies on next load.
      return { status: "deferred", modelId, before, after: null, reason: applied.reason };
    }

    // Keep the routing source of truth (ModelProfile.maxContextTokens) consistent
    // with what DMR now serves. Best-effort — a DB hiccup must not fail the heal.
    await prisma.modelProfile
      .updateMany({
        where: { providerId: { in: ["local", "ollama"] }, modelId },
        data: { maxContextTokens: applied.contextTokens ?? target },
      })
      .catch(() => {});

    return {
      status: "raised",
      modelId,
      before,
      after: applied.contextTokens ?? target,
      reason: null,
    };
  } catch (err) {
    return none("unreachable", `context reconcile failed: ${(err as Error).message}`);
  }
}

/**
 * What a single probe of the local runtime established.
 *
 * The three cases are deliberately NOT collapsed (BI-A8BFEFCE): "DMR answered
 * and has no generation model" and "DMR did not answer" are different facts
 * about the install, and a consumer that treats the second as the first widens
 * the coworker tool surface past what the routing layer will let local run.
 */
type LocalGenerationProbe =
  | { status: "served"; modelId: string; contextTokens: number | null }
  | { status: "no-model" }
  | { status: "unreachable"; reason: string };

async function probeLocalGenerationModel(
  fetchImpl: typeof fetch = fetch,
): Promise<LocalGenerationProbe> {
  // Wrap so getServedContextTokens' internal GET also gets a timeout (it issues
  // its own fetch without a signal), so a hung DMR can never stall a coworker turn.
  const withTimeout: typeof fetch = (url, init) =>
    fetchImpl(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(2500) });
  try {
    const oaiBase = getOllamaBaseUrl().replace(/\/$/, "");
    const apiRoot = getOllamaApiRoot();
    const modelsUrl = oaiBase.endsWith("/v1") ? `${oaiBase}/models` : `${oaiBase}/v1/models`;
    let modelId: string | null = null;
    let cardDefault: number | null = null;
    try {
      const res = await withTimeout(modelsUrl, {});
      if (!res.ok) {
        return { status: "unreachable", reason: `models endpoint returned HTTP ${res.status}` };
      }
      const body = (await res.json()) as {
        data?: Array<{ id?: string; dmr?: { context_window?: number } }>;
      };
      const gen = (body.data ?? []).find((m) => m.id && !isEmbeddingModelId(m.id));
      modelId = gen?.id ?? null;
      cardDefault = typeof gen?.dmr?.context_window === "number" ? gen.dmr.context_window : null;
    } catch (err) {
      return { status: "unreachable", reason: `models endpoint unreachable: ${(err as Error).message}` };
    }
    // The endpoint answered cleanly and listed no generation model. That is a
    // POSITIVE finding of absence, not a failure to read.
    if (!modelId) return { status: "no-model" };
    const served = await getServedContextTokens(apiRoot, modelId, withTimeout);
    // Override wins; else the card default is what DMR actually serves right now.
    return { status: "served", modelId, contextTokens: served.contextTokens ?? cardDefault ?? null };
  } catch (err) {
    return { status: "unreachable", reason: `local probe failed: ${(err as Error).message}` };
  }
}

/**
 * The local generation model's EFFECTIVE served context in tokens — the DMR
 * runtime `_configure` override when set, else the model-card default (what DMR
 * actually serves with no override). Returns null when there is no reachable
 * local generation model (caller then applies no cap shrink).
 *
 * Read this — NOT `ModelProfile.maxContextTokens` — when sizing the per-turn
 * coworker tool cap: model discovery/profiling can reset the ModelProfile column
 * to null, which silently defeats the cap (it reads null → full 48 → overflow).
 * DMR is the source of truth. Best-effort with short timeouts; never throws.
 *
 * NOTE: a null here is AMBIGUOUS — it means "no window to size against", which
 * covers both an absent model and an unread probe. Anything deciding whether the
 * local CLIFF applies must call `resolveLocalServingPosture` instead; this
 * function is only safe for window-fit arithmetic (BI-A8BFEFCE).
 */
export async function resolveLocalServedContextTokens(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const probe = await probeLocalGenerationModel(fetchImpl);
  return probe.status === "served" ? probe.contextTokens : null;
}

/**
 * Served context PLUS an honest statement of whether a local generation model is
 * in the serving path at all.
 *
 * Why both, and why presence does not come from the probe alone (BI-A8BFEFCE):
 * the probe is a best-effort HTTP call on a 2500 ms timeout, and it runs on the
 * coworker hot path — exactly when DMR may be busy loading or generating. When
 * it fails, the install has not changed; only our knowledge of it has. Falling
 * back to the active local `ModelProfile` rows recovers the fact from the same
 * store routing uses to build the fallback chain, so a momentarily unreachable
 * runtime no longer reads as a cloud-only install.
 *
 * `unknown` is reserved for the case where BOTH reads failed. Consumers must
 * treat it as `present` — see `LocalPresence`.
 */
export async function resolveLocalServingPosture(
  fetchImpl: typeof fetch = fetch,
): Promise<{ servedContextTokens: number | null; presence: LocalPresence }> {
  const probe = await probeLocalGenerationModel(fetchImpl);
  if (probe.status === "served") {
    return { servedContextTokens: probe.contextTokens, presence: "present" };
  }
  if (probe.status === "no-model") {
    return { servedContextTokens: null, presence: "absent" };
  }

  // Probe unreachable — recover presence from the routing store rather than
  // guessing. A local generation profile that is active/degraded means local is
  // still a candidate endpoint, so the cliff must still bind.
  try {
    const profiles = await prisma.modelProfile.findMany({
      where: {
        providerId: { in: ["local", "ollama"] },
        modelStatus: { in: ["active", "degraded"] },
      },
      select: { modelId: true },
    });
    const hasGeneration = profiles.some((p) => p.modelId && !isEmbeddingModelId(p.modelId));
    console.warn(
      `[local-model-context] local probe unreachable (${probe.reason}); ` +
        `presence recovered from ModelProfile as ${hasGeneration ? "present" : "absent"}`,
    );
    return { servedContextTokens: null, presence: hasGeneration ? "present" : "absent" };
  } catch (err) {
    // Both reads failed. Fail SAFE: the cliff binds, so local stays eligible as
    // a fallback rather than being silently excluded by an oversized surface.
    console.warn(
      `[local-model-context] local posture unknown — probe unreachable (${probe.reason}) ` +
        `and ModelProfile read failed (${(err as Error).message}); treating local as present`,
    );
    return { servedContextTokens: null, presence: "unknown" };
  }
}
