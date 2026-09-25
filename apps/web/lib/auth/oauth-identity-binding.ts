import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { can } from "@/lib/govern/permissions";
import { currentUserContext } from "@/lib/govern/current-user-context";
import type { PublicScope } from "./oauth-public-scopes";

type Db = Pick<Prisma.TransactionClient, "user" | "agent" | "authorityBinding">;
/** The source-approved external development roles: the connection profile any
 *  human with platform view may consent to, and the default an external AI
 *  client lands on. One list, read by eligibility and by default resolution. */
export const APPROVED_EXTERNAL_ROLES = ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"] as const;
export const OAUTH_SETUP_REQUIRED =
  "Reconnect to approve an assistant role before starting work.";

export async function currentOAuthHuman(userId: string, db: Db = prisma) {
  return currentUserContext(userId, db);
}

/** Human approval is authority. The client-provided app name is never queried. */
export async function eligibleOAuthCoworkers(
  userId: string, clientId: string, resource: string, db: Db = prisma,
  selection: { agentId?: string; after?: string } = {},
) {
  const human = await currentOAuthHuman(userId, db);
  if (!human) return [];
  // Human consent can delegate the source-approved development profile within
  // their build permission. Other coworker identities require an administrator
  // or an existing delegation for this human/client/resource combination.
  const administrator = can(human, "manage_agents");
  const delegation: Prisma.AgentWhereInput = { authorityBindings: { some: {
    oauthPurpose: "delegation", oauthUserId: userId, oauthClientId: clientId,
    resourceRef: resource, status: "active",
  } } };
  const approvedExternalRole: Prisma.AgentWhereInput[] = can(human, "view_platform")
    ? [{ agentId: { in: [...APPROVED_EXTERNAL_ROLES] } }] : [];
  return db.agent.findMany({
    where: { status: "active", archived: false,
      ...(selection.agentId ? { agentId: selection.agentId } : selection.after ? { agentId: { gt: selection.after } } : {}),
      toolGrants: { some: { grantKey: "work_room_write" } },
      ...(!administrator ? { OR: [delegation, ...approvedExternalRole] } : {}),
    },
    select: { id: true, agentId: true, displayName: true },
    orderBy: { agentId: "asc" },
    take: selection.agentId ? 1 : 51,
  });
}

export async function createOAuthConsentBinding(input: {
  userId: string; clientId: string; resource: string; agentId: string;
  scopes: PublicScope[];
}, db: Db) {
  const eligible = await eligibleOAuthCoworkers(input.userId, input.clientId, input.resource, db, { agentId: input.agentId });
  const agent = eligible.find((candidate) => candidate.agentId === input.agentId);
  if (!agent) throw new Error(OAUTH_SETUP_REQUIRED);
  return db.authorityBinding.create({ data: {
    bindingId: `AB-OAUTH-${randomUUID()}`,
    name: "Approved assistant connection", scopeType: "resource",
    resourceType: "mcp", resourceRef: input.resource, status: "active",
    oauthPurpose: "consent", oauthUserId: input.userId, oauthClientId: input.clientId,
    appliedAgentId: agent.id,
    grants: { create: input.scopes.map((grantKey) => ({ grantKey, mode: "allow" })) },
  } });
}

export async function resolveOAuthConsent(input: {
  bindingId: string; userId: string; clientId: string; resource: string;
  scopes: readonly string[];
}, db: Db = prisma): Promise<{ agentId: string; agentRecordId: string } | null> {
  const binding = await db.authorityBinding.findUnique({ where: { id: input.bindingId },
    include: { appliedAgent: true, grants: true } });
  if (!binding || binding.oauthPurpose !== "consent" || binding.status !== "active"
    || binding.oauthUserId !== input.userId || binding.oauthClientId !== input.clientId
    || binding.resourceRef !== input.resource || !binding.appliedAgent
    || binding.appliedAgent.status !== "active" || binding.appliedAgent.archived
    || !input.scopes.every((scope) => binding.grants.some((g) => g.grantKey === scope && g.mode === "allow"))) return null;
  const eligible = await eligibleOAuthCoworkers(input.userId, input.clientId, input.resource, db, { agentId: binding.appliedAgent.agentId });
  return eligible.some((agent) => agent.id === binding.appliedAgentId)
    ? { agentId: binding.appliedAgent.agentId, agentRecordId: binding.appliedAgent.id } : null;
}

