// apps/web/lib/integrate/opencode-dispatch.ts
// Dispatch build tasks to the OpenCode CLI (sst/opencode, npm `opencode-ai`)
// running inside the sandbox container, pointed at the install's own local
// OpenAI-compatible LLM endpoint (Docker Model Runner / Ollama / vLLM).
//
// This is the local-LLM equivalent of claude-dispatch.ts / codex-dispatch.ts /
// grok-dispatch.ts. Unlike those, it needs NO vendor credential: inference goes
// to the install's endpoint, so a build can run air-gapped and at zero token
// cost. The agent loop runs inside the sandbox like the other CLIs; only the
// model endpoint differs. See
// docs/superpowers/specs/2026-06-10-local-llm-build-agent-design.md.
//
// CLI contract (researched against opencode docs, 2026-06-10 — version-pinned,
// re-verify on bump):
//   opencode run --dir /workspace -m local/<model> --format json \
//     --dangerously-skip-permissions "<prompt>"
//   - prompt is a positional arg (POSIX `"$VAR"` expansion is not re-expanded,
//     so code with $/backticks is passed literally and safely);
//   - --dangerously-skip-permissions + config "permission":"allow" together
//     keep a TTY-less container from blocking on an `ask` permission;
//   - a custom OpenAI-compatible provider named "local" is configured via
//     ~/.config/opencode/opencode.json (no global OPENAI_BASE_URL override
//     exists; the provider must be declared).

