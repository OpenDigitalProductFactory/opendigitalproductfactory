// apps/web/lib/mcp/packs/federation-membership-pack.ts
//
// EP-ZERO-CONFIG-FEDERATION (BI-4DD1E739, BI-AC7BCC58) — an agent pairing two
// installations of one organization in the operator's absence imports the
// organization join file through the platform, exactly as the Connections
// page does. The portal generates the key, has the organization CA sign it
// through the authority's portal, keeps the material in the federation state
// directory, and the next federation tick records the link trusted on both
// sides. Nothing is typed, no edge node or host script is involved, and the
// join file's one-time token never passes through the agent's own hands
// beyond the file it was given.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "import_organization_join_file",
    description:
      "Join this installation to its organization by importing a .dpfjoin file issued on the organization installation. Pass the file's text. The platform validates it (version, expiry, that it was issued for one of this installation's own addresses), generates a key here, has the organization CA sign it through the organization installation's portal, stores the material under the federation state directory, and the next federation tick (within five minutes) records the connection trusted on both sides with no approval. Refuses a tampered, expired or wrong-host file before any network call.",
    inputSchema: {
      type: "object",
      properties: {
        joinFileText: {
          type: "string",
          description: "The full text of the .dpfjoin file (starts with DPF_ORGANIZATION_JOIN_V2). At most 64 KB.",
        },
        reason: {
          type: "string",
          description: "Short audit tag for why the join is being performed.",
        },
      },
      required: ["joinFileText"],
    },
    requiredCapability: "manage_platform",
    executionMode: "immediate",
    sideEffect: true,
    consequence: "authority",
  },
];

async function importOrganizationJoinFileTool(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { importOrganizationJoinFile } = await import("@/lib/federation/organization-join-import");
  const { resolveLocalFederationAuthorityUrl } = await import("@/lib/federation/self-authority");
  const fileText = typeof params["joinFileText"] === "string" ? params["joinFileText"] : "";
  if (!fileText.trim() || Buffer.byteLength(fileText, "utf8") > 64 * 1024) {
    return { success: false, message: "joinFileText must be the text of a .dpfjoin file (at most 64 KB).", data: { reason: "invalid-join-file" } };
  }
  const reason = typeof params["reason"] === "string" ? params["reason"].trim().slice(0, 80) : "";
  console.log(`[federation] join file import requested by mcp:${context?.agentId?.trim() || "agent"}${reason ? `:${reason}` : ""}`);
  const requestHost = await resolveLocalFederationAuthorityUrl();
  const result = await importOrganizationJoinFile({ fileText, requestHost });
  if (!result.imported) {
    return {
      success: false,
      message: `Join file refused: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`,
      data: { reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) },
    };
  }
  return {
    success: true,
    message: `Joined the organization at ${result.authorityUrl} as ${result.intendedPeer}. The next federation tick enrols and records the connection trusted on both sides.`,
    data: {
      authorityUrl: result.authorityUrl,
      caUrl: result.caUrl,
      intendedPeer: result.intendedPeer,
      joinFileExpiresAt: result.expiresAt,
      materialDir: result.materialDir,
    },
  };
}

export const federationMembershipPack: ToolPack = {
  packId: "federation-membership",
  definitions,
  handlers: {
    import_organization_join_file: importOrganizationJoinFileTool,
  },
  grants: {
    // The same grant the UX-verification sign-in carries: pairing the
    // installations an agent tests is part of the same automation job.
    import_organization_join_file: ["sandbox_execute"],
  },
};