// ---------------------------------------------------------------------------
// Server-resolved default assistant (BI-05E0EA33).
//
// The consent screen used to ask the human to pick an assistant from the
// eligible set. On every real install that set is the three source-approved
// external development roles, which carry identical grants, clearance and
// tier, so the pick decided a label and nothing a token can do — and the
// human was transcribing the client's untrusted name into that pick, which
// is exactly where a mis-selection happened. The server does the same
// comparison here, after a check the human could not perform: it proves the
// candidates are authority-equivalent first, and only then lets the name
// choose a label. When candidates differ in authority the outcome is a
// specific choice, least authority first, never a silent default.
//
// Design: docs/superpowers/specs/2026-09-21-oauth-external-build-authority-design.md
// § One-click connection.
// ---------------------------------------------------------------------------

import agentRegistryData from "../../../../packages/db/data/agent_registry.json";

export type EligibleCoworker = { id: string; agentId: string; displayName: string };
export type CoworkerCandidate = EligibleCoworker & { detail?: string };

export type DefaultCoworkerResolution =
  | { kind: "single"; selected: EligibleCoworker; candidates: CoworkerCandidate[] }
  | { kind: "resolved"; reason: "prior_consent" | "external_profile" | "alias" | "first"; selected: EligibleCoworker; candidates: CoworkerCandidate[] }
  | { kind: "choice"; selected: EligibleCoworker; candidates: CoworkerCandidate[] };

type ResolutionDb = Pick<Prisma.TransactionClient, "agent" | "authorityBinding" | "principalAlias">;

/** Scheme, host and path must match; the loopback port is ignored, the same
 *  carve-out `isRedirectUriAllowed` makes. Any pair across the two lists. */
export function sameRedirectFamily(a: readonly string[], b: readonly string[]): boolean {
  const key = (raw: string): string | null => {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
      return `${u.protocol}//${host}${loopback ? "" : `:${u.port}`}${u.pathname}`;
    } catch {
      return null;
    }
  };
  const left = new Set(a.map(key).filter((k): k is string => k !== null));
  return b.some((raw) => { const k = key(raw); return k !== null && left.has(k); });
}

function registryAliases(agentId: string): string[] {
  const entry = (agentRegistryData.agents as Array<{ agent_id: string; agent_name?: string; aliases?: string[] }>)
    .find((a) => a.agent_id === agentId);
  if (!entry) return [];
  return [...(entry.aliases ?? []), ...(entry.agent_name ? [entry.agent_name] : [])].map((s) => s.toLowerCase());
}

function nameMatchesAlias(clientName: string, aliases: readonly string[]): boolean {
  const name = clientName.toLowerCase();
  return aliases.some((alias) => alias.length > 0
    && new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(name));
}

const CLEARANCE_ORDER = ["public", "internal", "confidential", "restricted"];

type Signature = { key: string; grantCount: number; clearance: string[]; hitl: number };

async function authoritySignatures(eligible: readonly EligibleCoworker[], db: ResolutionDb): Promise<Map<string, Signature>> {
  const rows = await db.agent.findMany({
    where: { id: { in: eligible.map((e) => e.id) } },
    select: { id: true, agentId: true, hitlTierDefault: true, sensitivity: true,
      toolGrants: { select: { grantKey: true } }, toolGrantRevocations: { select: { grantKey: true } } },
  });
  const aliases = await db.principalAlias.findMany({
    where: { aliasType: "agent", aliasValue: { in: eligible.map((e) => e.agentId) } },
    select: { aliasValue: true, principal: { select: { sensitivityClearance: true } } },
  });
  const clearanceByAgent = new Map<string, string[]>();
  for (const alias of aliases) {
    clearanceByAgent.set(alias.aliasValue, [...(alias.principal?.sensitivityClearance ?? [])].map(String).sort());
  }
  const out = new Map<string, Signature>();
  for (const row of rows) {
    const revoked = new Set(row.toolGrantRevocations.map((r) => r.grantKey));
    const grants = [...new Set(row.toolGrants.map((g) => g.grantKey).filter((g) => !revoked.has(g)))].sort();
    const clearance = clearanceByAgent.get(row.agentId) ?? ["public"];
    out.set(row.id, {
      key: `${grants.join(",")}|hitl=${row.hitlTierDefault}|sens=${row.sensitivity}|clr=${clearance.join(",")}`,
      grantCount: grants.length, clearance, hitl: row.hitlTierDefault,
    });
  }
  return out;
}

function describeSignature(sig: Signature | undefined): string {
  if (!sig) return "authority not readable";
  const top = [...sig.clearance].sort((a, b) => CLEARANCE_ORDER.indexOf(a) - CLEARANCE_ORDER.indexOf(b)).at(-1) ?? "public";
  return `${sig.grantCount} permission${sig.grantCount === 1 ? "" : "s"}, data up to ${top}`;
}

/**
 * Decide which eligible coworker the consent will bind unless the human
 * changes it. Pure lookup over rows the server owns; the client name is
 * consulted last and only inside a class already proven authority-equal.
 */