import type { AssignedTask, SpecialistRole } from "./task-dependency-graph";
import { prisma } from "@dpf/db";
import {
  buildSpecialistInstructions,
  buildSpecialistTaskPrompt,
  ensureSandboxNodeUser,
  runSandboxAgentCli,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import { getOllamaBaseUrl } from "@/lib/inference/ollama-url";
import { getServedContextTokens } from "@/lib/inference/dmr-runtime-config";
import { NON_CHAT_MODEL_RE, isEmbeddingModelId } from "@/lib/inference/local-model-policy";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";
import { KNOWN_PROVIDER_MODELS } from "@/lib/routing/known-provider-models";
import { recordBuildDispatchAttempt } from "@/lib/build/dispatch-attempts";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { resolveBuildWorkdir } from "./sandbox/build-branch";
import { classifyProviderCapacity } from "@/lib/routing/provider-capacity";
import { withLocalInferenceLock } from "@/lib/queue/resource-lane";
import { recordProviderCapacityStatus } from "@/lib/routing/provider-capacity/store";

const DEFAULT_SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

const OPENCODE_TASK_TIMEOUT_MS = Number(process.env.OPENCODE_TASK_TIMEOUT_MS) || 1_800_000;       // 30 min — local inference is slower
const OPENCODE_SCHEMA_TASK_TIMEOUT_MS = Number(process.env.OPENCODE_SCHEMA_TASK_TIMEOUT_MS) || 2_400_000; // 40 min for schema tasks

// Real agent runs consume 39k–156k tokens; a serving context below this fails
// outright. Advisory floor — /v1/models rarely exposes context length, so this
// is enforced only when the endpoint reports it (see preflightLocalEndpoint).
export const OPENCODE_MIN_CONTEXT_TOKENS = Number(process.env.OPENCODE_MIN_CONTEXT_TOKENS) || 22_000;

// BI-B195F224 — local ContextOverflowError guard. When the endpoint reports a
// served n_ctx, reserve headroom for model output + agent-loop overhead so the
// assembled task prompt cannot push the request over the window mid-dispatch.
// Heuristic ~chars/4 matches tak/context-pressure and context-economy-metrics.
export const OPENCODE_CHARS_PER_TOKEN = 4;
export const OPENCODE_OUTPUT_RESERVE_RATIO = 0.15;
export const OPENCODE_OUTPUT_RESERVE_MIN_TOKENS = 2_048;
export const OPENCODE_OUTPUT_RESERVE_MAX_TOKENS = 8_192;
/** Minimum tokens left for the prompt after reserve (below this we fail early). */
export const OPENCODE_MIN_INPUT_BUDGET_TOKENS = 1_024;

const PRIOR_RESULTS_MARKER = "RESULTS FROM PRIOR TASKS:";
const PROJECT_CONTEXT_MARKER = "PROJECT CONTEXT:";
const TASK_CORE_MARKER = "CRITICAL:";

export type OpencodeResult = {
  content: string;
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
};

export type LocalEndpointPreflight = {
  ok: boolean;
  resolvedModel: string | null;
  models: string[];
  contextOk: boolean;       // false only when the endpoint reports a context below the floor
  reason: string | null;    // BLOCKED-classifiable message when ok === false
  /**
   * The authoritative served context window (tokens) read from the local
   * runtime's runtime-config API (Docker Model Runner /engines/_configure), when
   * available. null when the runtime does not report it. Distinct from the
   * /v1/models-advertised context, which on DMR is the artifact default, not the
   * runtime override.
   */
  servedContextTokens?: number | null;
  /**
   * Served context window the endpoint reported on /v1/models for the resolved
   * model, in tokens. null when the endpoint omits it (the common case).
   * Surfaced so the Model Selection & Runtime Health view can show e.g.
   * "served 4096 / needs >= 22000" rather than just a pass/fail.
   */
  reportedContextTokens: number | null;
  /**
   * Non-fatal advisories the operator should see (e.g. an embedding model was
   * selected, or the served context is below the agent floor). Surfaced in the
   * Build Runtime UX without forcing ok === false.
   */
  warnings?: string[];
};

// Embedding / non-chat classification is owned by the canonical local-model
// policy module (imported above). Re-exported here so existing importers (tests,
// the Runtime Health view) and this file's own callers keep their import path.
export { isEmbeddingModelId };

/**
 * Rewrite the portal's view of the local endpoint into one the sandbox
 * container can reach. The sandbox is a sibling container, so `localhost` /
 * `127.0.0.1` (the portal's loopback) must become `host.docker.internal`.
 * Docker-internal hostnames (e.g. model-runner.docker.internal) already resolve
 * from sibling containers and are left as-is. Override with
 * OPENCODE_SANDBOX_BASE_URL when the topology differs.
 *
 * @example
 * // Portal loopback rewritten for a sibling sandbox container:
 * sandboxReachableUrl("http://localhost:11434/v1");
 * // → "http://host.docker.internal:11434/v1"
 *
 * @example
 * // Docker-internal hostnames already resolve and pass through unchanged:
 * sandboxReachableUrl("http://model-runner.docker.internal/v1");
 * // → "http://model-runner.docker.internal/v1"
 */
export function sandboxReachableUrl(portalUrl: string): string {
  if (process.env.OPENCODE_SANDBOX_BASE_URL) return process.env.OPENCODE_SANDBOX_BASE_URL;
  return portalUrl.replace(/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/, "//host.docker.internal$2");
}

type OpenAiModelsResponse = {
  data?: Array<{ id?: string; context_length?: number; context_window?: number; max_context_length?: number }>;
};

/**
 * Health + model-presence preflight against the local OpenAI-compatible
 * endpoint, run from the PORTAL (which already reaches this endpoint for all
 * other inference — the sandbox rewrite is only for the in-container run).
 * Hard gate: the endpoint must return a model list, and the requested model (if
 * any) must be present. Context is enforced only when the endpoint reports it.
 */
/**
 * Pick a coding-capable model when none was explicitly requested.
 *
 * A local OpenAI-compatible endpoint (Docker Model Runner / Ollama) commonly
 * serves NON-chat models too — embeddings (nomic-embed, bge), rerankers, STT
 * (whisper). Blindly taking models[0] picked `nomic-embed-text` and dispatched
 * a build to an embedding model (it cannot follow a coding agent loop). Exclude
 * those classes and prefer an explicit coder model, then a qwen3 family model,
 * then any remaining chat model. Returns null only when nothing usable is served.
 */
/** True when a served model id looks like a non-chat model (embedding/rerank/STT/…).
 *  Shares NON_CHAT_MODEL_RE with isEmbeddingModelId; kept as the name the Runtime
 *  Health view (#2003) calls. */
export function isLikelyNonChatModel(model: string): boolean {
  return NON_CHAT_MODEL_RE.test(model);
}

export function pickDefaultCodingModel(models: string[]): string | null {
  const chatModels = models.filter((m) => !isLikelyNonChatModel(m));
  return (
    chatModels.find((m) => /coder|[-_]code\b|code[-_]/i.test(m)) ??
    chatModels.find((m) => /qwen3/i.test(m)) ??
    chatModels[0] ??
    null
  );
}

export async function preflightLocalEndpoint(
  portalBaseUrl: string,
  requestedModel: string,
  fetchImpl: typeof fetch = fetch,
  opts?: {
    /**
     * Also read the authoritative served context window from the runtime's
     * configure API (Docker Model Runner `/engines/_configure`) and enforce the
     * >= OPENCODE_MIN_CONTEXT_TOKENS floor against it. Off by default so the
     * pure model-list preflight stays a single call.
     */
    checkServedContext?: boolean;
  },
): Promise<LocalEndpointPreflight> {
  const base = portalBaseUrl.replace(/\/$/, "");
  const url = `${base}/models`;
  let body: OpenAiModelsResponse;
  try {
    const res = await fetchImpl(url, { method: "GET" });
    if (!res.ok) {
      return { ok: false, resolvedModel: null, models: [], contextOk: false, reason: `Local model endpoint ${url} returned HTTP ${res.status}. Is the local AI provider running?`, reportedContextTokens: null };
    }
    body = (await res.json()) as OpenAiModelsResponse;
  } catch (err) {
    return { ok: false, resolvedModel: null, models: [], contextOk: false, reason: `Local model endpoint ${url} is unreachable: ${(err as Error).message}`, reportedContextTokens: null };
  }

  const entries = Array.isArray(body.data) ? body.data : [];
  const models = entries.map((m) => m.id).filter((id): id is string => typeof id === "string");
  if (models.length === 0) {
    return { ok: false, resolvedModel: null, models, contextOk: false, reason: `Local model endpoint ${url} returned no models. Pull a coding model first (e.g. a qwen3-coder build).`, reportedContextTokens: null };
  }

  const requested = requestedModel.trim();
  const resolvedModel = requested && models.includes(requested)
    ? requested
    : requested
      ? null
      : pickDefaultCodingModel(models);

  if (!resolvedModel) {
    // Distinguish "you named a model we don't serve" from "you named nothing
    // and everything served is an embedding model" — the latter is the
    // nomic-embed footgun and deserves its own actionable message.
    if (!requested && models.every(isLikelyNonChatModel)) {
      return { ok: false, resolvedModel: null, models, contextOk: false, reason: `The local endpoint only serves embedding / non-chat models (${models.join(", ")}). Pull a CODING model (e.g. a qwen3-coder build) before running a build.`, reportedContextTokens: null };
    }
    return { ok: false, resolvedModel: null, models, contextOk: false, reason: `Requested model "${requested}" is not served by the local endpoint. Available: ${models.join(", ")}.`, reportedContextTokens: null };
  }

  const warnings: string[] = [];
  // (b) Warn when the operator explicitly selected an embedding model — it
  // cannot run a coding agent loop, even though it's served.
  if (requested && isEmbeddingModelId(resolvedModel)) {
    warnings.push(`"${resolvedModel}" looks like an embedding model — it cannot run a coding agent. Choose a coding model (e.g. a qwen3-coder build).`);
  }

  // Best-effort /v1/models context check: only enforced when the endpoint
  // reports a context length for the resolved model. Most OpenAI-compatible
  // /v1/models responses omit it (Docker Model Runner reports the artifact
  // default, not the runtime override), in which case we fall through to the
  // authoritative served-context read below.
  const entry = entries.find((m) => m.id === resolvedModel);
  const reported = entry?.context_length ?? entry?.context_window ?? entry?.max_context_length;

  // (a) Authoritative served-context read from the runtime configure API.
  // This is the real served window (e.g. a `docker model configure
  // --context-size 32768` override) that /v1/models does NOT reflect.
  let servedContextTokens: number | null = null;
  if (opts?.checkServedContext) {
    const apiRoot = base.replace(/\/(engines\/)?v1\/?$/, "");
    const served = await getServedContextTokens(apiRoot, resolvedModel, fetchImpl);
    servedContextTokens = served.contextTokens;
  }

  // Enforce the floor against the most authoritative number available: the
  // served-context override wins; otherwise the /v1/models-reported value.
  const effectiveContext = servedContextTokens ?? (typeof reported === "number" && reported > 0 ? reported : null);
  if (effectiveContext !== null && effectiveContext < OPENCODE_MIN_CONTEXT_TOKENS) {
    return {
      ok: false,
      resolvedModel,
      models,
      contextOk: false,
      servedContextTokens,
      warnings,
      reportedContextTokens: reported ?? null,
      reason: `Model "${resolvedModel}" serves only ${effectiveContext} context tokens; agent runs need >= ${OPENCODE_MIN_CONTEXT_TOKENS}. Raise the model's context window (Build Runtime > local model > context window) or pull a longer-context model.`,
    };
  }

  return { ok: true, resolvedModel, models, contextOk: true, servedContextTokens, warnings, reportedContextTokens: reported ?? null, reason: null };
}

export type OpencodeProviderConfigTarget = {
  providerSlug: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  model: string;
};

type OpencodeDispatchTarget = OpencodeProviderConfigTarget & {
  providerId: string;
  apiKeyValue: string;
  portalBaseUrl: string;
  sandboxBaseUrl: string;
  /**
   * Served context window (tokens) for local/ollama preflight, when known.
   * Used to trim the assembled task prompt before write (BI-B195F224).
   * null/undefined for remote OpenCode providers or when the runtime omits it.
   */
  servedContextTokens?: number | null;
};

/**
 * Rough prompt token estimate (~chars/4). Pure — matches the rest of the
 * context-economy surface so budgets are comparable across modules.
 */
export function estimatePromptTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / OPENCODE_CHARS_PER_TOKEN);
}

