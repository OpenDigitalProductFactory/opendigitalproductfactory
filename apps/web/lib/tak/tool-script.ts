/**
 * Programmatic tool calling (R4 / P7, context-engineering-standards.md).
 *
 * Lets the model write a short script that calls several READ-only platform
 * tools and FILTERS the results inside the isolated sandbox, returning only the
 * small filtered output to the model — instead of round-tripping every full
 * tool result through the context window. On the binding ~24,576-token local
 * window this is the single biggest token lever (Anthropic measures 37–98% cuts
 * for read-heavy filtering workflows).
 *
 * GOVERNANCE — the script does NOT get a privileged backdoor. Every `callTool`
 * the script issues is an ordinary POST to `/api/mcp/v1` carrying a short-lived
 * (5-min) scoped JWT, so each call reenters `governedExecuteTool` → the kernel
 * runtime gate + agent-grant checks, exactly like any other tool call, and is
 * audited as a `ToolExecution` row. This composes the *proven* CLI-adapter
 * reentry pattern (`apps/web/lib/routing/cli-adapter.ts`); it invents no new
 * execution or governance path.
 *
 * BLAST RADIUS — for this spike the script is **read-only**: the minted JWT
 * carries only the agent's non-side-effecting grants (and never
 * `tool_script_exec`, so a script cannot recurse). The sandbox (Docker
 * container, resource-limited, command-blocklisted, path-traversal-guarded) is
 * the trust boundary; its outbound network is the documented residual risk (see
 * the spec's security review).
 *
 * TWO KILL-SWITCHES, both required to activate (default INERT):
 *   1. the `tool_script_exec` agent grant (default-deny → tool invisible), and
 *   2. the `programmatic_tool_calling` PlatformConfig flag (default-OFF).
 *
 * Pure helpers below (`deriveReadOnlyScopes`, `wrapToolScript`,
 * `parseToolScriptOutput`, config parsing) are unit-tested. `runToolScript` is
 * the sandbox `docker exec` glue, faithfully mirroring the CLI adapter; it is
 * verified live (the sandbox cannot run in `dev`).
 */

import { prisma } from "@dpf/db";
import { createMcpSessionToken } from "@/lib/mcp/session-token";
import { buildDockerExecSandboxCommand } from "@/lib/build/sandbox/sandbox";
import { lazyExec } from "@/lib/shared/lazy-node";
import { clampToolResultForModel } from "@/lib/tak/tool-result-budget";
import type { ToolResult } from "@/lib/mcp-tools";

// ─── Feature flag (default OFF) — mirrors lib/self-upgrade/config.ts ──────────

export const PROGRAMMATIC_TOOL_CALLING_CONFIG_KEY = "programmatic_tool_calling";

export type ProgrammaticToolCallingConfig = {
  enabled: boolean;
  /** Hard cap on the script's returned output (chars). */
  maxOutputChars: number;
  /** Wall-clock cap for the sandbox script run (ms). */
  timeoutMs: number;
};

export const PROGRAMMATIC_TOOL_CALLING_DEFAULTS: ProgrammaticToolCallingConfig = {
  // EP-27FD96BC · P2 (BI-9893614D) — the feature is now reachable by default
  // (37–98% token cuts for read-heavy tool filtering). It stays fully gated:
  // only agents holding the `tool_script_exec` grant can invoke it, and every
  // callTool the script issues re-enters the kernel gate with a read-only-scoped
  // JWT. An operator can still force it off per install via the PlatformConfig row.
  enabled: true,
  maxOutputChars: 8_000,
  timeoutMs: 60_000,
};

export function parseProgrammaticToolCallingConfig(value: unknown): ProgrammaticToolCallingConfig {
  const cfg = (value ?? {}) as Partial<ProgrammaticToolCallingConfig>;
  const d = PROGRAMMATIC_TOOL_CALLING_DEFAULTS;
  return {
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : d.enabled,
    maxOutputChars:
      typeof cfg.maxOutputChars === "number" && cfg.maxOutputChars > 0
        ? Math.min(cfg.maxOutputChars, 50_000)
        : d.maxOutputChars,
    timeoutMs:
      typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0
        ? Math.min(cfg.timeoutMs, 5 * 60_000)
        : d.timeoutMs,
  };
}

export async function getProgrammaticToolCallingConfig(): Promise<ProgrammaticToolCallingConfig> {
  try {
    const row = await prisma.platformConfig.findUnique({
      where: { key: PROGRAMMATIC_TOOL_CALLING_CONFIG_KEY },
    });
    return parseProgrammaticToolCallingConfig((row?.value as unknown) ?? null);
  } catch {
    // Fail closed — if config can't be read, the feature is OFF.
    return PROGRAMMATIC_TOOL_CALLING_DEFAULTS;
  }
}

// ─── Pure: read-only scope derivation for the script's JWT ────────────────────

