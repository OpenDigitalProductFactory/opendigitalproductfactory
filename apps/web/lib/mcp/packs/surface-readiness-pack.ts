// Surface-readiness pack — BI-D6DFC0E7 (EP-COMPETENCE-FLYWHEEL, host-agent scope).
//
// Makes agent-surface readiness fleet-OBSERVABLE. The bootstrap already computes
// each surface's readiness locally; nothing reported it, so no one could know
// which surfaces × instances are wired to durable memory. This pack is the
// report + read door:
//   • record_surface_readiness — a build surface heartbeats its own computed state
//   • get_fleet_readiness       — read the rolled-up fleet view (for the digest / an operator)
//   • issue_grok_credentials_client — Grok's own OAuth credentials client, for
//     the toolchain updater (BI-84C1F526). Grant-gated, never wider than the caller.
//
// Ungated: reporting your OWN toolchain readiness (like propose_improvement /
// report_quality_issue) cannot exceed the caller's authority or affect anyone
// else; the read returns readiness telemetry only (no secrets). Inputs are
// validated against the closed vocabularies.

import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";
import {
  SURFACE_READINESS_STATES,
  SURFACE_CLIENT_KINDS,
  isSurfaceReadinessState,
  isSurfaceClientKind,
  DEFAULT_SURFACE_STALE_AFTER_MS,
} from "@/lib/agent-toolchain/fleet-readiness";

const definitions: ToolDefinition[] = [
  {
    name: "record_surface_readiness",
    description:
      "Report THIS build surface's toolchain readiness so the fleet can be observed centrally. Call after the bootstrap computes your readiness state (e.g. at session start or after a client update). Heartbeats upsert on surfaceKey — one row per surface. Lets the daily digest raise a surface that is not wired to durable memory or has gone silent.",
    inputSchema: {
      type: "object",
      properties: {
        surfaceKey: {
          type: "string",
          description: "Stable identity of this surface + machine, e.g. \"claude-code@<machineId>\". Reusing it updates this surface's heartbeat.",
        },
        clientKind: {
          type: "string",
          enum: [...SURFACE_CLIENT_KINDS],
          description: "Which client this surface is (claude-code | codex | grok | antigravity | build-studio).",
        },
        readinessState: {
          type: "string",
          enum: [...SURFACE_READINESS_STATES],
          description: "The computed readiness state (ready | partial | missing_cli | missing_token | needs_refresh | portal-unavailable | mcp-unavailable | failed_smoke).",
        },
        dpfPlatformVersion: {
          type: "string",
          description: "The platform version this surface converged to (for drift detection after a client update).",
        },
        mcpOk: { type: "boolean", description: "Whether the DPF MCP reachability probe passed." },
        mcpReason: { type: "string", description: "The probe failure reason when mcpOk is false (e.g. no_token, endpoint_unreachable)." },
        cliVersion: {
          type: "string",
          description: "This client's own CLI --version line, as the toolchain updater reports it.",
        },
        clientVersions: {
          type: "object",
          description: "The updater report's clientVersions: each client kind's CLI --version line, or null when that CLI is absent. Lets the platform notice a client release its capability record has not verified.",
          additionalProperties: { type: ["string", "null"] },
        },
      },
      required: ["surfaceKey", "clientKind", "readinessState", "mcpOk"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "get_fleet_readiness",
    description:
      "Read the rolled-up readiness of every build surface known to this instance: which are ready, not-ready, or stale (heartbeat gone silent). Feeds the daily digest and answers 'is every AI surface wired to durable memory right now?'. Also names clients whose capabilities are unverified for the version they report.",
    inputSchema: {
      type: "object",
      properties: {
        staleAfterDays: {
          type: "number",
          description: "A surface silent longer than this is 'stale' (unknown). Default 7.",
        },
        expectedPlatformVersion: {
          type: "string",
          description: "Optional: flag surfaces behind this platform version (updated/reset but not re-converged).",
        },
      },
      required: [],
    },
    requiredCapability: null,
    sideEffect: false,
  },
  {
    name: "issue_grok_credentials_client",
    description:
      "Return, or create once, YOUR OWN Grok connection credential: the client_credentials OAuth client Grok uses (dpf.read dpf.work dpf.build). Call it while converging the DPF toolchain on a host where Grok is installed, then pass data.credentialsClient to the toolchain updater on standard input (--grok-client-stdin). Refused when your connection is narrower than that credential. Never show the secret to the user.",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    // creates the credential an external client acts with → consult-gated (TAK §8.4.1).
    consequence: "authority",
    secretResultKeys: ["credentialsClient"],
  },
];

/**
 * BI-54469E18: an MCP caller's row is keyed by ITS OWN credential, so one
 * token can no longer overwrite another host's readiness. In-platform callers
 * with no MCP token keep the supplied key.
 */
async function boundSurfaceKey(
  supplied: string,
  clientKind: string,
  context: ToolExecutionContext | undefined,
): Promise<string> {
  if (!context?.apiTokenId || (context.authSource !== "oauth" && context.authSource !== "pat")) return supplied;
  const [{ prisma }, { resolveCredentialRef }] = await Promise.all([
    import("@dpf/db"),
    import("@/lib/agent-toolchain/connection-observation"),
  ]);
  const credential = await resolveCredentialRef(prisma as never, { tokenId: context.apiTokenId, source: context.authSource });
  return credential ? `${clientKind}@${credential.credentialRef}` : supplied;
}

const VERSION_LINE_LIMIT = 120;
const versionLine = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, VERSION_LINE_LIMIT) : null;

/**
 * BI-64795FD0: the CLI versions the updater reports, bounded. Only known client
 * kinds are kept, each a `--version` line or null. Undefined when none were sent,
 * so a plain heartbeat keeps the versions the last updater run stored.
 */
function versionDetail(params: Record<string, unknown>): { cliVersion?: string; clientVersions?: Record<string, string | null> } | undefined {
  const detail: { cliVersion?: string; clientVersions?: Record<string, string | null> } = {};
  const own = versionLine(params.cliVersion);
  if (own) detail.cliVersion = own;
  const map = params.clientVersions;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    const versions: Record<string, string | null> = {};
    for (const [kind, raw] of Object.entries(map as Record<string, unknown>)) {
      if (!isSurfaceClientKind(kind) || (raw !== null && typeof raw !== "string")) continue;
      versions[kind] = versionLine(raw);
    }
    if (Object.keys(versions).length) detail.clientVersions = versions;
  }
  return Object.keys(detail).length ? detail : undefined;
}