/**
 * Input-token budget = served window minus output/overhead reserve.
 * Reserve scales with window size, clamped to [MIN, MAX].
 */
export function computeInputTokenBudget(
  servedContextTokens: number,
  outputReserveTokens?: number,
): number {
  const reserve =
    typeof outputReserveTokens === "number" && outputReserveTokens >= 0
      ? outputReserveTokens
      : Math.min(
          OPENCODE_OUTPUT_RESERVE_MAX_TOKENS,
          Math.max(
            OPENCODE_OUTPUT_RESERVE_MIN_TOKENS,
            Math.floor(servedContextTokens * OPENCODE_OUTPUT_RESERVE_RATIO),
          ),
        );
  return Math.max(OPENCODE_MIN_INPUT_BUDGET_TOKENS, servedContextTokens - reserve);
}

export type TrimTaskPromptResult = {
  prompt: string;
  estimatedTokens: number;
  budgetTokens: number | null;
  trimmed: boolean;
  /** false when even the task core cannot fit the budget */
  fit: boolean;
  reason: string | null;
};

function shrinkSectionBody(prompt: string, marker: string, targetBodyChars: number): string {
  const idx = prompt.indexOf(marker);
  if (idx < 0) return prompt;
  const bodyStart = idx + marker.length;
  // Body runs until the next double-newline block that starts a known header,
  // or the CRITICAL task-core marker — keep structure intact.
  const after = prompt.slice(bodyStart);
  const nextHeaderMatch = after.search(
    /\n\n(?:RESULTS FROM PRIOR TASKS:|DPF BUILD DISCIPLINE|CRITICAL:|TASK:)/,
  );
  const bodyEnd = nextHeaderMatch >= 0 ? bodyStart + nextHeaderMatch : prompt.length;
  const body = prompt.slice(bodyStart, bodyEnd);
  if (body.length <= targetBodyChars) return prompt;
  const note =
    targetBodyChars <= 0
      ? "\n(omitted to fit local model context window)"
      : `\n${body.slice(0, Math.max(0, targetBodyChars - 48)).trimEnd()}\n…(trimmed to fit local model context window)`;
  return prompt.slice(0, bodyStart) + note + prompt.slice(bodyEnd);
}

