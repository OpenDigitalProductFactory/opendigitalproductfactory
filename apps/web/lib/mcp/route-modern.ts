import { deriveCallerClient } from "@/lib/mcp/caller-client";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import {
  MCP_PROTOCOL_VERSION_2026,
  MCP_UNSUPPORTED_PROTOCOL_VERSION,
  cacheableCompleteResult,
  isModernMcpRequest,
  readModernRequestMetadata,
  validateModernHttpHeaders,
  validateToolParameterHeaders,
  withModernServerMetadata,
  type ModernMcpRequestMetadata,
} from "./protocol-2026";
import {
  MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
  MCP_TASKS_EXTENSION,
  tasksLifecycleEnabled,
} from "./tasks-lifecycle";

export const MCP_SERVER_IDENTITY = { name: "dpf-platform", version: "1.0.0" } as const;

export type McpRouteBody = {
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type ModernRouteValidation =
  | {
      modern: false;
      metadata: null;
      callerClient: string | undefined;
    }
  | {
      modern: true;
      metadata: ModernMcpRequestMetadata;
      callerClient: string | undefined;
    }
  | {
      error: {
        code: number;
        message: string;
        data?: unknown;
        httpStatus: number;
      };
    };

export function modernizeMcpResult(result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  return withModernServerMetadata(
    record["resultType"] === undefined ? { resultType: "complete", ...record } : record,
    MCP_SERVER_IDENTITY,
  );
}

export function validateModernRouteRequest(
  request: Request,
  body: McpRouteBody,
): ModernRouteValidation {
  if (!isModernMcpRequest(request.headers, body)) {
    return {
      modern: false,
      metadata: null,
      callerClient: deriveCallerClient(request.headers.get("user-agent")),
    };
  }

  const headerValidation = validateModernHttpHeaders(request.headers, body);
  if (!headerValidation.ok) {
    return { error: { ...headerValidation, httpStatus: 400 } };
  }

  const rawMeta = body.params?.["_meta"];
  const requestedVersion =
    typeof rawMeta === "object" && rawMeta !== null && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"]
      : undefined;
  if (requestedVersion !== MCP_PROTOCOL_VERSION_2026) {
    return {
      error: {
        code: MCP_UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: {
          supported: [MCP_PROTOCOL_VERSION_2026],
          requested: requestedVersion ?? request.headers.get("mcp-protocol-version"),
        },
        httpStatus: 400,
      },
    };
  }

  const metadata = readModernRequestMetadata(body.params);
  if (!metadata) {
    return {
      error: {
        code: MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
        message: "Missing or malformed per-request client capabilities",
        httpStatus: 400,
      },
    };
  }

  if (body.method === "tools/call" && typeof body.params?.["name"] === "string") {
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === body.params?.["name"]);
    const args = body.params["arguments"];
    if (tool && typeof args === "object" && args !== null && !Array.isArray(args)) {
      const parameterValidation = validateToolParameterHeaders(
        request.headers,
        tool.inputSchema,
        args as Record<string, unknown>,
      );
      if (!parameterValidation.ok) {
        return { error: { ...parameterValidation, httpStatus: 400 } };
      }
    }
  }

  return {
    modern: true,
    metadata,
    callerClient: metadata.clientInfo
      ? deriveCallerClient(`${metadata.clientInfo.name}/${metadata.clientInfo.version}`)
      : deriveCallerClient(request.headers.get("user-agent")),
  };
}

export async function buildMcpInstructions(baseInstructions: string): Promise<string> {
  try {
    const [{ buildOrgContextBundle, formatOrgContextInstructions }, { prisma }] =
      await Promise.all([
        import("@/lib/mcp/org-context-bundle"),
        import("@dpf/db"),
      ]);
    const bundle = await buildOrgContextBundle(
      prisma as unknown as Parameters<typeof buildOrgContextBundle>[0],
    );
    return formatOrgContextInstructions(baseInstructions, bundle);
  } catch (error) {
    console.warn("[mcp/instructions] org-context compose failed (fail-open):", error);
    return baseInstructions;
  }
}

export async function buildServerDiscoveryResult(baseInstructions: string) {
  return cacheableCompleteResult(
    {
      supportedVersions: [MCP_PROTOCOL_VERSION_2026],
      capabilities: {
        tools: { listChanged: true },
        ...(tasksLifecycleEnabled()
          ? { extensions: { [MCP_TASKS_EXTENSION]: {} } }
          : {}),
      },
      instructions: await buildMcpInstructions(baseInstructions),
    },
    0,
    "private",
  );
}
