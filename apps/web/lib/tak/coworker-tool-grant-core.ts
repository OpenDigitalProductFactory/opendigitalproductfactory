// Pure core for provisioning a coworker's tool-authority grants: resolve the
// target coworker, validate the grant key against the closed vocabulary, and
// mutate the AgentToolGrant row. NO auth and NO revalidation live here — those
// are request-context concerns owned by the callers:
//   • the server actions in lib/actions/coworker-grants.ts (admin record page),
//   • the manage_coworker_tool_grant MCP handler (coworker-callable door).
// Keeping the mutation + validation in one module makes it the single source of
// truth and lets both callers share the same closed-vocabulary guard.

import { prisma } from "@dpf/db";

import { resolveCoworkerIdentity } from "@/lib/coworker-identity";

import { knownGrantKeys } from "./agent-grants";

export type CoworkerToolGrantAction = "grant" | "revoke";

export type ResolvedCoworker = {
  /** Agent.id — the cuid primary key AgentToolGrant.agentId references. */
  id: string;
  /** Business agentId (e.g. "AGT-WS-SCOUT"). */
  agentId: string;
  slugId: string | null;
  displayName: string;
};

/** True iff the grant key is one the runtime actually understands. */
export function isKnownGrantKey(grantKey: string): boolean {
  return knownGrantKeys().includes(grantKey);
}

/**
 * Resolve a caller-supplied coworker reference (business agentId, slugId,
 * displayName, or a registry alias) to the DB Agent row. Tries a direct DB
 * match first, then canonicalises through the registry (which understands
 * display names and aliases) and retries.
 */
export async function resolveCoworkerAgent(ref: string): Promise<ResolvedCoworker | null> {
  const trimmed = (ref ?? "").trim();
  if (!trimmed) return null;

  const select = { id: true, agentId: true, slugId: true, displayName: true } as const;

  let agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId: trimmed }, { slugId: trimmed }] },
    select,
  });

  if (!agent) {
    const canonical = resolveCoworkerIdentity(trimmed)?.agentId;
    if (canonical && canonical !== trimmed) {
      agent = await prisma.agent.findFirst({
        where: { OR: [{ agentId: canonical }, { slugId: canonical }] },
        select,
      });
    }
  }

  return agent;
}

/**
 * Grant a tool-authority key to a coworker by Agent.id (cuid). Idempotent on
 * the agentId_grantKey unique. Rejects keys outside the closed vocabulary so a
 * typo never persists a row that authorises nothing.
 */
export async function applyCoworkerToolGrant(
  agentCuid: string,
  grantKey: string,
  grantedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isKnownGrantKey(grantKey)) {
    return { ok: false, error: `Unknown grant key: ${grantKey}` };
  }
  await prisma.agentToolGrant.upsert({
    where: { agentId_grantKey: { agentId: agentCuid, grantKey } },
    update: {}, // already held — keep the original grantedBy/grantedAt
    create: { agentId: agentCuid, grantKey, grantedBy },
  });
  return { ok: true };
}

/**
 * Revoke a tool-authority key from a coworker by Agent.id (cuid). No-throw when
 * the grant is absent (deleteMany returns count 0), so a double-call is safe.
 */
export async function removeCoworkerToolGrant(
  agentCuid: string,
  grantKey: string,
): Promise<{ ok: boolean; error?: string }> {
  await prisma.agentToolGrant.deleteMany({ where: { agentId: agentCuid, grantKey } });
  return { ok: true };
}

/** True iff two coworker references resolve to the same canonical identity. */
function isSameCoworker(a: string, b: string): boolean {
  const ca = resolveCoworkerIdentity(a)?.agentId ?? a;
  const cb = resolveCoworkerIdentity(b)?.agentId ?? b;
  return ca === cb;
}

export type ManageCoworkerToolGrantResult =
  | {
      ok: true;
      coworker: ResolvedCoworker;
      grantKey: string;
      action: CoworkerToolGrantAction;
    }
  | { ok: false; code: string; message: string };

/**
 * Orchestrate a single grant/revoke on a coworker for the MCP door. Validates
 * the action + grant key, resolves the target, blocks self-dealing (a coworker
 * changing its own authority), then mutates. Returns a typed result the MCP
 * handler maps to a ToolResult. Auth (agent grant + manage_platform + act mode)
 * is enforced upstream by the MCP dispatch layer.
 */
export async function manageCoworkerToolGrant(input: {
  coworkerRef: string;
  grantKey: string;
  action: CoworkerToolGrantAction;
  /** Business agentId of the coworker invoking the tool (self-target guard). */
  callerAgentId?: string | null;
  /** Human userId recorded as grantedBy. */
  grantedBy: string;
}): Promise<ManageCoworkerToolGrantResult> {
  const coworkerRef = (input.coworkerRef ?? "").trim();
  const grantKey = (input.grantKey ?? "").trim();
  const { action } = input;

  if (!coworkerRef) {
    return { ok: false, code: "missing_coworker", message: "Provide the coworker to modify (agentId, slug, or name)." };
  }
  if (action !== "grant" && action !== "revoke") {
    return { ok: false, code: "invalid_action", message: 'action must be "grant" or "revoke".' };
  }
  if (!isKnownGrantKey(grantKey)) {
    return {
      ok: false,
      code: "unknown_grant_key",
      message: `"${grantKey}" is not a recognised tool-authority grant key.`,
    };
  }

  const target = await resolveCoworkerAgent(coworkerRef);
  if (!target) {
    return { ok: false, code: "coworker_not_found", message: `No coworker matches "${coworkerRef}".` };
  }

  const caller = (input.callerAgentId ?? "").trim();
  if (caller && isSameCoworker(caller, target.agentId)) {
    return {
      ok: false,
      code: "self_target_denied",
      message: "A coworker cannot grant or revoke its own tool authority. Ask an operator or another authorised coworker.",
    };
  }

  const res =
    action === "grant"
      ? await applyCoworkerToolGrant(target.id, grantKey, input.grantedBy)
      : await removeCoworkerToolGrant(target.id, grantKey);

  if (!res.ok) {
    return { ok: false, code: "grant_write_failed", message: res.error ?? "Failed to update the grant." };
  }

  return { ok: true, coworker: target, grantKey, action };
}