/**
 * Fit an assembled specialist task prompt into the local model's served context
 * window (minus output reserve). Prefer trimming soft context first:
 *   1) RESULTS FROM PRIOR TASKS
 *   2) PROJECT CONTEXT
 * then hard-trim the pre-CRITICAL head if still over. Never drop the task core
 * (CRITICAL… through VERIFY); if that alone exceeds the budget, return fit:false
 * with an actionable "use cloud / raise context" message instead of a mid-run
 * ContextOverflowError (BI-B195F224).
 *
 * When servedContextTokens is null/undefined/<=0, the prompt is passed through
 * unchanged (remote OpenCode / unknown window).
 */
export function trimTaskPromptToContext(params: {
  prompt: string;
  servedContextTokens: number | null | undefined;
  outputReserveTokens?: number;
}): TrimTaskPromptResult {
  const prompt = params.prompt ?? "";
  const estimated = estimatePromptTokens(prompt);
  const served = params.servedContextTokens;

  if (served == null || served <= 0) {
    return {
      prompt,
      estimatedTokens: estimated,
      budgetTokens: null,
      trimmed: false,
      fit: true,
      reason: null,
    };
  }

  const budget = computeInputTokenBudget(served, params.outputReserveTokens);
  const budgetChars = budget * OPENCODE_CHARS_PER_TOKEN;

  if (estimated <= budget) {
    return {
      prompt,
      estimatedTokens: estimated,
      budgetTokens: budget,
      trimmed: false,
      fit: true,
      reason: null,
    };
  }

  let next = prompt;
  let trimmed = false;

  // 1) Drop / shrink prior-results first (most disposable on later tasks).
  if (estimatePromptTokens(next) > budget && next.includes(PRIOR_RESULTS_MARKER)) {
    const overChars = estimatePromptTokens(next) * OPENCODE_CHARS_PER_TOKEN - budgetChars;
    const idx = next.indexOf(PRIOR_RESULTS_MARKER);
    const after = next.slice(idx + PRIOR_RESULTS_MARKER.length);
    const nextHeaderMatch = after.search(/\n\n(?:DPF BUILD DISCIPLINE|CRITICAL:|TASK:)/);
    const bodyLen = nextHeaderMatch >= 0 ? nextHeaderMatch : after.length;
    const targetBody = Math.max(0, bodyLen - overChars - 64);
    next = shrinkSectionBody(next, PRIOR_RESULTS_MARKER, targetBody);
    trimmed = true;
  }

  // 2) Shrink PROJECT CONTEXT.
  if (estimatePromptTokens(next) > budget && next.includes(PROJECT_CONTEXT_MARKER)) {
    const overChars = estimatePromptTokens(next) * OPENCODE_CHARS_PER_TOKEN - budgetChars;
    const idx = next.indexOf(PROJECT_CONTEXT_MARKER);
    const after = next.slice(idx + PROJECT_CONTEXT_MARKER.length);
    const nextHeaderMatch = after.search(
      /\n\n(?:RESULTS FROM PRIOR TASKS:|DPF BUILD DISCIPLINE|CRITICAL:|TASK:)/,
    );
    const bodyLen = nextHeaderMatch >= 0 ? nextHeaderMatch : after.length;
    const targetBody = Math.max(0, bodyLen - overChars - 64);
    next = shrinkSectionBody(next, PROJECT_CONTEXT_MARKER, targetBody);
    trimmed = true;
  }

  // 3) If still over, hard-trim the pre-CRITICAL head (role + discipline) while
  // keeping the task core intact.
  const coreIdx = next.indexOf(TASK_CORE_MARKER);
  if (estimatePromptTokens(next) > budget && coreIdx > 0) {
    const core = next.slice(coreIdx);
    const coreTokens = estimatePromptTokens(core);
    if (coreTokens >= budget) {
      // Core alone does not fit — fail closed with an actionable message.
      return {
        prompt: next,
        estimatedTokens: estimatePromptTokens(next),
        budgetTokens: budget,
        trimmed: true,
        fit: false,
        reason:
          `Task prompt core (~${coreTokens} tokens) exceeds the local model input budget ` +
          `(${budget} of ${served} served context tokens after output reserve). ` +
          `Raise the local context window (Build Runtime > local model) or route this build to a cloud coding model.`,
      };
    }
    const headBudgetChars = (budget - coreTokens) * OPENCODE_CHARS_PER_TOKEN;
    const head = next.slice(0, coreIdx);
    const keptHead =
      headBudgetChars <= 80
        ? "(role context trimmed to fit local model window)\n\n"
        : `${head.slice(0, Math.max(0, headBudgetChars - 60)).trimEnd()}\n…(trimmed to fit local model context window)\n\n`;
    next = keptHead + core;
    trimmed = true;
  }

  const finalTokens = estimatePromptTokens(next);
  if (finalTokens > budget) {
    // No CRITICAL marker or still over after best-effort trim — fail early.
    return {
      prompt: next,
      estimatedTokens: finalTokens,
      budgetTokens: budget,
      trimmed: true,
      fit: false,
      reason:
        `Assembled task prompt (~${finalTokens} tokens) exceeds the local model input budget ` +
        `(${budget} of ${served} served context tokens after output reserve). ` +
        `Raise the local context window or route this build to a cloud coding model.`,
    };
  }

  return {
    prompt: next,
    estimatedTokens: finalTokens,
    budgetTokens: budget,
    trimmed,
    fit: true,
    reason: null,
  };
}

