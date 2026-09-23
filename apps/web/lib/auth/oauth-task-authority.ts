import { prisma } from "@dpf/db";
import { isCurrentOAuthExecutionAuthority, OAUTH_EXECUTION_AUTHORITY_SELECT } from "./oauth-tokens";

/** A transport credential rotates; its authorized task namespace does not. */
export async function resolveMcpTaskAuthorityKey(token: { tokenId: string; userId: string; source: string }) {
  if (token.source !== "oauth") return token.tokenId;
  const row = await prisma.mcpApiToken.findUnique({ where: { id: token.tokenId },
    select: { ...OAUTH_EXECUTION_AUTHORITY_SELECT, oauthFamilyKey: true } });
  if (!row || row.userId !== token.userId || !await isCurrentOAuthExecutionAuthority(row)) return null;
  if (row.oauthClient?.registrationKind === "credentials" && row.oauthClientId) {
    return `oauth-client:${row.oauthClientId}:${row.userId}`;
  }
  if (!row.authorityBindingId || !row.oauthFamilyKey) return null;
  return `oauth-family:${row.oauthFamilyKey}`;
}
