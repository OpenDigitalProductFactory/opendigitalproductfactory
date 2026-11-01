// BI-DFC0270C — below the toolchain floor, a declared DPF client is read-only
// until it updates (design 2026-10-07-agent-toolchain-release-delivery §5.2d).
//
// Enforced in tools/call, tasks/submit and tasks/cancel. tools/list is not
// changed, so the agent can still see what it is missing.
//
// The floor is a conformance control, not a security boundary: a declaration
// can only remove write access. So it applies only when all of these hold:
//   - the release sets a floor (floor.minPackVersion);
//   - the floor's grace window has ended (from floor.graceStartsAt);
//   - the caller declared a DPF toolchain (undeclared callers are never refused);
//   - the verdict is below-floor (resolveToolchainVerdict, which derives the
//     auth rule from mcpClientBearerHeaderRequired).
// A fault while working this out fails open: it must never stop every write.

import { resolveCredentialRef } from "@/lib/agent-toolchain/connection-observation";
import { getPublishedToolchain } from "@/lib/agent-toolchain/served-toolchain";
import {
  parseToolchainDeclaration,
  resolveToolchainVerdict,
  toolchainFloorGraceEnded,
  type ConnectionCredential,
  type PublishedToolchain,
  type ToolchainDeclaration,
} from "@/lib/agent-toolchain/toolchain-verdict";
import { resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { LOAD_TOOLS_TOOL_NAME } from "@/lib/mcp/tool-tier";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { canonicalWorkroomToolName } from "@/lib/tak/workroom-tool-aliases";

/**
 * The repair path stays open below the floor, because it is the repair:
 * discovery, posting the updater's report (own row only), and Grok fetching
 * its own credentials client (own client only). Each tool enforces its own
 * "own" rule.
 */
export const TOOLCHAIN_FLOOR_REPAIR_TOOLS: ReadonlySet<string> = new Set([
  LOAD_TOOLS_TOOL_NAME,
  "record_surface_readiness",
  "issue_grok_credentials_client",
]);

const ENFORCED_METHODS = new Set(["tools/call", "tasks/submit", "tasks/cancel"]);

/** A read grant, by the grant vocabulary's own naming (`backlog_read`, `siem_read`, ...). */
function isReadGrant(grant: string): boolean {
  return grant.endsWith("_read");
}

/**
 * Default-deny. A tool is allowed below the floor only when it is on the
 * repair path, or the registry says it only reads:
 *   - it declares `annotations.readOnlyHint: true`, or
 *   - it has no side effect AND every grant it requires is a read grant.
 * `sideEffect: false` alone is not enough: sandbox tools (write_sandbox_file,
 * run_sandbox_command, start_build) carry it because they cannot touch
 * production, yet they change the build. Unknown means refused.
 */
export function isToolAllowedBelowToolchainFloor(
  toolName: string,
  tool: ToolDefinition | undefined,
  requiredGrants: readonly string[] | undefined,
): boolean {
  if (TOOLCHAIN_FLOOR_REPAIR_TOOLS.has(toolName)) return true;
  if (!tool) return false;
  if (tool.annotations?.readOnlyHint === true) return true;
  return tool.sideEffect === false && !!requiredGrants?.length && requiredGrants.every(isReadGrant);
}

export type ToolchainFloorRefusal = {
  message: string;
  data: {
    error: "agent_toolchain_below_floor";
    method: string;
    toolName: string | null;
    writesRefused: true;
    readOperationsAllowed: true;
    repairOperationsAllowed: string[];
    repair: { manifestUrl: string; reason: string };
  };
};

/** The refusal for this call, or null when the floor allows it. Pure. */
export function toolchainFloorRefusalResult(input: {
  method: string;
  params: Record<string, unknown> | undefined;
  declaration: ToolchainDeclaration | null;
  credential: ConnectionCredential;
  mcpEndpoint: string;
  published: PublishedToolchain | null;
  now: Date;
  manifestUrl: string;
  tools?: readonly ToolDefinition[];
  grantMap?: Record<string, string[]>;
}): ToolchainFloorRefusal | null {
  const { method, declaration, credential, published, now } = input;
  if (!ENFORCED_METHODS.has(method)) return null;
  if (!declaration || credential.authSource === "session-jwt") return null;
  if (!published?.floor.minPackVersion || !toolchainFloorGraceEnded(published.floor, now)) return null;

  let toolName: string | null = null;
  if (method === "tools/call") {
    const raw = input.params?.["name"];
    toolName = typeof raw === "string" ? canonicalWorkroomToolName(raw) : null;
    const tool = toolName ? (input.tools ?? PLATFORM_TOOLS).find((candidate) => candidate.name === toolName) : undefined;
    const grants = toolName ? (input.grantMap ?? getToolGrantMapping())[toolName] : undefined;
    if (toolName && isToolAllowedBelowToolchainFloor(toolName, tool, grants)) return null;
  }

  const verdict = resolveToolchainVerdict({ declaration, credential, mcpEndpoint: input.mcpEndpoint, published, now });
  if (verdict.verdict !== "below-floor") return null;

  const reason = verdict.reasons.join("; ");
  const what = toolName ? `${toolName} was refused` : `${method} was refused`;
  return {
    message:
      `${what}: this ${declaration.client} client is below this portal's DPF toolchain floor (${reason}), so it can read but not write. ` +
      `Repair: ask the user once, in plain words, for approval to update the DPF tools; then run the DPF toolchain update from this portal (${input.manifestUrl}). ` +
      "Never show the user a command. When it finishes, ask them to restart this client.",
    data: {
      error: "agent_toolchain_below_floor",
      method,
      toolName,
      writesRefused: true,
      readOperationsAllowed: true,
      repairOperationsAllowed: [...TOOLCHAIN_FLOOR_REPAIR_TOOLS],
      repair: { manifestUrl: input.manifestUrl, reason },
    },
  };
}

function jsonRpc(id: unknown, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The route hook: a JSON-RPC response refusing this request, or null to go on.
 * tools/call gets an isError tool result (the quiescence refusal's shape);
 * tasks/* gets a JSON-RPC error carrying the same data.
 */
export async function refuseBelowToolchainFloor(
  request: Request,
  token: { tokenId: string; source: "oauth" | "pat" | "session-jwt" },
  body: { id?: unknown; method: string; params?: Record<string, unknown> },
): Promise<Response | null> {
  try {
    if (!ENFORCED_METHODS.has(body.method) || token.source === "session-jwt") return null;
    const declaration = parseToolchainDeclaration(request.url, request.headers);
    const published = getPublishedToolchain();
    const origin = resolveResourceOrigin(request);
    if (!declaration || !published?.floor.minPackVersion || !origin) return null;
    if (!toolchainFloorGraceEnded(published.floor, new Date())) return null;
    const { prisma } = await import("@dpf/db");
    const credential = await resolveCredentialRef(prisma as never, token);
    const refusal = toolchainFloorRefusalResult({
      method: body.method,
      params: body.params,
      declaration,
      credential: { authSource: token.source, credentialKind: credential?.credentialKind ?? null },
      mcpEndpoint: `${origin}/api/mcp/v1`,
      published,
      now: new Date(),
      manifestUrl: `${origin}/api/agent-toolchain/manifest`,
    });
    if (!refusal) return null;
    if (body.method === "tools/call") {
      return jsonRpc(body.id, {
        result: {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: refusal.data.error, message: refusal.message, data: refusal.data }, null, 2) }],
          structuredContent: refusal.data,
          isError: true,
        },
      });
    }
    return jsonRpc(body.id, { error: { code: -32600, message: refusal.message, data: refusal.data } });
  } catch (error) {
    console.warn("[agent-toolchain] floor check skipped:", error);
    return null;
  }
}