function localOpencodeTarget(sandboxBaseUrl: string, model: string): OpencodeProviderConfigTarget {
  return {
    providerSlug: "local",
    displayName: "DPF Local",
    baseUrl: sandboxBaseUrl,
    apiKeyEnvVar: "OPENCODE_LOCAL_KEY",
    model,
  };
}

/**
 * Build the opencode.json that declares an OpenAI-compatible provider.
 * The two-argument form preserves the install's local endpoint contract; the
 * target-object form lets Build Studio point OpenCode at credentialed remote
 * coding endpoints without reusing the local provider slot.
 */
export function buildOpencodeConfig(sandboxBaseUrl: string, model: string): string;
export function buildOpencodeConfig(target: OpencodeProviderConfigTarget): string;
export function buildOpencodeConfig(
  targetOrSandboxBaseUrl: string | OpencodeProviderConfigTarget,
  maybeModel?: string,
): string {
  const target =
    typeof targetOrSandboxBaseUrl === "string"
      ? localOpencodeTarget(targetOrSandboxBaseUrl, maybeModel ?? "")
      : targetOrSandboxBaseUrl;

  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    provider: {
      [target.providerSlug]: {
        npm: "@ai-sdk/openai-compatible",
        name: target.displayName,
        options: {
          baseURL: target.baseUrl,
          apiKey: `{env:${target.apiKeyEnvVar}}`,
        },
        models: { [target.model]: { name: target.model } },
      },
    },
    model: `${target.providerSlug}/${target.model}`,
    permission: "allow",
  });
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildOpencodeRunnerScript(args: {
  workdir: string;
  promptFile: string;
  runnerScript: string;
  providerSlug: string;
  model: string;
  apiKeyEnvVar: string;
  apiKeyValue: string;
}): string {
  const modelRef = `${args.providerSlug}/${args.model}`;
  return [
    "#!/bin/sh",
    "set -e",
    `cleanup() { rm -f ${shellSingleQuote(args.promptFile)} ${shellSingleQuote(args.runnerScript)} 2>/dev/null || true; }`,
    "trap cleanup EXIT INT TERM",
    `cd ${shellSingleQuote(args.workdir)}`,
    `export ${args.apiKeyEnvVar}=${shellSingleQuote(args.apiKeyValue)}`,
    // POSIX: the result of $(...) expansion assigned to PROMPT is NOT re-expanded
    // when referenced as "$PROMPT", so code containing $ or backticks is safe.
    `PROMPT=$(cat ${shellSingleQuote(args.promptFile)})`,
    `opencode run --dir ${shellSingleQuote(args.workdir)} -m ${shellSingleQuote(modelRef)} --format json --dangerously-skip-permissions "$PROMPT"`,
    "cleanup",
  ].join("\n");
}

export async function recordOpencodeCapacityFailure(args: {
  providerId: string;
  output: string;
  statusCode?: number;
}): Promise<void> {
  const classification = classifyProviderCapacity({
    providerId: args.providerId,
    statusCode: args.statusCode ?? 429,
    bodyText: args.output,
    errorMessage: args.output,
    now: new Date(),
  });

  if (classification.state === "unknown") return;

  await recordProviderCapacityStatus({
    providerId: args.providerId,
    source: "opencode",
    classification,
    rawSnippet: args.output,
  });
}

function defaultKnownOpencodeModel(providerId: string): string | null {
  const models = KNOWN_PROVIDER_MODELS[providerId] ?? [];
  return models.find((model) => model.defaultStatus === "active")?.modelId ?? models[0]?.modelId ?? null;
}