// A grant ending in one of these verbs is side-effecting; excluded so the
// script's reentry token is read-only. Mirrors the cli-adapter capability bump
// regex, plus send/publish/delete for marketing/outbound safety.
const SIDE_EFFECTING_GRANT_RE = /_(write|create|triage|promote|execute|approve|delete|send|publish)$/;

/**
 * The scopes a script's JWT may carry: the agent's own grants, minus any
 * side-effecting grant, minus `tool_script_exec` (no recursion). The MCP route
 * still re-gates per tool, so this can only ever NARROW access. Pure.
 */
export function deriveReadOnlyScopes(agentGrants: string[]): string[] {
  const out = new Set<string>();
  for (const g of agentGrants) {
    if (g === "tool_script_exec") continue;
    if (SIDE_EFFECTING_GRANT_RE.test(g)) continue;
    out.add(g);
  }
  // Always include backlog_read so a script can situate itself, matching the
  // cli-adapter baseline.
  out.add("backlog_read");
  return Array.from(out).sort();
}

// ─── Pure: wrap the model's code into a runnable sandbox node script ──────────

export const TOOL_SCRIPT_PATH = "/workspace/.dpf-tool-script.mjs";
export const TOOL_SCRIPT_TOKEN_PATH = "/workspace/.dpf-mcp-session";
/** Delimits the script's emitted result on stdout so the glue can extract it. */
export const TOOL_SCRIPT_RESULT_MARKER = "__DPF_TOOL_SCRIPT_RESULT__";

function defaultPortalUrl(): string {
  return process.env.DPF_INTERNAL_PORTAL_URL ?? "http://portal:3000";
}

/**
 * Build the node script run in the sandbox. The model's `userCode` is the body
 * of an async run that receives `callTool(name, args)` and returns its small
 * filtered result via `emit(value)`. Inlined (not eval'd) — the sandbox is the
 * containment boundary, so there is no `new Function` in portal code. Pure.
 */
export function wrapToolScript(userCode: string, opts?: { portalUrl?: string }): string {
  const portalUrl = opts?.portalUrl ?? defaultPortalUrl();
  // The marker is referenced as a runtime constant so it can never drift.
  return [
    `import fs from "node:fs";`,
    `const MARKER = ${JSON.stringify(TOOL_SCRIPT_RESULT_MARKER)};`,
    `const PORTAL = ${JSON.stringify(portalUrl)};`,
    `const TOKEN = fs.readFileSync(${JSON.stringify(TOOL_SCRIPT_TOKEN_PATH)}, "utf8").trim();`,
    `let __emitted = false;`,
    `function emit(value) { if (__emitted) return; __emitted = true; console.log(MARKER + JSON.stringify({ ok: true, result: value })); }`,
    `async function callTool(name, args) {`,
    `  const res = await fetch(PORTAL + "/api/mcp/v1", {`,
    `    method: "POST",`,
    `    headers: { "content-type": "application/json", "X-MCP-Session": TOKEN },`,
    `    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }),`,
    `  });`,
    `  const json = await res.json().catch(() => ({}));`,
    `  const r = json && json.result ? json.result : json;`,
    `  if (r && r.structuredContent !== undefined) return r.structuredContent;`,
    `  if (r && Array.isArray(r.content) && r.content[0] && typeof r.content[0].text === "string") {`,
    `    try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }`,
    `  }`,
    `  return r;`,
    `}`,
    `(async () => {`,
    `  try {`,
    `    // ===== model code start =====`,
    userCode,
    `    // ===== model code end =====`,
    `    if (!__emitted) emit(null);`,
    `  } catch (e) {`,
    `    console.log(MARKER + JSON.stringify({ ok: false, error: String((e && e.message) || e) }));`,
    `  }`,
    `})();`,
  ].join("\n");
}

// ─── Pure: parse the script stdout into a result string ───────────────────────

export type ToolScriptOutcome = {
  ok: boolean;
  /** Model-facing text: the emitted result, or an error/diagnostic. */
  output: string;
};

/**
 * Extract the emitted result from the script's stdout. The script prints one
 * marker line; everything else (incidental console output) is ignored except as
 * a fallback diagnostic when no marker is present. Pure.
 */
export function parseToolScriptOutput(stdout: string): ToolScriptOutcome {
  const lines = stdout.split(/\r?\n/);
  const markerLine = [...lines].reverse().find((l) => l.includes(TOOL_SCRIPT_RESULT_MARKER));
  if (!markerLine) {
    const tail = stdout.trim().slice(-2_000);
    return {
      ok: false,
      output: tail
        ? `Script produced no result (call emit(value) to return one). Output tail:\n${tail}`
        : "Script produced no output and never called emit(value).",
    };
  }
  const payload = markerLine.slice(markerLine.indexOf(TOOL_SCRIPT_RESULT_MARKER) + TOOL_SCRIPT_RESULT_MARKER.length);
  try {
    const parsed = JSON.parse(payload) as { ok?: boolean; result?: unknown; error?: string };
    if (parsed.ok === false) {
      return { ok: false, output: `Script error: ${parsed.error ?? "unknown error"}` };
    }
    const result = parsed.result;
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return { ok: true, output: text };
  } catch {
    return { ok: false, output: "Script emitted an unparseable result." };
  }
}

