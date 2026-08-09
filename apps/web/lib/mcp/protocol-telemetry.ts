import { prisma } from "@dpf/db";
import { MCP_PROTOCOL_VERSION_2026 } from "./protocol-2026";
import { MCP_TASKS_EXTENSION, tasksExtensionNegotiated } from "./tasks-lifecycle";

type JsonRpcBody = {
  method?: unknown;
  params?: unknown;
  [key: string]: unknown;
};

export type McpTelemetryRecord = {
  protocolVersion: string;
  protocolEra: "modern" | "legacy" | "unknown";
  clientKind: string;
  clientVersion: string | null;
  authSource: "session_jwt" | "bearer" | "none";
  method: string;
  methodFamily: string;
  legacySessionUsed: boolean;
  tasksExtensionUsed: boolean;
  resultClass: string;
  httpStatus: number;
  latencyMs: number;
  compatibilityFailure: string | null;
  activeRequestCount: number;
  suspendedTaskCount: number | null;
  sharedWatcherCount: number;
  queuedResumptionCount: number;
  processRssBytes: bigint | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedLabel(value: unknown, fallback: string, max = 80): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/[^A-Za-z0-9._:/-]/g, "").slice(0, max);
  return cleaned || fallback;
}

function parseUserAgent(value: string | null): { name: string; version: string | null } {
  const token = value?.trim().split(/\s+/)[0] ?? "unknown";
  const slash = token.indexOf("/");
  if (slash < 0) return { name: boundedLabel(token, "unknown"), version: null };
  return {
    name: boundedLabel(token.slice(0, slash), "unknown"),
    version: boundedLabel(token.slice(slash + 1), "", 40) || null,
  };
}

function methodFamily(method: string): string {
  if (method === "initialize" || method === "notifications/initialized" || method === "server/discover") {
    return "lifecycle";
  }
  const slash = method.indexOf("/");
  return slash < 0 ? "other" : boundedLabel(method.slice(0, slash), "other", 32);
}

function responseClassification(responseBody: unknown, httpStatus: number) {
  const response = isRecord(responseBody) ? responseBody : {};
  const error = isRecord(response["error"]) ? response["error"] : null;
  if (httpStatus === 401 || httpStatus === 403) {
    return { resultClass: "auth_error", compatibilityFailure: null };
  }
  if (error) {
    const code = typeof error["code"] === "number" ? String(error["code"]) : null;
    const protocolError = typeof error["code"] === "number" && error["code"] <= -32000;
    return {
      resultClass: protocolError ? "protocol_error" : "internal_error",
      compatibilityFailure: code,
    };
  }
  const result = isRecord(response["result"]) ? response["result"] : {};
  const resultType = result["resultType"];
  if (resultType === "task") return { resultClass: "task", compatibilityFailure: null };
  if (resultType === "input_required") return { resultClass: "input_required", compatibilityFailure: null };
  return { resultClass: httpStatus >= 400 ? "http_error" : "success", compatibilityFailure: null };
}

export function buildMcpTelemetryRecord(input: {
  headers: Headers;
  body: JsonRpcBody | null;
  responseBody: unknown;
  httpStatus: number;
  latencyMs: number;
  activeRequestCount: number;
  suspendedTaskCount: number | null;
  processRssBytes: bigint | null;
}): McpTelemetryRecord {
  const params = isRecord(input.body?.params) ? input.body?.params : {};
  const meta = isRecord(params["_meta"]) ? params["_meta"] : {};
  const capabilities = isRecord(meta["io.modelcontextprotocol/clientCapabilities"])
    ? meta["io.modelcontextprotocol/clientCapabilities"] as Record<string, unknown>
    : {};
  const clientInfo = isRecord(meta["io.modelcontextprotocol/clientInfo"])
    ? meta["io.modelcontextprotocol/clientInfo"]
    : null;
  const ua = parseUserAgent(input.headers.get("user-agent"));
  const headerVersion = input.headers.get("mcp-protocol-version");
  const metaVersion = meta["io.modelcontextprotocol/protocolVersion"];
  const legacyVersion = params["protocolVersion"];
  const protocolVersion = boundedLabel(
    typeof metaVersion === "string"
      ? metaVersion
      : headerVersion ?? (typeof legacyVersion === "string" ? legacyVersion : "unknown"),
    "unknown",
    32,
  );
  const method = boundedLabel(input.body?.method, "unknown", 80);
  const classification = responseClassification(input.responseBody, input.httpStatus);

  return {
    protocolVersion,
    protocolEra: protocolVersion === MCP_PROTOCOL_VERSION_2026
      ? "modern"
      : protocolVersion === "unknown" ? "unknown" : "legacy",
    clientKind: clientInfo
      ? boundedLabel(clientInfo["name"], ua.name, 64)
      : ua.name,
    clientVersion: clientInfo
      ? boundedLabel(clientInfo["version"], ua.version ?? "", 40) || null
      : ua.version,
    authSource: input.headers.has("x-mcp-session")
      ? "session_jwt"
      : input.headers.has("authorization") ? "bearer" : "none",
    method,
    methodFamily: methodFamily(method),
    legacySessionUsed: input.headers.has("mcp-session-id"),
    tasksExtensionUsed: tasksExtensionNegotiated(capabilities),
    ...classification,
    httpStatus: input.httpStatus,
    latencyMs: Math.max(0, Math.trunc(input.latencyMs)),
    activeRequestCount: Math.max(0, Math.trunc(input.activeRequestCount)),
    suspendedTaskCount: input.suspendedTaskCount,
    // In-repo clients currently have no process-local task watcher. These
    // explicit zeros make that absence measurable without inventing one.
    sharedWatcherCount: 0,
    queuedResumptionCount: 0,
    processRssBytes: input.processRssBytes,
  };
}

export async function countSuspendedMcpTasks(): Promise<number | null> {
  try {
    const taskRun = (prisma as unknown as {
      taskRun?: { count?: (args: unknown) => Promise<number> };
    }).taskRun;
    if (typeof taskRun?.count !== "function") return null;
    return await taskRun.count({
      where: {
        mcpOwnerTokenId: { not: null },
        status: { in: ["submitted", "working", "input-required", "auth-required"] },
      },
    });
  } catch {
    return null;
  }
}

export async function recordMcpProtocolTelemetry(record: McpTelemetryRecord): Promise<void> {
  if (process.env.MCP_PROTOCOL_TELEMETRY === "off") return;
  try {
    const model = (prisma as unknown as {
      mcpProtocolTelemetry?: { create?: (args: unknown) => Promise<unknown> };
    }).mcpProtocolTelemetry;
    if (typeof model?.create !== "function") return;
    await model.create({ data: record });
  } catch (error) {
    console.warn(
      "[mcp/telemetry] compatibility observation failed: %s",
      error instanceof Error ? JSON.stringify(error.message) : JSON.stringify(String(error)),
    );
  }
}

export const MCP_TELEMETRY_PRIVACY_CONTRACT = {
  excludes: [
    "authorization",
    "prompt",
    "arguments",
    "taskId",
    "gaid",
    "participantTopology",
    "metadata",
  ],
  tasksExtension: MCP_TASKS_EXTENSION,
} as const;