async function resolveOpencodeDispatchTarget(params: {
  providerId: string;
  requestedModel: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; target: OpencodeDispatchTarget } | { ok: false; reason: string }> {
  const providerId = params.providerId || "local";
  const requestedModel = params.requestedModel.trim();

  if (providerId === "local" || providerId === "ollama") {
    const portalBaseUrl = getOllamaBaseUrl().replace(/\/$/, "");
    const sandboxBaseUrl = sandboxReachableUrl(portalBaseUrl);
    const pre = await preflightLocalEndpoint(portalBaseUrl, requestedModel, params.fetchImpl, { checkServedContext: true });
    if (!pre.ok || !pre.resolvedModel) {
      return { ok: false, reason: pre.reason ?? "local endpoint preflight failed" };
    }
    return {
      ok: true,
      target: {
        ...localOpencodeTarget(sandboxBaseUrl, pre.resolvedModel),
        providerId,
        apiKeyValue: "local",
        portalBaseUrl,
        sandboxBaseUrl,
        // Prefer the authoritative DMR served window; fall back to /v1/models
        // when the configure API is unavailable (BI-B195F224 trim path).
        servedContextTokens: pre.servedContextTokens ?? pre.reportedContextTokens ?? null,
      },
    };
  }

  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { providerId: true, name: true, baseUrl: true, cliEngine: true },
  });
  if (!provider || provider.cliEngine !== "opencode") {
    return { ok: false, reason: `Provider "${providerId}" is not configured as an OpenCode provider.` };
  }
  if (!provider.baseUrl) {
    return { ok: false, reason: `Provider "${providerId}" does not have an OpenCode base URL configured.` };
  }

  const credential = await getDecryptedCredential(providerId);
  if (!credential?.secretRef) {
    return { ok: false, reason: `Provider "${providerId}" needs an API key before OpenCode dispatch can run.` };
  }

  const model = requestedModel || defaultKnownOpencodeModel(providerId);
  if (!model) {
    return { ok: false, reason: `Provider "${providerId}" has no OpenCode model configured.` };
  }

  const providerSlug = providerId === "zai-coding" ? "zai" : providerId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const envSlug = providerSlug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  return {
    ok: true,
    target: {
      providerId,
      providerSlug,
      displayName: provider.name,
      baseUrl,
      apiKeyEnvVar: `OPENCODE_${envSlug}_API_KEY`,
      apiKeyValue: credential.secretRef,
      model,
      portalBaseUrl: baseUrl,
      sandboxBaseUrl: baseUrl,
    },
  };
}

export function buildOpencodeInstructions(
  role: SpecialistRole,
  buildContext: string,
  priorResults?: string,
): string {
  return buildSpecialistInstructions({
    role,
    buildContext,
    priorResults,
    fallbackInstruction: "You are a helpful AI coding agent working inside a DPF monorepo.",
    // DPF BUILD DISCIPLINE — per AGENTS.md §7 Subagent Dispatch (parity with other CLIs)
    extraDisciplineLines: [
      "DPF BUILD DISCIPLINE (MANDATORY):",
      "- GROUND DOMAIN FACTS IN THE CODEBASE — NEVER INVENT a platform convention: an identifier/prefix format, taxonomy, enum value, naming pattern, or API shape. When a task (or the design) references 'platform conventions', 'the knowledge base', or 'the canonical taxonomy' for a fact you don't have, FIND the real one before writing code — grep the repo for actual usage (existing identifiers, enums, similar utilities) and match it EXACTLY. Example: before classifying/parsing IDs, grep for real ones (e.g. `grep -rohE \"\\b(BI|EP|FB|WC)-[0-9A-F]+\" apps packages | sort -u | head`) instead of assuming a format. A plausible-but-wrong convention is a defect; if you genuinely cannot find the fact, say so in your output rather than guessing.",
      "- For ANY TypeScript work: run `pnpm --filter web typecheck` (or `pnpm exec tsc --noEmit`) and fix errors before finishing.",
      "- For final-task-in-epic or any UI change: ALSO run `cd apps/web && npx next build` and fix errors.",
      "- UI work MUST follow Theme-Aware Styling: ONLY use CSS custom properties (`text-[var(--dpf-text)]`, `bg-[var(--dpf-surface-1)]`, etc.). NEVER hardcode colors, tailwind gray-*, or raw hex.",
      "- Always operate from monorepo root /workspace. Use exact paths from the FILES section.",
    ],
  });
}

/**
 * Dispatch a single build task to OpenCode running inside the sandbox, pointed
 * at the install's local OpenAI-compatible endpoint.
 *
 * Structurally implemented + unit-tested here; runtime functional verification
 * (does the pulled local model actually clear a task) is the Phase 3 gate on the
 * canonical install — see the plan. The capability tier stays "preview" until
 * that evidence exists.
 */
