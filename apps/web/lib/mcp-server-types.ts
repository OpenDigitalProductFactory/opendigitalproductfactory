// apps/web/lib/mcp-server-types.ts
// Connection config types and redaction for MCP servers.

export type StdioConfig = {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type SseConfig = {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type HttpConfig = {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpConnectionConfig = StdioConfig | SseConfig | HttpConfig;
export type McpTransport = McpConnectionConfig["transport"];

export type HealthCheckResult = {
  healthy: boolean;
  latencyMs: number;
  error?: string;
  toolCount?: number;
};

export function validateConnectionConfig(
  config: McpConnectionConfig
): { valid: true } | { valid: false; error: string } {
  if (!config || typeof config !== "object") {
    return { valid: false, error: "Config must be an object" };
  }
  const transport = (config as { transport?: string }).transport;
  if (transport === "stdio") {
    const c = config as StdioConfig;
    if (!c.command || typeof c.command !== "string") {
      return { valid: false, error: "stdio config requires a command string" };
    }
    return { valid: true };
  }
  if (transport === "sse" || transport === "http") {
    const c = config as SseConfig | HttpConfig;
    if (!c.url || typeof c.url !== "string") {
      return { valid: false, error: `${transport} config requires a url string` };
    }
    return { valid: true };
  }
  return { valid: false, error: `Unknown transport: ${String(transport)}. Expected "stdio", "sse", or "http"` };
}

const SENSITIVE_PATTERN = /secret|token|key|password|authorization|api_key|apikey/i;

function redactRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = SENSITIVE_PATTERN.test(k) ? "***" : v;
  }
  return result;
}

export function redactConfig<T extends McpConnectionConfig>(config: T): T {
  const copy = { ...config };
  if ("headers" in copy && copy.headers) {
    (copy as SseConfig | HttpConfig).headers = redactRecord(copy.headers);
  }
  if ("env" in copy && copy.env) {
    (copy as StdioConfig).env = redactRecord(copy.env);
  }
  return copy;
}
