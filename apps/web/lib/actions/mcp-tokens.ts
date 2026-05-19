"use server";

import { auth } from "@/lib/auth";
import {
  addScopesToMcpApiToken,
  issueMcpApiToken,
  listMcpApiTokens,
  revokeMcpApiToken,
  type IssueMcpTokenResult,
  type McpTokenCapability,
  type McpTokenScope,
} from "@/lib/auth/mcp-api-token";
import { buildSetupSnippets } from "@/lib/auth/mcp-setup-snippets";
import { writeMcpJsonToHost } from "@/lib/auth/mcp-host-writer";
import {
  CODING_AGENT_MCP_TOKEN_SCOPES,
  WRITE_MCP_TOKEN_SCOPES,
} from "@/lib/mcp-token-scopes";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";

/**
 * Returns the set of distinct grant keys this user could possibly include
 * in a token's scopes. Today this is the union of every grant key that
 * appears in TOOL_TO_GRANTS — the per-user filter happens at issue time
 * via the platform-role capability check inside governedExecuteTool, not
 * at scope-selection time. The settings UI uses this to populate the
 * scope multi-select.
 */
export async function listAvailableMcpScopes(): Promise<{
  scopes: string[];
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { scopes: [] };
  }
  const map = getToolGrantMapping();
  const set = new Set<string>();
  for (const grants of Object.values(map)) {
    for (const g of grants) set.add(g);
  }
  return { scopes: [...set].sort() };
}

export async function listMyMcpTokens() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "unauthorized", tokens: [] };
  }
  const tokens = await listMcpApiTokens(session.user.id);
  return {
    ok: true as const,
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      capability: t.capability,
      scope: t.scope,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export type IssueTokenActionResult =
  | {
      ok: true;
      tokenId: string;
      plaintext: string;
      prefix: string;
      expiresAt: string | null;
      setupSnippets: {
        claudeCode: string;
        codex: string;
        vscode: string;
        syncCommand: string;
      };
    }
  | {
      ok: false;
      error: string;
      message: string;
    };


export async function issueMyMcpToken(input: {
  name: string;
  capability: McpTokenCapability;
  scope?: McpTokenScope;
  scopes: string[];
  expiresInDays: number | null;
  agentId?: string | null;
  baseUrl: string;
}): Promise<IssueTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }
  const result: IssueMcpTokenResult = await issueMcpApiToken({
    userId: session.user.id,
    name: input.name,
    capability: input.capability,
    scope: input.scope ?? input.capability,
    scopes: input.scopes,
    expiresInDays: input.expiresInDays,
    agentId: input.agentId ?? null,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message };
  }
  writeMcpJsonToHost(result.plaintext, input.baseUrl);
  return {
    ok: true,
    tokenId: result.tokenId,
    plaintext: result.plaintext,
    prefix: result.prefix,
    expiresAt: result.expiresAt?.toISOString() ?? null,
    setupSnippets: buildSetupSnippets(result.plaintext, input.baseUrl),
  };
}

export async function issueMyWriteMcpToken(input: {
  baseUrl: string;
  name?: string;
  expiresInDays?: number | null;
}): Promise<IssueTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }

  const result: IssueMcpTokenResult = await issueMcpApiToken({
    userId: session.user.id,
    name: input.name?.trim() || "Write MCP token",
    capability: "write",
    scope: "write",
    scopes: [...WRITE_MCP_TOKEN_SCOPES],
    expiresInDays: input.expiresInDays === undefined ? 90 : input.expiresInDays,
    agentId: null,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message };
  }
  writeMcpJsonToHost(result.plaintext, input.baseUrl);
  return {
    ok: true,
    tokenId: result.tokenId,
    plaintext: result.plaintext,
    prefix: result.prefix,
    expiresAt: result.expiresAt?.toISOString() ?? null,
    setupSnippets: buildSetupSnippets(result.plaintext, input.baseUrl),
  };
}

export async function revokeMyMcpToken(input: {
  tokenId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized" };
  }
  // Lookup-then-check to make sure the user owns the token (defense against
  // direct API calls bypassing the UI listing).
  const tokens = await listMcpApiTokens(session.user.id);
  const owned = tokens.find((t) => t.id === input.tokenId);
  if (!owned) {
    return { ok: false, error: "not_found_or_not_yours" };
  }
  return revokeMcpApiToken(input.tokenId, input.reason);
}

export async function upgradeMyMcpTokenForCodingAgent(input: {
  tokenId: string;
}): Promise<
  | { ok: true; scopes: string[]; addedScopes: string[] }
  | { ok: false; error: string; message: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }

  const tokens = await listMcpApiTokens(session.user.id);
  const owned = tokens.find((t) => t.id === input.tokenId);
  if (!owned) {
    return {
      ok: false,
      error: "not_found_or_not_yours",
      message: "Token was not found for the current user.",
    };
  }
  if (owned.revokedAt != null) {
    return { ok: false, error: "revoked", message: "Revoked tokens cannot be upgraded." };
  }
  if (owned.expiresAt != null && owned.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired", message: "Expired tokens cannot be upgraded." };
  }

  const result = await addScopesToMcpApiToken(input.tokenId, [
    ...CODING_AGENT_MCP_TOKEN_SCOPES,
  ]);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: `Could not upgrade token: ${result.error}`,
    };
  }
  return result;
}
