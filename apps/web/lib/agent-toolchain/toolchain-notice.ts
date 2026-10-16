import "server-only";

// BI-54469E18 — the TOOLCHAIN line an agent receives at MCP initialize (design
// §5.2a). Fail-open: no notice is better than a failed handshake.

import { resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { deriveCallerClient } from "@/lib/mcp/caller-client";

import { resolveCredentialRef, type ObservationAuthSource } from "./connection-observation";
import { getInstallationDeviceId, getPublishedToolchain } from "./served-toolchain";
import { formatToolchainNotice, parseToolchainDeclaration, resolveToolchainVerdict } from "./toolchain-verdict";

/** User-Agent prefixes of DPF-managed clients, for the undeclared hint only. */
const PROBABLE_DPF_CLIENT = /^(claude-code|codex(?:-cli|-desktop)?|grok|antigravity)(?:\/|$)/i;

export async function toolchainNoticeFor(
  request: Request,
  token: { tokenId: string; source: ObservationAuthSource },
): Promise<string | null> {
  try {
    if (token.source === "session-jwt") return null;
    const published = getPublishedToolchain();
    const origin = resolveResourceOrigin(request);
    if (!published || !origin) return null;
    const { prisma } = await import("@dpf/db");
    const credential = await resolveCredentialRef(prisma as never, token);
    const declaration = parseToolchainDeclaration(request.url, request.headers);
    const userAgent = deriveCallerClient(request.headers.get("user-agent")) ?? "";
    const result = resolveToolchainVerdict({
      declaration,
      credential: { authSource: token.source, credentialKind: credential?.credentialKind ?? null },
      mcpEndpoint: `${origin}/api/mcp/v1`,
      published,
      now: new Date(),
    });
    return formatToolchainNotice({
      result,
      declaration,
      published,
      manifestUrl: `${origin}/api/agent-toolchain/manifest`,
      probableClient: PROBABLE_DPF_CLIENT.exec(userAgent)?.[1]?.toLowerCase() ?? null,
      installationId: result.verdict === "current" ? null : await getInstallationDeviceId(),
    });
  } catch (error) {
    console.warn("[agent-toolchain] toolchain notice skipped:", error);
    return null;
  }
}
