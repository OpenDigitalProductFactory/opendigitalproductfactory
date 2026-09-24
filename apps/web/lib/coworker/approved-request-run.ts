import "server-only";

// BI-12E5DD91 — a person's approval completes the call it approved.
//
// A coworker call made straight over MCP (no TaskRun) used to park on an
// approval card and then wait for the client to send the identical request
// again. Nothing told the client to; the approval sat `approved` and never ran
// (envelope cmue5mrlr3qw201uu09408gfh, 2026-09-23). Task-bound calls already
// resume when their packet is replayed and are left alone here.
//
// This runs the parked call once, as the person and coworker who made it,
// through the ordinary governed executor: every grant, room, scope and
// authority check is evaluated again, and the gate spends the approval with a
// compare-and-set, so this and a racing client retry can never both run it.
// It runs nothing it cannot prove is the approved call:
//   • the stored arguments must hash to the approved input fingerprint
//     (audit redaction or bounding breaks the match, and then the client's own
//     retry remains the only path);
//   • the originating credential must still be live and still admit the tool;
//   • an OAuth credential's consent must still name the same coworker.
import { prisma } from "@dpf/db";

import { resolveOAuthConsent } from "@/lib/auth/oauth-identity-binding";
import { originalToolParameters } from "@/lib/attention/coworker-envelope-decision";
import { currentUserContext } from "@/lib/govern/current-user-context";
import {
  fingerprintCoworkerInput,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { connectionDelegationFor } from "@/lib/mcp/connection-delegation";
import { tokenAdmitsTool, normalizeTokenScope } from "@/lib/mcp/token-tool-scope";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { getToolGrantMapping, expandGrants } from "@/lib/tak/agent-grants";

export type ApprovedRequestRun =
  | { status: "executed"; message: string }
  | { status: "failed"; message: string }
  /** Not run here; the reason says why and what still can run it. */
  | { status: "not-run"; reason: ApprovedRequestNotRunReason; message: string };

export type ApprovedRequestNotRunReason =
  | "task-bound"
  | "not-approved"
  | "expired"
  | "no-pending-call"
  | "arguments-not-provable"
  | "credential-unavailable"
  | "consent-changed"
  | "scope-insufficient";

const NOT_RUN_COPY: Record<ApprovedRequestNotRunReason, string> = {
  "task-bound": "It resumes when your coworker's task continues.",
  "not-approved": "It is not in an approved state.",
  expired: "The approval window closed before it could run.",
  "no-pending-call": "The original request could not be found, so your coworker must send it again.",
  "arguments-not-provable":
    "The stored request could not be proven identical to what you approved, so your coworker must send it again.",
  "credential-unavailable": "The connection that made the request is no longer active, so it was not run.",
  "consent-changed": "The assistant's connection no longer carries the consent it had, so it was not run.",
  "scope-insufficient": "The connection's permissions no longer cover this action, so it was not run.",
};

function notRun(reason: ApprovedRequestNotRunReason): ApprovedRequestRun {
  return { status: "not-run", reason, message: NOT_RUN_COPY[reason] };
}

type RunnerDb = {
  coworkerActionEnvelope: { findUnique(args: unknown): Promise<{
    id: string; status: string; taskRunId: string | null; expiresAt: Date | null;
    delegatingUserId: string; coworkerAgentId: string; manifestActionId: string; argsJson: unknown;
  } | null> };
  toolExecution: { findFirst(args: unknown): Promise<{ parameters: unknown; apiTokenId: string | null } | null> };
  mcpApiToken: { findUnique(args: unknown): Promise<{
    id: string; userId: string; agentId: string | null; kind: string; revokedAt: Date | null;
    scope: string; capability: string; scopes: string[]; publicScopes: string[];
    authorityBindingId: string | null; oauthClientId: string | null; resource: string | null;
  } | null> };
};

type Execute = typeof governedExecuteTool;

function storedBinding(argsJson: unknown): CoworkerApprovalBinding | null {
  const binding = argsJson && typeof argsJson === "object"
    ? (argsJson as Record<string, unknown>)["approvalBinding"]
    : null;
  return binding && typeof binding === "object" ? binding as CoworkerApprovalBinding : null;
}

export async function runApprovedExternalRequest(
  envelopeId: string,
  deps: { db?: RunnerDb; execute?: Execute; now?: Date } = {},
): Promise<ApprovedRequestRun> {
  const db = deps.db ?? (prisma as unknown as RunnerDb);
  const execute = deps.execute ?? governedExecuteTool;
  const now = deps.now ?? new Date();

  const envelope = await db.coworkerActionEnvelope.findUnique({ where: { id: envelopeId } });
  if (!envelope || envelope.status !== "approved") return notRun("not-approved");
  if (envelope.taskRunId) return notRun("task-bound");
  if (!envelope.expiresAt || envelope.expiresAt.getTime() <= now.getTime()) return notRun("expired");
  const binding = storedBinding(envelope.argsJson);
  if (!binding || binding.taskRunId || binding.routeContext || binding.chainId) return notRun("task-bound");

  const pending = await db.toolExecution.findFirst({
    where: {
      // Rows written before the audit carried the column name it in the result.
      OR: [{ envelopeId }, { result: { path: ["data", "envelopeId"], equals: envelopeId } }],
      success: false,
      toolName: envelope.manifestActionId,
      userId: envelope.delegatingUserId,
      apiTokenId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { parameters: true, apiTokenId: true },
  });
  if (!pending?.apiTokenId) return notRun("no-pending-call");
  const params = originalToolParameters(pending.parameters) ?? {};
  if (fingerprintCoworkerInput(params) !== binding.inputFingerprint) return notRun("arguments-not-provable");

  const token = await db.mcpApiToken.findUnique({ where: { id: pending.apiTokenId } });
  if (
    !token
    || token.revokedAt
    || token.userId !== envelope.delegatingUserId
    || token.agentId !== envelope.coworkerAgentId
  ) {
    return notRun("credential-unavailable");
  }
  const oauth = token.kind === "oauth_access";
  if (oauth) {
    if (!token.authorityBindingId || !token.oauthClientId || !token.resource) return notRun("consent-changed");
    const consent = await resolveOAuthConsent({
      bindingId: token.authorityBindingId, userId: token.userId,
      clientId: token.oauthClientId, resource: token.resource, scopes: token.publicScopes,
    });
    if (!consent || consent.agentId !== envelope.coworkerAgentId) return notRun("consent-changed");
  }
  const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === envelope.manifestActionId);
  if (!tokenAdmitsTool(tool, getToolGrantMapping()[envelope.manifestActionId], token)) {
    return notRun("scope-insufficient");
  }

  const userContext = await currentUserContext(envelope.delegatingUserId).catch(() => null)
    ?? { userId: envelope.delegatingUserId, platformRole: null, isSuperuser: false };
  const result = await execute({
    toolName: envelope.manifestActionId,
    rawParams: params,
    userId: envelope.delegatingUserId,
    userContext,
    context: {
      agentId: envelope.coworkerAgentId,
      apiTokenId: token.id,
      callerClient: "approval-completion",
      authSource: oauth ? "oauth" : "pat",
      tokenScope: normalizeTokenScope(token),
      tokenGrantScopes: expandGrants(token.scopes),
      ...connectionDelegationFor({
        source: oauth ? "oauth" : "pat",
        agentId: token.agentId,
        authorityBindingId: token.authorityBindingId,
      }),
    },
    source: "external-jsonrpc",
  });
  return result.success
    ? { status: "executed", message: result.message ?? "Done." }
    : { status: "failed", message: result.message ?? result.error ?? "The action did not complete." };
}
