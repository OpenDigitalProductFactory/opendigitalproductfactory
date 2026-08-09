// Minimal DPF MCP caller for out-of-process harnesses (EP-UX-AUDITOR Phase 2).
//
// The UX auditor runs OUTSIDE the Next.js server (a Playwright-driven runner), so
// it reaches governed tools the same way any other MCP client does: an HTTP
// tools/call against the DPF MCP endpoint. That keeps the auditor on the governed
// tool path — grants, capability checks and audit records all still apply —
// instead of re-implementing `evaluate_page`'s browser-use protocol or
// `record_functional_failure_evidence`'s backlog dedup.
//
// Config resolution matches the pre-existing e2e evidence fixture (which now
// shares this module): explicit env first, then the repo's .mcp.json.

import { readFile } from "node:fs/promises";
import {
  SharedMcpTaskWatcher,
  type McpTaskContinuation,
  type McpTaskContinuationStore,
  type McpTaskSnapshot,
} from "@/lib/mcp/shared-task-watcher";

export type DpfMcpConfig = { url: string; authorization: string };

/**
 * Expand `${VAR}` placeholders against an environment map. The repo's committed
 * .mcp.json stores the bearer as the literal string `Bearer ${DPF_MCP_BEARER_TOKEN}`
 * — MCP clients expand it, a raw fetch does not. Expanding here is what keeps a
 * plain HTTP caller from sending the placeholder and getting a 401.
 */
export function expandEnvPlaceholders(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => env[name] ?? match);
}

function bearer(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/**
 * Resolve MCP endpoint + bearer. Explicit env wins per field; the repo's
 * .mcp.json supplies whatever env does not, with `${VAR}` placeholders expanded.
 * Active standard is DPF_MCP_BEARER_TOKEN; DPF_MCP_TOKEN stays for back-compat
 * (BI-14E9F7CE). Returns null when the bearer cannot be resolved to a real value
 * — an unexpanded placeholder counts as unresolved, not as a token.
 */
export async function resolveDpfMcpConfig(
  mcpJsonPath = ".mcp.json",
  env: Record<string, string | undefined> = process.env,
): Promise<DpfMcpConfig | null> {
  const raw = await readFile(mcpJsonPath, "utf8").catch(() => null);

  let fileUrl: string | undefined;
  let fileAuth: string | undefined;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        mcpServers?: { dpf?: { url?: string; headers?: { Authorization?: string } } };
      };
      fileUrl = parsed.mcpServers?.dpf?.url;
      fileAuth = parsed.mcpServers?.dpf?.headers?.Authorization;
    } catch {
      // Malformed config — fall through to env-only resolution.
    }
  }

  const envToken = env.DPF_MCP_BEARER_TOKEN ?? env.DPF_MCP_TOKEN;
  const authorization = envToken
    ? bearer(envToken)
    : fileAuth
      ? expandEnvPlaceholders(fileAuth, env)
      : undefined;

  if (!authorization || authorization.includes("${")) return null;

  const url = env.DPF_MCP_URL ?? (fileUrl ? expandEnvPlaceholders(fileUrl, env) : undefined);
  if (!url || url.includes("${")) return null;

  return { url, authorization };
}

type McpCallResponse = {
  result?: {
    resultType?: string;
    taskId?: string;
    status?: string;
    pollIntervalMs?: number | null;
    isError?: boolean;
    content?: Array<{ text?: string }>;
  };
  error?: { message?: string };
};

/**
 * The parsed payload of a tools/call: the tool's JSON body when its first content
 * block is JSON, plus the raw text so callers can report a non-JSON response
 * verbatim rather than swallowing it.
 */
export type DpfMcpToolResult = {
  isError: boolean;
  text: string;
  data: unknown;
  task?: {
    taskId: string;
    status: string;
    pollIntervalMs: number | null;
  };
};

/**
 * Invoke a DPF MCP tool. Throws on transport/protocol failure so a caller inside
 * `runSurvey` degrades that route to an honest error entry — never to a
 * success-shaped empty result (the NOT-RUN vs clean-page distinction, BI-1BAA177C).
 */
export async function callDpfMcpTool(
  config: DpfMcpConfig,
  name: string,
  args: Record<string, unknown>,
  opts: { id?: string; timeoutMs?: number } = {},
): Promise<DpfMcpToolResult> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.authorization,
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: opts.id ?? `ux-audit-${name}`,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "dpf-ux-audit", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });

  if (!response.ok) {
    throw new Error(`MCP ${name} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as McpCallResponse;
  if (payload.error) {
    throw new Error(`MCP ${name} error: ${payload.error.message ?? "unknown"}`);
  }

  if (
    payload.result?.resultType === "task" &&
    typeof payload.result.taskId === "string" &&
    typeof payload.result.status === "string"
  ) {
    return {
      isError: false,
      text: "",
      data: null,
      task: {
        taskId: payload.result.taskId,
        status: payload.result.status,
        pollIntervalMs: typeof payload.result.pollIntervalMs === "number"
          ? payload.result.pollIntervalMs
          : null,
      },
    };
  }

  const text = payload.result?.content?.[0]?.text ?? "";
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON — keep the raw text; callers decide whether that is fatal.
      data = null;
    }
  }

  return { isError: payload.result?.isError === true, text, data };
}

export async function getDpfMcpTask(
  config: DpfMcpConfig,
  taskId: string,
): Promise<McpTaskSnapshot> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.authorization,
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tasks/get",
      "Mcp-Name": taskId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `task-${taskId}`,
      method: "tasks/get",
      params: {
        taskId,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "dpf-ux-audit", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`MCP tasks/get failed with HTTP ${response.status}`);
  const payload = (await response.json()) as McpCallResponse;
  if (payload.error) {
    throw new Error(`MCP tasks/get error: ${payload.error.message ?? "unknown"}`);
  }
  if (
    typeof payload.result?.taskId !== "string" ||
    typeof payload.result.status !== "string"
  ) {
    throw new Error("MCP tasks/get returned a malformed task");
  }
  return {
    ...payload.result,
    taskId: payload.result.taskId,
    status: payload.result.status,
  };
}

/**
 * Bind the owned HTTP client to the shared watcher. Config is resolved again
 * for every poll so a restart or token rotation does not reuse stale authority.
 */
export function createDpfMcpTaskWatcher(options: {
  resolveConfig: () => Promise<DpfMcpConfig>;
  store: McpTaskContinuationStore;
  wake: (
    reference: Pick<McpTaskContinuation, "taskId" | "continuationRef">,
    task: McpTaskSnapshot,
  ) => Promise<void>;
  maxConcurrentResumptions?: number;
}): SharedMcpTaskWatcher {
  return new SharedMcpTaskWatcher({
    store: options.store,
    getTask: async (taskId) => getDpfMcpTask(await options.resolveConfig(), taskId),
    wake: options.wake,
    maxConcurrentResumptions: options.maxConcurrentResumptions,
  });
}
