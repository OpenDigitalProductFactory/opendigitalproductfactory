// ADP MCP server entry point.
// HTTP JSON-RPC over POST /mcp. Health at GET /health. Metrics at GET /metrics.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";
import {
  MCP_PROTOCOL_VERSION_2026,
  MCP_UNSUPPORTED_PROTOCOL_VERSION,
  cacheableCompleteResult,
  isModernMcpRequest,
  readModernRequestMetadata,
  validateModernHttpHeaders,
  withModernServerMetadata,
  type ModernMcpRequestMetadata,
} from "@dpf/integration-shared";
import { listWorkers, TOOL_DEFINITION as LIST_WORKERS_DEF } from "./tools/list-workers.js";
import {
  getPayStatements,
  TOOL_DEFINITION as GET_PAY_STATEMENTS_DEF,
} from "./tools/get-pay-statements.js";
import {
  getTimeCards,
  TOOL_DEFINITION as GET_TIME_CARDS_DEF,
} from "./tools/get-time-cards.js";
import {
  getDeductions,
  TOOL_DEFINITION as GET_DEDUCTIONS_DEF,
} from "./tools/get-deductions.js";

const PORT = Number.parseInt(process.env.PORT ?? "8600", 10);
const SERVICE_NAME = "adp";
const SERVICE_VERSION = "0.4.0";

// ─── Prometheus metrics ─────────────────────────────────────────────────────
// Surfaced at GET /metrics so the platform Health tab can show the service as
// UP instead of "Not scraped". The metric names follow the portal's
// `dpf_<feature>_<metric>_<unit>` convention (apps/web/lib/operate/metrics.ts).
export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: SERVICE_NAME });
collectDefaultMetrics({ register: metricsRegistry });

export const adpToolCallDuration = new Histogram({
  name: "dpf_adp_tool_call_duration_seconds",
  help: "Duration of ADP MCP tool calls in seconds",
  labelNames: ["tool", "outcome"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

export const adpToolCallErrors = new Counter({
  name: "dpf_adp_tool_call_errors_total",
  help: "Count of ADP MCP tool calls that returned an error",
  labelNames: ["tool", "reason"] as const,
  registers: [metricsRegistry],
});

export const adpMcpRequests = new Counter({
  name: "dpf_adp_mcp_requests_total",
  help: "Count of JSON-RPC requests received over POST /mcp",
  labelNames: ["method"] as const,
  registers: [metricsRegistry],
});

export const adpMcpCompatibility = new Counter({
  name: "dpf_adp_mcp_compatibility_total",
  help: "Privacy-safe ADP MCP protocol and client compatibility observations",
  labelNames: [
    "client_kind",
    "client_version",
    "protocol_era",
    "protocol_version",
    "method_family",
    "result_class",
  ] as const,
  registers: [metricsRegistry],
});

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

type McpRequestContext = {
  modern: boolean;
  metadata: ModernMcpRequestMetadata | null;
};

interface ToolsCallParams {
  name: string;
  arguments?: unknown;
  _meta?: {
    coworkerId?: string;
    userId?: string | null;
  };
}

type ToolHandler = (args: unknown, ctx: { coworkerId: string; userId: string | null }) => Promise<unknown>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

// Registry of callable tools. Add new tools here as they land.
const TOOLS: Record<string, { definition: ToolDefinition; handler: ToolHandler }> = {
  adp_list_workers: { definition: LIST_WORKERS_DEF, handler: listWorkers },
  adp_get_pay_statements: { definition: GET_PAY_STATEMENTS_DEF, handler: getPayStatements },
  adp_get_time_cards: { definition: GET_TIME_CARDS_DEF, handler: getTimeCards },
  adp_get_deductions: { definition: GET_DEDUCTIONS_DEF, handler: getDeductions },
};

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

const ADP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-03-26", "2024-11-05"];
const ADP_FALLBACK_PROTOCOL_VERSION = "2024-11-05";

function modernResult<T extends Record<string, unknown>>(result: T): T & { _meta: Record<string, unknown> } {
  return withModernServerMetadata(
    result["resultType"] === undefined ? { resultType: "complete", ...result } : result,
    { name: "dpf-adp", version: "1.0.0" },
  );
}

export async function handleMcp(
  request: JsonRpcRequest,
  context: McpRequestContext = { modern: false, metadata: null },
): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize": {
      if (context.modern) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "initialize is not part of MCP 2026-07-28" },
        };
      }
      // Conformant MCP handshake: echo the highest protocol version we both
      // speak (fallback when the client's is unknown), and declare the tools
      // capability so clients don't have to probe tools/list blind.
      const params = request.params as { protocolVersion?: string } | undefined;
      const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : null;
      const negotiated =
        requested && ADP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : ADP_FALLBACK_PROTOCOL_VERSION;
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: negotiated,
          capabilities: { tools: {} },
          serverInfo: {
            name: "dpf-adp",
            version: "1.0.0",
            description: "DPF ADP (agent data plane) MCP service — worker/data tools for coworkers.",
          },
        },
      };
    }
    case "notifications/initialized":
      // Notifications carry no id and expect no result; acknowledge quietly.
      return { jsonrpc: "2.0", id: request.id, result: {} };
    case "server/discover":
      if (!context.modern) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Method not found: server/discover" },
        };
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: modernResult(cacheableCompleteResult({
          supportedVersions: [MCP_PROTOCOL_VERSION_2026],
          capabilities: { tools: {} },
        }, 0, "private")),
      };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: context.modern
          ? modernResult(cacheableCompleteResult(
              { tools: Object.values(TOOLS).map((t) => t.definition) },
              0,
              "private",
            ))
          : { tools: Object.values(TOOLS).map((t) => t.definition) },
      };
    case "tools/call": {
      const params = request.params as ToolsCallParams | undefined;
      const toolName = params?.name;
      if (!toolName || !(toolName in TOOLS)) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `Tool not found: ${toolName ?? "<unset>"}` },
        };
      }
      const ctx = {
        coworkerId: params?._meta?.coworkerId ?? "unknown",
        userId: params?._meta?.userId ?? null,
      };
      const stop = adpToolCallDuration.startTimer({ tool: toolName });
      try {
        const result = await TOOLS[toolName]!.handler(params?.arguments, ctx);
        stop({ outcome: "ok" });
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: context.modern
            ? modernResult({
                resultType: "complete",
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
                isError: false,
              })
            : result,
        };
      } catch (err) {
        stop({ outcome: "error" });
        const message = err instanceof Error ? err.message : "unknown error";
        const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
        adpToolCallErrors.inc({ tool: toolName, reason: code ?? "exception" });
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: code ? `${code}: ${message}` : message },
        };
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
  }
}

function incomingHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function boundedMetricLabel(value: unknown, fallback: string, max = 64): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/[^A-Za-z0-9._:/-]/g, "").slice(0, max);
  return cleaned || fallback;
}

function recordCompatibilityObservation(input: {
  request: JsonRpcRequest;
  response: JsonRpcResponse;
  headers: Headers;
  modern: boolean;
  metadata: ModernMcpRequestMetadata | null;
}): void {
  const userAgent = boundedMetricLabel(input.headers.get("user-agent"), "unknown");
  const [uaName, uaVersion] = userAgent.split("/", 2);
  const params = input.request.params as { protocolVersion?: unknown } | undefined;
  const protocolVersion = input.modern
    ? MCP_PROTOCOL_VERSION_2026
    : boundedMetricLabel(params?.protocolVersion, "legacy-unspecified", 32);
  const slash = input.request.method.indexOf("/");
  adpMcpCompatibility.inc({
    client_kind: boundedMetricLabel(input.metadata?.clientInfo?.name, uaName || "unknown"),
    client_version: boundedMetricLabel(input.metadata?.clientInfo?.version, uaVersion || "unknown", 40),
    protocol_era: input.modern ? "modern" : "legacy",
    protocol_version: protocolVersion,
    method_family: boundedMetricLabel(
      slash < 0 ? input.request.method : input.request.method.slice(0, slash),
      "other",
      32,
    ),
    result_class: input.response.error ? "protocol-error" : "success",
  });
}

// Exported so tests can hit it without binding the port. The production path
// passes this to `createServer` and `listen`s; tests just call it with a mock
// IncomingMessage / ServerResponse.
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, service: SERVICE_NAME, version: SERVICE_VERSION });
    return;
  }

  if (req.method === "GET" && req.url === "/metrics") {
    const body = await metricsRegistry.metrics();
    res.writeHead(200, { "Content-Type": metricsRegistry.contentType });
    res.end(body);
    return;
  }

  if (req.method === "POST" && req.url === "/mcp") {
    try {
      const body = await readBody(req);
      const request = JSON.parse(body) as JsonRpcRequest;
      if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid request" },
        });
        return;
      }
      const headers = incomingHeaders(req);
      const requestForContract = request as unknown as {
        method: string;
        params?: Record<string, unknown>;
      };
      const modern = isModernMcpRequest(headers, requestForContract);
      let metadata: ModernMcpRequestMetadata | null = null;
      if (modern) {
        const validation = validateModernHttpHeaders(headers, requestForContract);
        if (!validation.ok) {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: validation.code, message: validation.message },
          });
          return;
        }
        const params = requestForContract.params;
        const rawMeta = params?.["_meta"];
        const requestedVersion =
          typeof rawMeta === "object" && rawMeta !== null && !Array.isArray(rawMeta)
            ? (rawMeta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"]
            : undefined;
        if (requestedVersion !== MCP_PROTOCOL_VERSION_2026) {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: {
              code: MCP_UNSUPPORTED_PROTOCOL_VERSION,
              message: "Unsupported protocol version",
              data: { supported: [MCP_PROTOCOL_VERSION_2026], requested: requestedVersion },
            },
          });
          return;
        }
        metadata = readModernRequestMetadata(params);
        if (!metadata) {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32003, message: "Missing required client capability metadata" },
          });
          return;
        }
      }
      adpMcpRequests.inc({ method: request.method });
      const response = await handleMcp(request, { modern, metadata });
      recordCompatibilityObservation({ request, response, headers, modern, metadata });
      const methodNotFound = modern && "error" in response && response.error?.code === -32601;
      sendJson(res, methodNotFound ? 404 : 200, response);
    } catch {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// Don't bind the port when this module is imported by a test runner — vitest
// imports server.ts to read the exported registry, and we'd otherwise fight
// for :8600 across parallel tests. The simple heuristic: only listen when
// invoked as the program entry point.
const isMainEntry =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/server.js") || process.argv[1].endsWith("/server.ts"));

if (isMainEntry) {
  const server = createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on :${PORT} (v${SERVICE_VERSION})`);
  });

  process.on("SIGTERM", () => {
    console.log(`[${SERVICE_NAME}] SIGTERM received, closing`);
    server.close(() => process.exit(0));
  });
}
