import type { McpTokenScope } from "@/lib/auth/mcp-api-token";
import { readInstallHostProfile } from "@/lib/install/host-profile";
import { buildAgentHostInstructions } from "@/lib/mcp/agent-host-instructions";
import { MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS } from "@/lib/mcp/load-tools";
import {
  FALLBACK_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@/lib/mcp/protocol-versions";
import { shouldAdvertiseTasksCapability } from "@/lib/mcp/tasks-lifecycle";

type InitializeAuthority = {
  scope: McpTokenScope;
  scopes: readonly string[];
};

/**
 * Resolve the instance stance for the connect-time briefing.
 *
 * Imported lazily and separately from the org-context bundle so a database or
 * install-state read failure degrades this one block rather than the whole
 * handshake. Returns `undefined` on failure, which omits the briefing instead of
 * asserting a stance the server could not establish.
 */
async function composeInstanceStance() {
  try {
    const [{ loadInstanceStance, prismaInstanceStanceStore }, { prisma }] = await Promise.all([
      import("@/lib/install/instance-stance"),
      import("@dpf/db"),
    ]);
    return await loadInstanceStance(prismaInstanceStanceStore(prisma));
  } catch (error) {
    console.warn("[mcp/initialize] instance-stance compose failed (fail-open):", error);
    return undefined;
  }
}

export async function buildMcpInitializeResult(args: {
  params?: Record<string, unknown>;
  authority: InitializeAuthority;
}): Promise<Record<string, unknown>> {
  const requested =
    typeof args.params?.["protocolVersion"] === "string"
      ? args.params["protocolVersion"]
      : null;
  const negotiated =
    SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === requested) ??
    FALLBACK_PROTOCOL_VERSION;

  let instructions = MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS;
  try {
    instructions += `\n\n${buildAgentHostInstructions(
      await readInstallHostProfile(),
      args.authority,
      await composeInstanceStance(),
    )}`;
  } catch (error) {
    console.warn("[mcp/initialize] agent-host compose failed (fail-open):", error);
  }

  try {
    const [{ buildOrgContextBundle, formatOrgContextInstructions }, { prisma }] =
      await Promise.all([
        import("@/lib/mcp/org-context-bundle"),
        import("@dpf/db"),
      ]);
    const bundle = await buildOrgContextBundle(
      prisma as unknown as Parameters<typeof buildOrgContextBundle>[0],
    );
    instructions = formatOrgContextInstructions(instructions, bundle);
  } catch (error) {
    console.warn("[mcp/initialize] org-context compose failed (fail-open):", error);
  }

  return {
    protocolVersion: negotiated,
    capabilities: {
      tools: { listChanged: true },
      ...(shouldAdvertiseTasksCapability(negotiated)
        ? { tasks: { list: {}, cancel: {} } }
        : {}),
    },
    serverInfo: {
      name: "dpf-platform",
      version: "1.0.0",
      description:
        "Digital Product Factory MCP transport — governed backlog, planning, coworker, and build tools for external coding agents.",
    },
    instructions,
  };
}
