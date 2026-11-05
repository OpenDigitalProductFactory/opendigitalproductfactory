// BI-825D3487: which knowledge corpora a coworker may read (spec
// 2026-10-28-corpus-scoped-read-grants-design.md; knowledge-linking §2 R5).
//
// Three grants govern the three corpora: `wiki_kernel_read` (WWMD),
// `wiki_org_read` (WWWD) and `wiki_profession_read` (WSID). They sit in the code
// read baseline, so every coworker holds them by default, but unlike the rest of
// the baseline an AgentToolGrantRevocation row removes one. The profession grant
// covers the coworker's own JSI family only, resolved by the same function
// profession grounding uses, so the grant check and the prompt grounding always
// agree. A job that spans professions gets one `wiki_profession_read:<key>` row
// per extra family.
//
// Every knowledge read path asks this module; none reads grants itself.

import { coworkerAuthorityWhere } from "@/lib/coworker-identity";
import { findProfessionFamilyForAgentIdentity, PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import type { ToolResult } from "@/lib/mcp-tool-types";
import type { WikiReader } from "@/lib/wiki/backlinks";

export const WIKI_KERNEL_READ = "wiki_kernel_read";
export const WIKI_ORG_READ = "wiki_org_read";
export const WIKI_PROFESSION_READ = "wiki_profession_read";
export const WIKI_CORPUS_GRANTS = [WIKI_KERNEL_READ, WIKI_ORG_READ, WIKI_PROFESSION_READ] as const;

const EXTRA_FAMILY_PREFIX = `${WIKI_PROFESSION_READ}:`;
const REPORT_THREAD_PREFIX = "corpus-grant-report:";

export const CORPUS_GRANT_MODES = ["report-only", "enforce"] as const;
export type CorpusGrantMode = (typeof CORPUS_GRANT_MODES)[number];

/**
 * Report-only is this release's default (§2 D3): unmapped coworkers keep
 * profession reads while the report lists them. Anything but "enforce" reads as
 * report-only, so a typo never narrows access by surprise.
 */
export function corpusGrantMode(env: Record<string, string | undefined> = process.env): CorpusGrantMode {
  return env.DPF_WIKI_CORPUS_GRANT_MODE?.trim() === "enforce" ? "enforce" : "report-only";
}

export type CorpusReadScope = {
  kernel: boolean;
  organization: boolean;
  /** Families the reader may read; null = no family filter (people, or report-only unmapped). */
  professionFamilies: ReadonlySet<string> | null;
  /** The reader's own family, ranked first; null when it has none. */
  familyKey: string | null;
  /** False when the coworker resolves to no profession family. */
  mapped: boolean;
  /** True when an unmapped coworker kept profession reads only because the mode is report-only. */
  reportOnlyUnmapped: boolean;
};

/** People are not limited by family (R5 "People"); RBAC governs them. */
export const PERSON_CORPUS_SCOPE: CorpusReadScope = {
  kernel: true,
  organization: true,
  professionFamilies: null,
  familyKey: null,
  mapped: true,
  reportOnlyUnmapped: false,
};

const PROFESSION_KEYS = new Set(PROFESSION_REGISTRY.families.map((family) => family.professionKey));

/** True for `wiki_profession_read:<key>` naming a registered profession family. */
export function isExtraFamilyGrantKey(grantKey: string): boolean {
  return grantKey.startsWith(EXTRA_FAMILY_PREFIX) && PROFESSION_KEYS.has(grantKey.slice(EXTRA_FAMILY_PREFIX.length));
}

export function extraFamilyGrantKey(professionKey: string): string {
  return `${EXTRA_FAMILY_PREFIX}${professionKey}`;
}

/** True for any grant key this module governs; their changes leave an authority trail. */
export function isCorpusGrantKey(grantKey: string): boolean {
  return (WIKI_CORPUS_GRANTS as readonly string[]).includes(grantKey) || isExtraFamilyGrantKey(grantKey);
}

export type CorpusAgentRecord = {
  agentId: string;
  slugId: string | null;
  name: string | null;
  toolGrants: ReadonlyArray<{ grantKey: string }>;
  toolGrantRevocations: ReadonlyArray<{ grantKey: string }>;
};

/** Pure: the corpus scope for a coworker's authority record. */
export function corpusScopeForAgent(agent: CorpusAgentRecord, mode: CorpusGrantMode): CorpusReadScope {
  const revoked = new Set(agent.toolGrantRevocations.map((row) => row.grantKey));
  const family = findProfessionFamilyForAgentIdentity({ agentId: agent.agentId, slugId: agent.slugId, name: agent.name });
  const families = new Set<string>();
  if (family && !revoked.has(WIKI_PROFESSION_READ)) families.add(family.professionKey);
  for (const { grantKey } of agent.toolGrants) {
    if (isExtraFamilyGrantKey(grantKey) && !revoked.has(grantKey)) families.add(grantKey.slice(EXTRA_FAMILY_PREFIX.length));
  }
  const mapped = family !== null;
  const reportOnlyUnmapped = !mapped && mode === "report-only";
  return {
    kernel: !revoked.has(WIKI_KERNEL_READ),
    organization: !revoked.has(WIKI_ORG_READ),
    professionFamilies: reportOnlyUnmapped ? null : families,
    familyKey: family?.professionKey ?? null,
    mapped,
    reportOnlyUnmapped,
  };
}

/** The profession family a wiki slug belongs to, or null for a non-profession page. */
export function professionFamilyOfSlug(slug: string): string | null {
  return /^professions\/([^/]+)\//.exec(slug)?.[1] ?? null;
}

/** May this scope read a wiki page? The corpus half of the backlinks reader's rule. */
export function corpusScopeAllowsPage(
  scope: CorpusReadScope,
  page: { slug: string; organizationId: string | null },
): boolean {
  if (page.organizationId !== null) return scope.organization;
  const family = professionFamilyOfSlug(page.slug);
  if (family !== null) return scope.professionFamilies === null || scope.professionFamilies.has(family);
  return scope.kernel;
}

/** The backlinks `WikiReader` for a scope; a revoked organization corpus reads as no organization. */
export function wikiReaderForCorpusScope(scope: CorpusReadScope, organizationId: string | null): WikiReader {
  return {
    organizationId: scope.organization ? organizationId : null,
    professionFamilies: scope.professionFamilies,
    familyKey: scope.familyKey,
    kernel: scope.kernel,
  };
}

// ─── DB-reading wrapper ─────────────────────────────────────────────────────

/** Minimal Prisma surface, so tests can stub it. */
export type CorpusScopeDb = {
  agent: { findFirst: (args: Record<string, unknown>) => Promise<unknown> };
  toolExecution: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

async function defaultDb(): Promise<CorpusScopeDb> {
  const { prisma } = await import("@dpf/db");
  return prisma as unknown as CorpusScopeDb;
}

/**
 * The corpus scope of a caller. No coworker identity means a person, who is not
 * family-limited. Grant rows are read from the canonical authority row; when the
 * reference names no row the family still resolves from the reference itself.
 * An unreadable authority grants nothing, the same posture as
 * getAgentToolGrantsAsync: a revocation that cannot be read must not lapse.
 */
export async function resolveCorpusReadScope(
  agentRef: string | null | undefined,
  options: { db?: CorpusScopeDb; mode?: CorpusGrantMode } = {},
): Promise<CorpusReadScope> {
  const ref = (agentRef ?? "").trim();
  if (!ref) return PERSON_CORPUS_SCOPE;
  const mode = options.mode ?? corpusGrantMode();
  try {
    const db = options.db ?? (await defaultDb());
    const row = (await db.agent.findFirst({
      where: coworkerAuthorityWhere(ref),
      select: {
        agentId: true, slugId: true, name: true,
        toolGrants: { select: { grantKey: true } },
        toolGrantRevocations: { select: { grantKey: true } },
      },
    })) as Partial<CorpusAgentRecord> | null;
    return corpusScopeForAgent({
      agentId: row?.agentId ?? ref, slugId: row?.slugId ?? null, name: row?.name ?? null,
      toolGrants: row?.toolGrants ?? [], toolGrantRevocations: row?.toolGrantRevocations ?? [],
    }, mode);
  } catch {
    const family = findProfessionFamilyForAgentIdentity({ agentId: ref });
    return {
      kernel: false,
      organization: false,
      professionFamilies: new Set(),
      familyKey: family?.professionKey ?? null,
      mapped: family !== null,
      reportOnlyUnmapped: false,
    };
  }
}

// ─── Refusals ───────────────────────────────────────────────────────────────

const CORPUS_LABEL = { kernel: "platform kernel", organization: "organization knowledge" } as const;

/** A refusal naming the missing grant, or null when the scope holds the corpus. */
export function corpusRefusal(scope: CorpusReadScope, corpus: "kernel" | "organization", toolName: string): ToolResult | null {
  if (scope[corpus]) return null;
  const grant = corpus === "kernel" ? WIKI_KERNEL_READ : WIKI_ORG_READ;
  return {
    success: false,
    error: "corpus_grant_missing",
    message: `${toolName} reads the ${CORPUS_LABEL[corpus]} corpus, which needs the ${grant} grant. It is revoked for this coworker.`,
  };
}

/** A refusal naming the coworker's own family when its profession read is revoked, else null. */
export function ownFamilyRefusal(scope: CorpusReadScope, toolName: string): ToolResult | null {
  if (scope.familyKey === null || scope.professionFamilies === null || scope.professionFamilies.has(scope.familyKey)) return null;
  return {
    success: false,
    error: "corpus_family_not_granted",
    message: `${toolName} reads the ${scope.familyKey} profession corpus, which is outside this coworker's granted families (${WIKI_PROFESSION_READ} is revoked).`,
  };
}

/** Tool-pack guard: resolve the caller and refuse when it lacks the corpus. */
export async function refuseWithoutCorpus(
  agentRef: string | null | undefined,
  corpus: "kernel" | "organization" | "own-family",
  toolName: string,
): Promise<ToolResult | null> {
  const scope = await resolveCorpusReadScope(agentRef);
  return corpus === "own-family" ? ownFamilyRefusal(scope, toolName) : corpusRefusal(scope, corpus, toolName);
}

// ─── Report-only record (§2 D3) ─────────────────────────────────────────────

/**
 * Record that an unmapped coworker read profession pages only because the mode
 * is report-only. A row of its own, because wiki_query's governed audit row is
 * metrics-only and keeps no payload; `journal` keeps it for the report window.
 */
export async function recordCorpusGrantReport(
  input: { agentId: string; userId: string; toolName: string; slugs: string[]; threadId?: string | null; routeContext?: string | null },
  db?: CorpusScopeDb,
): Promise<void> {
  const client = db ?? (await defaultDb());
  await client.toolExecution.create({ data: {
    threadId: `${REPORT_THREAD_PREFIX}${input.agentId}`, agentId: input.agentId, userId: input.userId,
    toolName: input.toolName, executionMode: "immediate", auditClass: "journal",
    routeContext: input.routeContext ?? null,
    parameters: { kind: "corpus-grant-report", sourceThreadId: input.threadId ?? null },
    result: { slugs: input.slugs },
    success: true,
    summary: `corpus-grant-report: unmapped coworker read ${input.slugs.length} profession page(s) in report-only mode`,
  } });
}

export type UnmappedProfessionReader = { agentId: string; reads: number; lastReadAt: Date; families: string[] };

/** The unmapped coworkers that read profession pages under report-only, most recent first. */
export async function listUnmappedProfessionReaders(
  options: { db?: CorpusScopeDb; since?: Date } = {},
): Promise<UnmappedProfessionReader[]> {
  const db = options.db ?? (await defaultDb());
  const rows = (await db.toolExecution.findMany({
    where: { threadId: { startsWith: REPORT_THREAD_PREFIX }, ...(options.since ? { createdAt: { gte: options.since } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { agentId: true, createdAt: true, result: true },
  })) as Array<{ agentId: string; createdAt: Date; result: unknown }>;
  const byAgent = new Map<string, { reads: number; lastReadAt: Date; families: Set<string> }>();
  for (const row of rows) {
    const entry = byAgent.get(row.agentId) ?? { reads: 0, lastReadAt: row.createdAt, families: new Set<string>() };
    entry.reads += 1;
    if (row.createdAt > entry.lastReadAt) entry.lastReadAt = row.createdAt;
    const slugs = (row.result as { slugs?: unknown } | null)?.slugs;
    for (const slug of Array.isArray(slugs) ? slugs : []) {
      const family = typeof slug === "string" ? professionFamilyOfSlug(slug) : null;
      if (family) entry.families.add(family);
    }
    byAgent.set(row.agentId, entry);
  }
  return [...byAgent.entries()].map(([agentId, entry]) => ({
    agentId, reads: entry.reads, lastReadAt: entry.lastReadAt, families: [...entry.families].sort(),
  }));
}