export async function dispatchOpencodeTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
  providerId?: string;
  model?: string;
  containerId?: string;
  onProgress?: (message: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<OpencodeResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "local";
  const role = task.specialist;
  const containerId = params.containerId ?? DEFAULT_SANDBOX_CONTAINER;
  // Per-build working dir: the build's own worktree when isolation is ON, else
  // the shared /workspace (default — identical to prior behaviour). Container
  // ops (chown, docker exec target) stay container-rooted; only this build's
  // file ops run here. (BI-98B723C0 Phase 2c.)
  const workdir = resolveBuildWorkdir(params.buildId);
  const startedAt = new Date();
  const startMs = Date.now();

  // Resolve the endpoint the PORTAL uses (for preflight) and the rewritten URL
  // the SANDBOX uses (for the actual run).
  // the SANDBOX uses (for the actual run). Local endpoints keep the hard
  // preflight; credentialed remote OpenCode providers resolve through
  // ModelProvider + CredentialEntry because their /models behavior can vary by
  // account entitlement.
  const targetResult = await resolveOpencodeDispatchTarget({
    providerId,
    requestedModel: params.model ?? "",
    fetchImpl: params.fetchImpl ?? fetch,
  });
  if (!targetResult.ok) {
    return {
      content: `BLOCKED: ${targetResult.reason}`,
      success: false,
      executedTools: [],
      durationMs: Date.now() - startMs,
    };
  }
  const target = targetResult.target;
  const model = target.model;

  const timeoutMs = role === "data-architect" ? OPENCODE_SCHEMA_TASK_TIMEOUT_MS : OPENCODE_TASK_TIMEOUT_MS;

  const runId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeRunId = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  const promptFile = `/tmp/opencode-prompt-${safeRunId}.txt`;
  const runnerScript = `/tmp/opencode-run-${safeRunId}.sh`;

  try {
    await ensureSandboxNodeUser(containerId);
  } catch {
    // Non-fatal; some sandboxes may already be correct.
  }

  const instructions = buildOpencodeInstructions(role, buildContext, priorResults);
  const assembledPrompt = buildSpecialistTaskPrompt({ task, instructions, workdir });
  // BI-B195F224: when the local endpoint reports a served window, trim soft
  // context (prior results / project context) so the request stays under n_ctx
  // with output reserve — or fail early with an actionable message instead of a
  // mid-run ContextOverflowError.
  const fitted = trimTaskPromptToContext({
    prompt: assembledPrompt,
    servedContextTokens: target.servedContextTokens,
  });
  if (!fitted.fit) {
    const blocked = fitted.reason ?? "Task prompt exceeds local model context window.";
    console.error(
      sanitizeForLog(`[opencode-dispatch] Task "${task.title}" blocked: ${blocked}`),
    );
    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startMs,
      exitCode: null,
      success: false,
      stdout: "",
      stderr: blocked,
    }).catch(() => {});
    return {
      content: `BLOCKED: ${blocked}`,
      success: false,
      executedTools: [],
      durationMs: Date.now() - startMs,
    };
  }
  if (fitted.trimmed) {
    console.log(
      sanitizeForLog(
        `[opencode-dispatch] Trimmed task context for "${task.title}" to fit local window ` +
          `(~${fitted.estimatedTokens}/${fitted.budgetTokens} input tokens; served=${target.servedContextTokens})`,
      ),
    );
    params.onProgress?.(
      `Trimmed task context to fit local model window (~${fitted.estimatedTokens}/${fitted.budgetTokens} tokens)`,
    );
  }
  const taskPrompt = fitted.prompt;

  try {
    // Write the opencode provider config for the node user (global path, applies
    // regardless of cwd), then the prompt, then the runner script. All 0600, all
    // written as the `node` user — the runner script is executed as `node`
    // (docker exec --user node) and `cat`s the prompt file; writing them as root
    // with chmod 600 would make them unreadable to node ("Permission denied").
    const config = buildOpencodeConfig(target);
    await writeSandboxFile({
      containerId,
      path: "~/.config/opencode/opencode.json",
      content: config,
      mode: "600",
      asNodeUser: true,
      mkdirParents: "~/.config/opencode",
    });

    await writeSandboxFile({ containerId, path: promptFile, content: taskPrompt, mode: "600", asNodeUser: true });

    const script = buildOpencodeRunnerScript({
      workdir,
      promptFile,
      runnerScript,
      providerSlug: target.providerSlug,
      model,
      apiKeyEnvVar: target.apiKeyEnvVar,
      apiKeyValue: target.apiKeyValue,
    });
    await writeSandboxFile({ containerId, path: runnerScript, content: script, mode: "700", asNodeUser: true });

    // task.title and the model id originate from operator-authored BIs and the
    // build config, so they're CWE-117 sources. sanitizeForLog (CodeQL-registered)
    // strips C0 + DEL before the line lands.
    console.log(
      sanitizeForLog(
        `[opencode-dispatch] Starting task "${task.title}" with ${target.providerSlug}/${model} in ${containerId} (timeout: ${timeoutMs / 1000}s, endpoint: ${target.sandboxBaseUrl})`,
      ),
    );

    // Shared spawn loop. Opencode is the one surface that streams progress from
    // STDOUT (its `--format json` event stream) rather than stderr — wire that
    // through onStdoutChunk; the stderr buffer is captured by the loop and
    // attached to any rejection for the catch block below.
    //
    // BI-98572A51: opencode runs the model on the ONE local GPU. Acquire the SAME
    // single-slot admission lane the coworker chat path uses (withLocalInferenceLock),
    // held for the whole CLI run, so a chat local call and a build specialist (or
    // two concurrent builds) never collide on the GPU. The portal owns admission
    // in both cases — it awaits this docker-exec — so one in-process lane serializes
    // them. The orchestrator's per-build MAX_CONCURRENT_TASKS=1 only serialized
    // within a single build; this closes the chat↔build and build↔build gap.
    const { stdout, durationMs: elapsed } = await withLocalInferenceLock(() =>
      runSandboxAgentCli({
        containerId,
        runnerScript,
        timeoutMs,
        asNodeUser: true,
        onStdoutChunk: (chunk) => {
          // --format json streams events; surface tool/file actions as progress.
          for (const line of chunk.split("\n")) {
            const msg = summarizeOpencodeEvent(line);
            if (msg) params.onProgress?.(msg);
          }
        },
      }),
    );

    const content = extractOpencodeResult(stdout);

    // Detect a FATAL model/runtime error event in the stream. opencode emits
    // these as {"type":"error",...} JSON to stdout and STILL exits 0, so the
    // process-close check above (code===0 || stdout.trim()) classified a failed
    // run as a SUCCESS — the build then advanced with zero code produced and
    // shipped an empty diff ("No releasable source changes"). The classic case
    // is a llama.cpp ContextOverflowError when the prompt exceeds the served
    // context window. Treat any fatal error event as a task FAILURE so the
    // orchestrator's fix/retry/escalate path engages instead of silently
    // shipping nothing.
    const fatalError = detectOpencodeFatalError(stdout);
    if (fatalError) {
      console.error(
        sanitizeForLog(`[opencode-dispatch] Task "${task.title}" reported a fatal error: ${fatalError}`),
      );
      await recordBuildDispatchAttempt({
        buildId: params.buildId,
        taskTitle: task.title,
        specialist: role,
        providerId,
        model,
        startedAt,
        completedAt: new Date(),
        durationMs: elapsed,
        exitCode: 0,
        success: false,
        stdout: content,
        stderr: fatalError,
      });
      await recordOpencodeCapacityFailure({
        providerId,
        output: fatalError,
      }).catch((recordErr) => {
        console.warn("[opencode-dispatch] Failed to record provider capacity:", recordErr);
      });
      return {
        content: `OpenCode task failed: ${fatalError}`,
        success: false,
        executedTools: [],
        durationMs: elapsed,
      };
    }

    console.log(
      sanitizeForLog(
        `[opencode-dispatch] Task "${task.title}" completed in ${(elapsed / 1000).toFixed(1)}s (${content.length} chars)`,
      ),
    );

    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model,
      startedAt,
      completedAt: new Date(),
      durationMs: elapsed,
      exitCode: 0,
      success: true,
      stdout: content,
      stderr: "",
    });

    return {
      content: content || "OpenCode task completed with no output.",
      success: true,
      executedTools: [],
      durationMs: elapsed,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number | null };
    const output = (execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "");

    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model,
      startedAt,
      completedAt: new Date(),
      durationMs,
      exitCode: execErr.code ?? null,
      success: false,
      stdout: execErr.stdout ?? "",
      stderr: output || execErr.message || "",
    });
    await recordOpencodeCapacityFailure({
      providerId,
      output: output || execErr.message || "",
    }).catch((recordErr) => {
      console.warn("[opencode-dispatch] Failed to record provider capacity:", recordErr);
    });

    return {
      content: `OpenCode dispatch failed: ${execErr.message || "Unknown error"}${execErr.killed ? " (timed out)" : ""}`,
      success: false,
      executedTools: [],
      durationMs,
    };
  }
}

