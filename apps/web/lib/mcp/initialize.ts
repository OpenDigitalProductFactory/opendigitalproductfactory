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

/**
 * Resolve WHICH installation this is, for the handshake (BI-C7151B1B).
 *
 * `serverInfo.name` was the constant `"dpf-platform"` on every installation on
 * earth, so a client connected to two installs of one organization could not tell
 * them apart — which is the entire point of a connector list. Estate plus role
 * names it for a human; the device id is the unforgeable discriminator.
 *
 * Imported lazily and guarded exactly like the stance compose above, so a failure
 * degrades this one block rather than the handshake. It never MINTS a device id:
 * a read a client performs on every connect must not have a side effect, and an
 * install that has never federated must still be able to say which one it is.
 */
async function composeInstallationIdentity(): Promise<
  { serverName: string; title: string; label: string } | undefined
> {
  try {
    const [
      { loadEnvironmentClassResolution },
      { loadEstateNameResolution, formatMcpServerName, formatInstallationTitle },
      { readShortDeviceId },
      { prisma },
    ] = await Promise.all([
      import("@/lib/install/environment-class"),
      import("@/lib/install/estate-identity"),
      import("@/lib/install/installation-device-id"),
      import("@dpf/db"),
    ]);

    const store = {
      readConfig: async (key: string) =>
        (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null,
      // Lowest estate-name tier: the organization named at setup (BI-CA54ACC8).
      readOrganizationName: async () =>
        (await prisma.organization.findFirst({ select: { name: true } }))?.name ?? null,
    };

    const [environment, estate, shortDeviceId] = await Promise.all([
      loadEnvironmentClassResolution(store),
      loadEstateNameResolution(store),
      readShortDeviceId(store),
    ]);

    const identity = {
      estateName: estate.estateName,
      environmentClass: environment.environmentClass,
    };
    const title = formatInstallationTitle(identity);
    return {
      serverName: formatMcpServerName(identity),
      title,
      label: shortDeviceId ? `${title} (${shortDeviceId})` : title,
    };
  } catch (error) {
    console.warn("[mcp/initialize] installation-identity compose failed (fail-open):", error);
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

  const installation = await composeInstallationIdentity();

  let instructions = MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS;
  try {
    instructions += `\n\n${buildAgentHostInstructions(
      await readInstallHostProfile(),
      args.authority,
      await composeInstanceStance(),
      installation?.label,
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
      // Per-installation, so a client holding two connectors shows two names.
      // Falls back to the historic constant only when identity is unresolvable
      // (BI-C7151B1B).
      name: installation?.serverName ?? "dpf-platform",
      ...(installation ? { title: installation.title } : {}),
      version: "1.0.0",
      description:
        "Digital Product Factory MCP transport — governed backlog, planning, coworker, and build tools for external coding agents.",
    },
    instructions,
  };
}