export async function resolveDefaultOAuthCoworker(input: {
  userId: string;
  client: { rowId: string; clientName: string; redirectUris: readonly string[] };
  resource: string;
  eligible: readonly EligibleCoworker[];
}, db: ResolutionDb = prisma): Promise<DefaultCoworkerResolution> {
  const eligible = [...input.eligible].sort((a, b) => a.agentId.localeCompare(b.agentId));
  if (eligible.length === 0) throw new Error(OAUTH_SETUP_REQUIRED);
  if (eligible.length === 1) return { kind: "single", selected: eligible[0], candidates: [eligible[0]] };

  // Rule 1 runs BEFORE the authority-signature check, and the reason matters.
  // A prior consent is a decision this same human already recorded for this
  // resource, this self-asserted name and this redirect family. It is not the
  // client's name choosing an identity; it is the human's own earlier choice
  // being reused, which is exactly what a reconnect should do. An
  // administrator's eligible set spans every room-write coworker, so the
  // signatures there always differ and a rule that waited for equality could
  // never fire for the one person most likely to reconnect (AC-OC-7 live
  // finding, 2026-09-23). Without a prior consent the mixed set still yields
  // a choice, least authority first, exactly as designed.
  const prior = await db.authorityBinding.findMany({
    where: { oauthPurpose: "consent", status: "active", oauthUserId: input.userId, resourceRef: input.resource,
      appliedAgentId: { in: eligible.map((e) => e.id) } },
    orderBy: { createdAt: "desc" }, take: 25,
    select: { appliedAgentId: true, oauthClient: { select: { clientName: true, redirectUris: true } } },
  });
  const wanted = input.client.clientName.trim().toLowerCase();
  const signatures = await authoritySignatures(eligible, db);
  const withDetail = (list: readonly EligibleCoworker[]): CoworkerCandidate[] =>
    list.map((c) => ({ ...c, detail: describeSignature(signatures.get(c.id)) }));
  for (const binding of prior) {
    const c = binding.oauthClient;
    if (!c || c.clientName.trim().toLowerCase() !== wanted) continue;
    if (!sameRedirectFamily(c.redirectUris, input.client.redirectUris)) continue;
    const match = eligible.find((e) => e.id === binding.appliedAgentId);
    if (match) return { kind: "resolved", reason: "prior_consent", selected: match, candidates: withDetail(eligible) };
  }

  // Rule 1b: an external AI client connecting lands on the source-approved
  // external development profile, not on whichever coworker in an
  // administrator's wider set has the fewest grants. Every builder already
  // gets exactly this profile; an administrator's extra reach (room
  // coordinators such as the Mailroom) is theirs to opt into under Change,
  // never a question put to them on every connect. The name still only picks
  // a label inside a class proven authority-equal, as in rule 2 (live
  // finding 2026-09-25: an administrator's Claude desktop connect preselected
  // the Mailroom coordinator).
  const external = eligible.filter((e) => (APPROVED_EXTERNAL_ROLES as readonly string[]).includes(e.agentId));
  if (external.length > 0 && external.length < eligible.length) {
    const externalKeys = new Set(external.map((e) => signatures.get(e.id)?.key ?? `unreadable:${e.id}`));
    if (externalKeys.size === 1) {
      const byAlias = external.find((e) => nameMatchesAlias(input.client.clientName, registryAliases(e.agentId)));
      return { kind: "resolved", reason: "external_profile", selected: byAlias ?? external[0], candidates: withDetail(eligible) };
    }
  }

  const keys = new Set(eligible.map((e) => signatures.get(e.id)?.key ?? `unreadable:${e.id}`));
  if (keys.size > 1) {
    const ranked = [...eligible].sort((a, b) => {
      const sa = signatures.get(a.id); const sb = signatures.get(b.id);
      return (sa?.grantCount ?? Number.MAX_SAFE_INTEGER) - (sb?.grantCount ?? Number.MAX_SAFE_INTEGER)
        || (sa?.clearance.length ?? 99) - (sb?.clearance.length ?? 99)
        || a.agentId.localeCompare(b.agentId);
    });
    return { kind: "choice", selected: ranked[0], candidates: withDetail(ranked) };
  }

  // Rule 2: a registry alias that appears as a whole word in the name.
  const byAlias = eligible.find((e) => nameMatchesAlias(input.client.clientName, registryAliases(e.agentId)));
  if (byAlias) return { kind: "resolved", reason: "alias", selected: byAlias, candidates: eligible };

  // Rule 3: total and deterministic.
  return { kind: "resolved", reason: "first", selected: eligible[0], candidates: eligible };
}
