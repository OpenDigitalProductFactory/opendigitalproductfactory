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
import { getContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import {
  CODING_AGENT_MCP_TOKEN_SCOPES,
  deriveIdleDays,
  getMcpTokenTemplate,
  isMcpTokenArchived,
  MCP_TOKEN_TEMPLATES,
  resolveTemplateGrants,
  type McpTokenTemplate,
  type McpTokenTemplateId,
} from "@/lib/mcp-token-scopes";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { prisma } from "@dpf/db";

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
    return {
      ok: false as const,
      error: "unauthorized",
      tokens: [],
      archivedCount: 0,
    };
  }
  const tokens = await listMcpApiTokens(session.user.id);
  const now = new Date();

  // Archive filter: revoked tokens older than MCP_TOKEN_REVOKED_ARCHIVE_DAYS
  // (90 days) fall off the admin UI entirely. They remain in the DB so the
  // ToolExecution audit FK chain is intact — forensic replay via
  // /platform/ai/authority continues to surface them via raw queries.
  const archivedCount = tokens.filter((t) => isMcpTokenArchived(t.revokedAt, now)).length;
  const visible = tokens.filter((t) => !isMcpTokenArchived(t.revokedAt, now));

  return {
    ok: true as const,
    archivedCount,
    tokens: visible.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      tokenSuffix: t.tokenSuffix,
      canCopy: t.canCopy,
      capability: t.capability,
      scope: t.scope,
      scopes: t.scopes,
      // Lifecycle classification. "operator" tokens are manually managed;
      // "ephemeral_ship" tokens are auto-issued/revoked by build phase
      // transitions. The UI surfaces this so the operator can tell them
      // apart and so we can suppress manual revoke/rotate affordances on
      // lifecycle-managed rows.
      kind: t.kind,
      buildId: t.buildId,
      // The acting coworker this token speaks as (BI-B986A18B). Null means the
      // token is anonymous, which is invisible in the UI today and is exactly
      // why every Work Room tool refused every external agent: room handlers
      // resolve the caller from this and fail closed without it.
      agentId: t.agentId ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      // Idle days only meaningful for active tokens. Revoked / expired rows
      // get null so the UI can show "—" instead of an ever-growing number.
      idleDays:
        t.revokedAt != null ||
        (t.expiresAt != null && t.expiresAt.getTime() < now.getTime())
          ? null
          : deriveIdleDays(t.lastUsedAt, now),
      expiresAt: t.expiresAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function getMyContributorMcpReadiness(input?: {
  probe?: boolean;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "unauthorized" };
  }

  const readiness = await getContributorMcpReadiness(session.user.id, {
    probe: input?.probe ?? false,
  });
  return { ok: true as const, readiness };
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
        grok: string;
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

export type ActingCoworkerOption = {
  agentId: string;
  label: string;
};

/**
 * Coworkers a token may be issued to act as (BI-B986A18B).
 *
 * Restricted to agents holding `work_room_write`, because acting-as is only
 * meaningful for identities that can participate in a Work Room. Binding grants
 * the token an identity; it does NOT admit that identity to any room —
 * admission stays outcome-scoped and invite-driven per
 * `authorizeWorkRoomAccess`.
 */
export async function listActingCoworkerOptions(): Promise<{
  options: ActingCoworkerOption[];
}> {
  const session = await auth();
  if (!session?.user?.id) return { options: [] };

  const grants = await prisma.agentToolGrant.findMany({
    where: { grantKey: "work_room_write" },
    select: { agent: { select: { agentId: true, name: true, displayName: true, status: true } } },
  });

  const seen = new Set<string>();
  const options: ActingCoworkerOption[] = [];
  for (const grant of grants) {
    const agent = grant.agent;
    if (!agent || agent.status !== "active") continue;
    if (seen.has(agent.agentId)) continue;
    seen.add(agent.agentId);
    const name = agent.displayName?.trim() || agent.name?.trim() || agent.agentId;
    options.push({ agentId: agent.agentId, label: `${name} (${agent.agentId})` });
  }
  options.sort((a, b) => a.label.localeCompare(b.label));
  return { options };
}

export async function issueMyTemplateMcpToken(input: {
  templateId: McpTokenTemplateId;
  name: string;
  expiresInDays: number | null;
  /**
   * Bind the token to an acting coworker identity (BI-B986A18B). Work Room
   * tools resolve `context.agentId` from here; a token issued without one can
   * never join, post to, or read a room, because every room handler refuses
   * with `invalid_caller — requires an acting coworker`.
   */
  agentId?: string | null;
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

// Functional "edit grants on a live token" without violating immutability.
// The McpToken row stays untouched audit-wise — we issue a NEW token with
// the operator-edited grants and revoke the old in one atomic operator
// action. Order: issue first, then revoke. Doing it the other way around
// would leave the operator with zero working tokens if the issue call
// failed.
//
// On partial failure (issue ok, revoke fails) we surface the new token
// plaintext anyway and flag the revoke failure so the operator can
// manually revoke the old row from the list — never silently drop the new
// token, never let the operator end up with neither.
export type RotateWithEditResult = IssueTokenActionResult & {
  // Present on success when the underlying revoke of the old token row
  // failed. The new token is already live in this case; the operator must
  // revoke the old row manually from the list.
  oldTokenRevokeError?: string;
};

export async function rotateMyMcpTokenWithEdit(input: {
  tokenId: string;
  name: string;
  scope: McpTokenScope;
  scopes: string[];
  expiresInDays: number | null;
  baseUrl: string;
}): Promise<RotateWithEditResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized", message: "Sign in first" };
  }
  if (input.scopes.length === 0) {
    return {
      ok: false,
      error: "no_scopes",
      message: "Pick at least one scope before rotating the token.",
    };
  }

  // Ownership + active-state check. We refuse to rotate revoked or expired
  // tokens — that's a re-issue scenario, not a rotation, and the operator
  // should use the issue flow instead.
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
    return { ok: false, error: "revoked", message: "Revoked tokens cannot be rotated." };
  }
  if (owned.expiresAt != null && owned.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired", message: "Expired tokens cannot be rotated." };
  }

  const capability: McpTokenCapability = input.scope === "read" ? "read" : "write";
  const issueResult: IssueMcpTokenResult = await issueMcpApiToken({
    userId: session.user.id,
    // Fall back to the old name so the new row is identifiable in the list.
    name: input.name.trim() || owned.name,
    capability,
    scope: input.scope,
    scopes: input.scopes,
    expiresInDays: input.expiresInDays,
    // Rotation changes the secret, never the identity (BI-B986A18B). Dropping
    // the binding here silently demoted a room-capable token to an anonymous
    // one, so the coworker fell out of every room it had joined on the next
    // rotation with no error anywhere.
    agentId: owned.agentId ?? null,
  });
  if (!issueResult.ok) {
    return { ok: false, error: issueResult.error, message: issueResult.message };
  }

  writeMcpJsonToHost(issueResult.plaintext, input.baseUrl);

  const revokeResult = await revokeMcpApiToken(input.tokenId, "rotated with edited grants");

  const base: IssueTokenActionResult = {
    ok: true,
    tokenId: issueResult.tokenId,
    plaintext: issueResult.plaintext,
    prefix: issueResult.prefix,
    tokenSuffix: issueResult.tokenSuffix,
    expiresAt: issueResult.expiresAt?.toISOString() ?? null,
    setupSnippets: buildSetupSnippets(issueResult.plaintext, input.baseUrl),
  };

  if (!revokeResult.ok) {
    // New token IS live — flag the cleanup gap so the UI can prompt for a
    // manual revoke instead of pretending the old row is gone.
    return { ...base, oldTokenRevokeError: revokeResult.error };
  }
  return base;
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

// Per-token result for bulk-revoke. The UI surfaces successes and failures
// together so the operator knows exactly which rows landed and which need
// follow-up — we never silently drop a request.
export type BulkRevokeResult = {
  ok: true;
  results: Array<{
    tokenId: string;
    ok: boolean;
    error?: string;
    /** "revoked" if the call mutated the DB, "already_revoked" if the row
     *  was already in revoked state (treated as a success — idempotent), or
     *  the underlying revoke error key on failure. */
    status: "revoked" | "already_revoked" | "not_found_or_not_yours" | "error";
  }>;
  /** Count of rows that ended in revoked state after this call (including
   *  already-revoked idempotent hits). */
  revokedCount: number;
  /** Count of rows that failed (ownership mismatch or underlying error). */
  failedCount: number;
};

export async function bulkRevokeMyMcpTokens(input: {
  tokenIds: string[];
  reason: string;
}): Promise<BulkRevokeResult | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthorized" };
  }
  if (input.tokenIds.length === 0) {
    return { ok: true, results: [], revokedCount: 0, failedCount: 0 };
  }
  // Dedup defensively — a misclick or stale UI state could submit the same
  // id twice; we don't want to double-write the audit row.
  const uniqueIds = Array.from(new Set(input.tokenIds));

  // Single ownership lookup for the batch — avoids N queries.
  const tokens = await listMcpApiTokens(session.user.id);
  const ownedById = new Map(tokens.map((t) => [t.id, t]));

  const results: BulkRevokeResult["results"] = [];
  let revokedCount = 0;
  let failedCount = 0;

  for (const tokenId of uniqueIds) {
    const owned = ownedById.get(tokenId);
    if (!owned) {
      results.push({ tokenId, ok: false, error: "not_found_or_not_yours", status: "not_found_or_not_yours" });
      failedCount += 1;
      continue;
    }
    if (owned.revokedAt != null) {
      // Idempotent success — the row is already in the target state.
      results.push({ tokenId, ok: true, status: "already_revoked" });
      revokedCount += 1;
      continue;
    }
    const revokeResult = await revokeMcpApiToken(tokenId, input.reason);
    if (revokeResult.ok) {
      results.push({ tokenId, ok: true, status: "revoked" });
      revokedCount += 1;
    } else {
      results.push({
        tokenId,
        ok: false,
        error: revokeResult.error,
        status: "error",
      });
      failedCount += 1;
    }
  }

  return { ok: true, results, revokedCount, failedCount };
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