async function recordSurfaceReadinessHandler(
  params: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const suppliedKey = typeof params.surfaceKey === "string" ? params.surfaceKey.trim() : "";
  const clientKind = params.clientKind;
  const readinessState = params.readinessState;
  const mcpOk = params.mcpOk;

  if (!suppliedKey) {
    return { success: false, error: "invalid_surface_key", message: "surfaceKey is required." };
  }
  if (!isSurfaceClientKind(clientKind)) {
    return { success: false, error: "invalid_client_kind", message: `clientKind must be one of ${SURFACE_CLIENT_KINDS.join(", ")}.` };
  }
  if (!isSurfaceReadinessState(readinessState)) {
    return { success: false, error: "invalid_readiness_state", message: `readinessState must be one of ${SURFACE_READINESS_STATES.join(", ")}.` };
  }
  if (typeof mcpOk !== "boolean") {
    return { success: false, error: "invalid_mcp_ok", message: "mcpOk (boolean) is required." };
  }

  const detail = versionDetail(params);
  const surfaceKey = await boundSurfaceKey(suppliedKey, clientKind, context);
  const { prisma } = await import("@dpf/db");
  const { recordSurfaceReadiness } = await import("@/lib/agent-toolchain/fleet-readiness");
  await recordSurfaceReadiness(prisma as never, {
    surfaceKey,
    clientKind,
    readinessState,
    dpfPlatformVersion: typeof params.dpfPlatformVersion === "string" ? params.dpfPlatformVersion : null,
    mcpOk,
    mcpReason: typeof params.mcpReason === "string" ? params.mcpReason : null,
    ...(detail ? { detail } : {}),
  });

  return {
    success: true,
    message:
      readinessState === "ready"
        ? `Recorded: ${surfaceKey} is ready.`
        : `Recorded: ${surfaceKey} is not ready (${readinessState}) — it will surface in the fleet digest.`,
    data: { surfaceKey, readinessState },
  };
}

