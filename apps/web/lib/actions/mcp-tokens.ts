"use server";

import { auth } from "@/lib/auth";
import {
  addScopesToMcpApiToken,
  copyMcpApiTokenPlaintext,
  issueMcpApiToken,
  listMcpApiTokens,
  revokeMcpApiToken,
  rotateMcpApiToken,
  type IssueMcpTokenResult,
  type McpTokenCapability,
  type McpTokenScope,
  type RotateMcpTokenResult,
} from "@/lib/auth/mcp-api-token";
import { buildSetupSnippets } from "@/lib/auth/mcp-setup-snippets";
import { writeMcpJsonToHost } from "@/lib/auth/mcp-host-writer";
import {
  CODING_AGENT_MCP_TOKEN_SCOPES,
  getMcpTokenTemplate,
  MCP_TOKEN_TEMPLATES,
  resolveTemplateGrants,
  type McpTokenTemplate,
  type McpTokenTemplateId,
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
      tokenSuffix: t.tokenSuffix,
      canCopy: t.canCopy,
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
      tokenSuffix: string;
      expiresAt: string | null;
      setupSnippets: {
        claudeCode: string;
        codex: string;
        vscode: string;
        syncCommand: string;
        envPowerShell: string;
        runtimeRefreshPowerShell: string;
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
    tokenSuffix: result.tokenSuffix,
    expiresAt: result.expiresAt?.toISOString() ?? null,
    setupSnippets: buildSetupSnippets(result.plaintext, input.baseUrl),
  };
}

// Lightweight DTO for the admin UI's template picker. We hand the client a
// trimmed payload (no closures, no nested helpers) since this is rendered in
// a client component.
export type McpTokenTemplateSummary = {
  id: McpTokenTemplateId;
  label: string;
  category: McpTokenTemplate["category"];
  tier: McpTokenTemplate["tier"];
  description: string;
  grants: string[];
};

export async function listMcpTokenTemplates(): Promise<{
  templates: McpTokenTemplateSummary[];
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { templates: [] };
  }
  const { scopes: availableScopes } = await listAvailableMcpScopes();
  const templates = MCP_TOKEN_TEMPLATES.map<McpTokenTemplateSummary>((t) => ({
    id: t.id,
    label: t.label,
    category: t.category,
    tier: t.tier,
    description: t.description,
    // Resolve against this install's catalog so the UI cannot pre-select a
    // grant that the platform would silently strip at issue time. The
    // `custom` template intentionally exposes no preselected grants.
    grants: resolveTemplateGrants(t, availableScopes),
  }));
  return { templates };
}

export async function issueMyTemplateMcpToken(input: {
  templateId: McpTokenTemplateId;
  name: string;
  expiresInDays: number | null;
  baseUrl: string;
}): Promise<IssueTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }
  const template = getMcpTokenTemplate(input.templateId);
  if (!template || template.id === "custom") {
    return {
      ok: false,
      error: "invalid_template",
      message:
        template?.id === "custom"
          ? "Custom tokens must be issued via issueMyMcpToken with an explicit scope list."
          : `Unknown MCP token template: ${input.templateId}`,
    };
  }

  const { scopes: availableScopes } = await listAvailableMcpScopes();
  const scopes = resolveTemplateGrants(template, availableScopes);
  if (scopes.length === 0) {
    return {
      ok: false,
      error: "no_resolvable_scopes",
      message: `Template "${template.label}" has no grants registered on this install.`,
    };
  }

  const capability: McpTokenCapability = template.tier === "read" ? "read" : "write";
  const result: IssueMcpTokenResult = await issueMcpApiToken({
    userId: session.user.id,
    name: input.name.trim() || template.label,
    capability,
    scope: template.tier,
    scopes,
    expiresInDays: input.expiresInDays,
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
    tokenSuffix: result.tokenSuffix,
    expiresAt: result.expiresAt?.toISOString() ?? null,
    setupSnippets: buildSetupSnippets(result.plaintext, input.baseUrl),
  };
}

// Back-compat alias: the one-click "Issue write token" / "Issue development
// token" button on the admin page now goes through the development template
// so the grant bundle stays in one place (mcp-token-scopes.ts). Callers that
// passed name / expiresInDays still work.
export async function issueMyWriteMcpToken(input: {
  baseUrl: string;
  name?: string;
  expiresInDays?: number | null;
}): Promise<IssueTokenActionResult> {
  return issueMyTemplateMcpToken({
    templateId: "development",
    name: input.name?.trim() || "Development MCP token",
    expiresInDays: input.expiresInDays === undefined ? 90 : input.expiresInDays,
    baseUrl: input.baseUrl,
  });
}

function isOwnedActiveToken(
  tokens: Awaited<ReturnType<typeof listMcpApiTokens>>,
  tokenId: string,
): boolean {
  const owned = tokens.find((t) => t.id === tokenId);
  if (!owned) return false;
  if (owned.revokedAt != null) return false;
  if (owned.expiresAt != null && owned.expiresAt.getTime() < Date.now()) return false;
  return true;
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

export async function copyMyMcpToken(input: {
  tokenId: string;
  baseUrl: string;
}): Promise<IssueTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }
  const tokens = await listMcpApiTokens(session.user.id);
  if (!isOwnedActiveToken(tokens, input.tokenId)) {
    return {
      ok: false,
      error: "not_found_or_not_yours",
      message: "Token was not found for the current user.",
    };
  }

  const result = await copyMcpApiTokenPlaintext(input.tokenId);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message:
        result.error === "unavailable"
          ? "This token was issued before recoverable token storage was enabled. Rotate it to get a copyable replacement."
          : `Could not copy token: ${result.error}`,
    };
  }
  return {
    ok: true,
    tokenId: input.tokenId,
    plaintext: result.plaintext,
    prefix: result.prefix,
    tokenSuffix: result.tokenSuffix,
    expiresAt: null,
    setupSnippets: buildSetupSnippets(result.plaintext, input.baseUrl),
  };
}

export async function rotateMyMcpToken(input: {
  tokenId: string;
  baseUrl: string;
}): Promise<IssueTokenActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }
  const result: RotateMcpTokenResult = await rotateMcpApiToken({
    tokenId: input.tokenId,
    userId: session.user.id,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: result.message ?? `Could not rotate token: ${result.error}`,
    };
  }
  writeMcpJsonToHost(result.plaintext, input.baseUrl);
  return {
    ok: true,
    tokenId: result.tokenId,
    plaintext: result.plaintext,
    prefix: result.prefix,
    tokenSuffix: result.tokenSuffix,
    expiresAt: result.expiresAt?.toISOString() ?? null,
    setupSnippets: buildSetupSnippets(result.plaintext, input.baseUrl),
  };
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