/**
 * Scan an `opencode run --format json` stdout stream for a FATAL error event.
 * opencode emits these as {"type":"error","error":{"name":...,"data":{"message":...}}}
 * for model/runtime failures (e.g. a llama.cpp ContextOverflowError /
 * exceed_context_size_error when the prompt exceeds the served context window)
 * yet STILL exits 0 — so without this the dispatcher's exit-code/non-empty-stdout
 * success check mis-reads the run as a success that produced no code, and the
 * build advances to ship with an empty diff ("No releasable source changes").
 * Returns a short "Name: message" for the first fatal error, or null when the
 * stream has none. Tolerant of format drift: non-JSON / unknown lines are skipped.
 */
export function detectOpencodeFatalError(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (evt.type === "error") {
      const err = evt.error as { name?: string; data?: { message?: string } } | undefined;
      const name = typeof err?.name === "string" ? err.name : "OpencodeError";
      const message = typeof err?.data?.message === "string" ? err.data.message : "";
      return `${name}${message ? `: ${message}` : ""}`.slice(0, 300);
    }
  }
  return null;
}

/**
 * Turn one line of `opencode run --format json` output into a short progress
 * message, or null if it isn't an actionable event. Tolerant of format drift:
 * unknown shapes simply produce no progress.
 */
export function summarizeOpencodeEvent(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = typeof evt.type === "string" ? evt.type : "";
  const tool = typeof evt.tool === "string" ? evt.tool : typeof evt.name === "string" ? evt.name : "";
  if (type.includes("tool") && tool) {
    const path = typeof evt.path === "string" ? evt.path : typeof evt.file === "string" ? evt.file : "";
    return path ? `${tool}: ${path}` : tool;
  }
  if (type === "thinking" || type === "reasoning") return "Thinking...";
  return null;
}

/**
 * Pull a human-readable result from the streamed JSON output: prefer the last
 * assistant/result event's text; fall back to the raw stdout when the format
 * isn't recognized (defensive against version drift).
 */
export function extractOpencodeResult(stdout: string): string {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  let result = "";
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const type = typeof evt.type === "string" ? evt.type : "";
      const text =
        typeof evt.text === "string" ? evt.text :
        typeof evt.content === "string" ? evt.content :
        typeof evt.result === "string" ? evt.result : "";
      if ((type === "result" || type === "message" || type === "assistant" || type === "text") && text) {
        result = text;
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return result || stdout.trim();
}
