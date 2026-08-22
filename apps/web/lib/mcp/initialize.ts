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
