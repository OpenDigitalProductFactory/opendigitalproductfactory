// Minimal DPF MCP caller for out-of-process harnesses (EP-UX-AUDITOR Phase 2).
//
// The UX auditor runs OUTSIDE the Next.js server (a Playwright-driven runner), so
// it reaches governed tools the same way any other MCP client does: an HTTP
// tools/call against the DPF MCP endpoint. That keeps the auditor on the governed
// tool path — grants, capability checks and audit records all still apply —
// instead of re-implementing `evaluate_page`'s browser-use protocol or
// `record_functional_failure_evidence`'s backlog dedup.
//
// Config resolution is shared with the e2e evidence fixture
// (e2e/fixtures/evidence.ts) and follows the gate scripts (scripts/pregate.mjs):
// DPF_MCP_URL, else the local endpoint, with the bearer from the environment.
// No project .mcp.json is read (BI-5201141C): on https no writer produces one,
// because Claude Code's dpf connector is the plugin's URL-only OAuth
// descriptor, which carries no token a script could reuse.

export type DpfMcpConfig = { url: string; authorization: string };

/** The scripted-caller default, the same local endpoint the gate scripts use. */
export const DEFAULT_DPF_MCP_SCRIPT_URL = "http://127.0.0.1:3000/api/mcp/v1";

function bearer(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/**
 * Resolve MCP endpoint + bearer from the environment. Active standard is
 * DPF_MCP_BEARER_TOKEN; DPF_MCP_TOKEN stays for back-compat (BI-14E9F7CE).
 * Returns null when no bearer is configured.
 */
export function resolveDpfMcpConfig(
  env: Record<string, string | undefined> = process.env,
): DpfMcpConfig | null {
  const token = env.DPF_MCP_BEARER_TOKEN ?? env.DPF_MCP_TOKEN;
  if (!token) return null;
  return { url: env.DPF_MCP_URL || DEFAULT_DPF_MCP_SCRIPT_URL, authorization: bearer(token) };
}

type McpCallResponse = {
  result?: {
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
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: opts.id ?? `ux-audit-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
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