// ─── Glue: execute the script in the sandbox (live-verified) ──────────────────

function resolveSandboxContainer(): string {
  return process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
}

type RunToolScriptContext = {
  userId: string;
  agentId?: string;
  threadId?: string;
  routeContext?: string;
};

/**
 * Execute model-written code in the sandbox with governed, read-only tool
 * access. Mirrors the CLI-adapter mint→inject→exec→wipe sequence. Returns a
 * ToolResult whose message carries the small filtered output (capped).
 *
 * Not unit-tested (the sandbox cannot run in `dev`); the pure pieces it calls
 * are. Verified per the spec's live runbook before the flag is enabled.
 */
export async function runToolScript(
  params: { code?: unknown; purpose?: unknown },
  ctx: RunToolScriptContext,
): Promise<ToolResult> {
  const cfg = await getProgrammaticToolCallingConfig();
  if (!cfg.enabled) {
    return {
      success: false,
      error: "disabled",
      message:
        "Programmatic tool calling is disabled. Call the tools individually, or ask an operator to enable the programmatic_tool_calling flag.",
    };
  }

  const code = typeof params.code === "string" ? params.code : "";
  if (!code.trim()) {
    return { success: false, error: "invalid_params", message: "code is required (the script body)." };
  }
  if (!ctx.agentId) {
    return { success: false, error: "no_agent", message: "run_tool_script requires an agent context to mint a scoped token." };
  }

  // Read-only scopes from the agent's own grants — narrowing only.
  let scopes: string[];
  try {
    const { getAgentToolGrantsAsync } = await import("@/lib/tak/agent-grants");
    scopes = deriveReadOnlyScopes(await getAgentToolGrantsAsync(ctx.agentId));
  } catch (err) {
    return { success: false, error: "grant_resolution_failed", message: `Could not resolve agent grants: ${err instanceof Error ? err.message : String(err)}` };
  }

  let token: string;
  try {
    token = await createMcpSessionToken({
      userId: ctx.userId,
      agentId: ctx.agentId,
      threadId: ctx.threadId ?? null,
      routeContext: ctx.routeContext ?? null,
      scopes,
      capability: "read",
    });
  } catch (err) {
    return { success: false, error: "token_mint_failed", message: `Could not mint a scoped token: ${err instanceof Error ? err.message : String(err)}` };
  }

  const container = resolveSandboxContainer();
  const script = wrapToolScript(code);
  const exec = lazyExec();
  const scriptB64 = Buffer.from(script).toString("base64");
  const tokenB64 = Buffer.from(token).toString("base64");

  // Write script + token via base64 (never echoes the token into a logged
  // command in plaintext), restrict perms, then run, then ALWAYS wipe both.
  const writeScript = buildDockerExecSandboxCommand(
    container,
    `echo '${scriptB64}' | base64 -d > ${TOOL_SCRIPT_PATH} && chmod 600 ${TOOL_SCRIPT_PATH}`,
  );
  const writeToken = buildDockerExecSandboxCommand(
    container,
    `echo '${tokenB64}' | base64 -d > ${TOOL_SCRIPT_TOKEN_PATH} && chmod 600 ${TOOL_SCRIPT_TOKEN_PATH}`,
  );
  const runScript = buildDockerExecSandboxCommand(container, `node ${TOOL_SCRIPT_PATH}`);
  const wipe = buildDockerExecSandboxCommand(
    container,
    `rm -f ${TOOL_SCRIPT_PATH} ${TOOL_SCRIPT_TOKEN_PATH}`,
  );

  try {
    await exec(writeToken, { timeout: 5_000 });
    await exec(writeScript, { timeout: 5_000 });
    const { stdout } = await exec(runScript, { timeout: cfg.timeoutMs, maxBuffer: 100 * 1024 * 1024 });
    const outcome = parseToolScriptOutput(String(stdout ?? ""));
    const clamped = clampToolResultForModel(
      { success: outcome.ok, message: outcome.output },
      { maxChars: cfg.maxOutputChars },
    );
    return outcome.ok
      ? { success: true, message: clamped.text }
      : { success: false, error: "script_failed", message: clamped.text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "sandbox_exec_failed", message: `Sandbox script execution failed: ${msg}` };
  } finally {
    // Best-effort wipe — the token must not outlive the call.
    try {
      await exec(wipe, { timeout: 5_000 });
    } catch {
      /* sandbox may be gone; the 5-min TTL bounds the token regardless */
    }
  }
}
