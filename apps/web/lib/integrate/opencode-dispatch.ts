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
import { recordBuildDispatchAttempt } from "@/lib/build/dispatch-attempts";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { resolveBuildWorkdir } from "./sandbox/build-branch";

const DEFAULT_SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

const OPENCODE_TASK_TIMEOUT_MS = Number(process.env.OPENCODE_TASK_TIMEOUT_MS) || 1_800_000;       // 30 min — local inference is slower
const OPENCODE_SCHEMA_TASK_TIMEOUT_MS = Number(process.env.OPENCODE_SCHEMA_TASK_TIMEOUT_MS) || 2_400_000; // 40 min for schema tasks

// Real agent runs consume 39k–156k tokens; a serving context below this fails
// outright. Advisory floor — /v1/models rarely exposes context length, so this
// is enforced only when the endpoint reports it (see preflightLocalEndpoint).
export const OPENCODE_MIN_CONTEXT_TOKENS = Number(process.env.OPENCODE_MIN_CONTEXT_TOKENS) || 22_000;

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

/**
 * Build the opencode.json that declares the install's local endpoint as a
 * custom OpenAI-compatible provider named "local". A dummy apiKey is required
 * by the schema but ignored by local servers; "permission":"allow" keeps the
 * headless run from blocking on a permission prompt.
 */
export function buildOpencodeConfig(sandboxBaseUrl: string, model: string): string {
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    provider: {
      local: {
        npm: "@ai-sdk/openai-compatible",
        name: "DPF Local",
        options: {
          baseURL: sandboxBaseUrl,
          apiKey: "{env:OPENCODE_LOCAL_KEY}",
        },
        models: { [model]: { name: model } },
      },
    },
    model: `local/${model}`,
    permission: "allow",
  });
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
  const portalBaseUrl = getOllamaBaseUrl().replace(/\/$/, "");
  const sandboxBaseUrl = sandboxReachableUrl(portalBaseUrl);

  // Hard preflight: endpoint reachable + model present + served context clears
  // the agent floor. A failure here is an honest BLOCKED, not a silent degrade
  // (and not a silent truncation when the served context is too small).
  const pre = await preflightLocalEndpoint(portalBaseUrl, params.model ?? "", params.fetchImpl ?? fetch, { checkServedContext: true });
  if (!pre.ok || !pre.resolvedModel) {
    return {
      content: `BLOCKED: ${pre.reason ?? "local endpoint preflight failed"}`,
      success: false,
      executedTools: [],
      durationMs: Date.now() - startMs,
    };
  }
  const model = pre.resolvedModel;

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
  const taskPrompt = buildSpecialistTaskPrompt({ task, instructions, workdir });

  try {
    // Write the opencode provider config for the node user (global path, applies
    // regardless of cwd), then the prompt, then the runner script. All 0600, all
    // written as the `node` user — the runner script is executed as `node`
    // (docker exec --user node) and `cat`s the prompt file; writing them as root
    // with chmod 600 would make them unreadable to node ("Permission denied").
    const config = buildOpencodeConfig(sandboxBaseUrl, model);
    await writeSandboxFile({
      containerId,
      path: "~/.config/opencode/opencode.json",
      content: config,
      mode: "600",
      asNodeUser: true,
      mkdirParents: "~/.config/opencode",
    });

    await writeSandboxFile({ containerId, path: promptFile, content: taskPrompt, mode: "600", asNodeUser: true });

    const script = [
      "#!/bin/sh",
      "set -e",
      `cleanup() { rm -f ${promptFile} ${runnerScript} 2>/dev/null || true; }`,
      "trap cleanup EXIT INT TERM",
      `cd ${workdir}`,
      "export OPENCODE_LOCAL_KEY=local", // dummy key; local servers ignore auth
      // POSIX: the result of $(...) expansion assigned to PROMPT is NOT re-expanded
      // when referenced as "$PROMPT", so code containing $ or backticks is safe.
      `PROMPT=$(cat ${promptFile})`,
      `opencode run --dir ${workdir} -m local/${model} --format json --dangerously-skip-permissions "$PROMPT"`,
      "cleanup",
    ].join("\n");
    await writeSandboxFile({ containerId, path: runnerScript, content: script, mode: "700", asNodeUser: true });

    // task.title and the model id originate from operator-authored BIs and the
    // build config, so they're CWE-117 sources. sanitizeForLog (CodeQL-registered)
    // strips C0 + DEL before the line lands.
    console.log(
      sanitizeForLog(
        `[opencode-dispatch] Starting task "${task.title}" with local/${model} in ${containerId} (timeout: ${timeoutMs / 1000}s, endpoint: ${sandboxBaseUrl})`,
      ),
    );

    // Shared spawn loop. Opencode is the one surface that streams progress from
    // STDOUT (its `--format json` event stream) rather than stderr — wire that
    // through onStdoutChunk; the stderr buffer is captured by the loop and
    // attached to any rejection for the catch block below.
    const { stdout, durationMs: elapsed } = await runSandboxAgentCli({
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
    });

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
