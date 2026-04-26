"use server";

import { auth } from "@/lib/auth";
import {
  issueMcpApiToken,
  listMcpApiTokens,
  revokeMcpApiToken,
  type IssueMcpTokenResult,
  type McpTokenCapability,
} from "@/lib/auth/mcp-api-token";
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
      };
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

function buildSetupSnippets(plaintext: string, baseUrl: string): {
  claudeCode: string;
  codex: string;
  vscode: string;
} {
  const url = `${baseUrl}/api/mcp/v1`;
  const claudeCode = JSON.stringify(
    {
      mcpServers: {
        dpf: {
          url,
          headers: { Authorization: `Bearer ${plaintext}` },
        },
      },
    },
    null,
    2,
  );
  // Codex CLI uses similar JSON config
  const codex = JSON.stringify(
    {
      mcpServers: {
        dpf: {
          url,
          headers: { Authorization: `Bearer ${plaintext}` },
        },
      },
    },
    null,
    2,
  );
  // VS Code MCP `.vscode/mcp.json`
  const vscode = JSON.stringify(
    {
      servers: {
        dpf: {
          url,
          headers: { Authorization: `Bearer ${plaintext}` },
        },
      },
    },
    null,
    2,
  );
  return { claudeCode, codex, vscode };
}

export async function issueMyMcpToken(input: {
  name: string;
  capability: McpTokenCapability;
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
    scopes: input.scopes,
    expiresInDays: input.expiresInDays,
    agentId: input.agentId ?? null,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message };
  }
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