async function getFleetReadinessHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const staleDays = typeof params.staleAfterDays === "number" && params.staleAfterDays > 0 ? params.staleAfterDays : null;
  const staleAfterMs = staleDays ? staleDays * 24 * 60 * 60 * 1000 : DEFAULT_SURFACE_STALE_AFTER_MS;
  const expectedPlatformVersion = typeof params.expectedPlatformVersion === "string" ? params.expectedPlatformVersion : null;

  const { prisma } = await import("@dpf/db");
  const { getFleetReadiness, getToolchainCopies } = await import("@/lib/agent-toolchain/fleet-readiness");
  const { getPublishedToolchain } = await import("@/lib/agent-toolchain/served-toolchain");
  const now = new Date();
  const summary = await getFleetReadiness(prisma as never, {
    now,
    staleAfterMs,
    expectedPlatformVersion,
  });
  // BI-54469E18: what each connection actually loaded, against this release.
  const published = getPublishedToolchain();
  const origin = (process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_URL || "https://localhost").replace(/\/+$/, "");
  const toolchain = published
    ? { release: { packVersion: published.packVersion, packDigest: published.packDigest }, ...(await getToolchainCopies(prisma as never, { published, mcpEndpoint: `${origin}/api/mcp/v1`, now, staleAfterMs })) }
    : null;

  // BI-64795FD0: clients whose capabilities are unverified, either because a
  // connection reported a newer version or because the weekly re-verification
  // could not read a declared source.
  const { CLIENT_CAPABILITY_REVERIFY_TASK_ID, staleClientsFromTaskConfig } = await import("@/lib/agent-toolchain/client-capability-reverify");
  const verificationTask = await prisma.scheduledAgentTask
    .findUnique({ where: { taskId: CLIENT_CAPABILITY_REVERIFY_TASK_ID }, select: { taskConfig: true } })
    .catch(() => null);
  const capabilities = {
    unverifiedVersions: [
      ...(toolchain?.capabilityDrift ?? []),
      ...summary.reportedCapabilityDrift.filter(
        (drift) => !(toolchain?.capabilityDrift ?? []).some((seen) => seen.intakeKey === drift.intakeKey),
      ),
    ],
    verificationStale: staleClientsFromTaskConfig(verificationTask?.taskConfig),
  };

  const msg = summary.counts.total === 0
    ? "No build surfaces have reported readiness yet."
    : summary.allReady
      ? `All ${summary.counts.total} surface(s) are ready.`
      : `${summary.counts.notReady} not-ready, ${summary.counts.stale} stale of ${summary.counts.total} surface(s).`;

  return { success: true, message: msg, data: { ...summary, toolchain, capabilities } as unknown as Record<string, unknown> };
}

async function issueGrokCredentialsClientHandler(userId: string, context?: ToolExecutionContext): Promise<ToolResult> {
  const [{ prisma }, { issueGrokCredentialsClientForCaller }, { GROK_CREDENTIALS_CLIENT_NAME }, { prepareClientSecret }, { decryptSecret }] =
    await Promise.all([
      import("@dpf/db"),
      import("@/lib/agent-toolchain/grok-credential-issue"),
      import("@/lib/auth/grok-credentials-client"),
      import("@/lib/auth/oauth-tokens"),
      import("@/lib/govern/credential-crypto"),
    ]);
  return issueGrokCredentialsClientForCaller(userId, context ?? {}, {
    rows: (ownerUserId) =>
      prisma.oAuthClient.findMany({
        where: { ownerUserId, clientName: GROK_CREDENTIALS_CLIENT_NAME },
        select: { oAuthClientId: true, clientName: true, registrationKind: true, ownerUserId: true, revokedAt: true, allowedScopes: true, clientSecretEnc: true },
      }),
    create: async (row) => {
      await prisma.oAuthClient.create({ data: { ...row, allowedScopes: [...row.allowedScopes], redirectUris: [] } });
    },
    decrypt: decryptSecret,
    prepareSecret: prepareClientSecret,
  });
}

export const surfaceReadinessPack: ToolPack = {
  packId: "surface-readiness",
  definitions,
  handlers: {
    record_surface_readiness: (params, _userId, context) => recordSurfaceReadinessHandler(params, context),
    get_fleet_readiness: (params) => getFleetReadinessHandler(params),
    issue_grok_credentials_client: (_params, userId, context) => issueGrokCredentialsClientHandler(userId, context),
  },
  // Mirrors TOOL_TO_GRANTS (BI-6AC65187): the heartbeat upserts on a
  // caller-supplied surfaceKey, so it rides the heartbeat tier.
  grants: {
    record_surface_readiness: ["work_capsule_write"],
    get_fleet_readiness: ["work_capsule_read"],
    // The credential carries dpf.build, so issuing it needs a build grant; the
    // handler also refuses anything wider than the caller (BI-84C1F526).
    issue_grok_credentials_client: ["sandbox_execute"],
  },
};
