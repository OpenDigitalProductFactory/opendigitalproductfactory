// Browser Session Ledger query (EP-BROWSER-DRIVE, spec §10.1).
//
// Read model for the operator ledger surface: lists driven sessions with the
// fields the report-kit table renders. Read-only over BrowserSessionBinding;
// individual actions live in ToolExecution (the ledger links out, it is not an
// action log).

import { prisma } from "@dpf/db";

export type BrowserSessionLedgerRow = {
  sessionId: string;
  means: string;
  engine: string;
  profileKind: string;
  attended: boolean;
  status: string;
  targetDomains: string[];
  delegatingUserId: string;
  actingPrincipalId: string | null;
  credentialId: string | null;
  evidenceDir: string | null;
  startedAt: string;
  closedAt: string | null;
};

export type LedgerQuery = {
  status?: string;
  delegatingUserId?: string;
  limit?: number;
};

/** List browser sessions for the ledger, newest first. */
export async function listBrowserSessions(query: LedgerQuery = {}): Promise<BrowserSessionLedgerRow[]> {
  const rows = await prisma.browserSessionBinding.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.delegatingUserId ? { delegatingUserId: query.delegatingUserId } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: Math.min(query.limit ?? 50, 200),
  });

  return rows.map((r) => ({
    sessionId: r.sessionId,
    means: r.means,
    engine: r.engine,
    profileKind: r.profileKind,
    attended: r.attended,
    status: r.status,
    targetDomains: r.targetDomains,
    delegatingUserId: r.delegatingUserId,
    actingPrincipalId: r.actingPrincipalId,
    credentialId: r.credentialId,
    evidenceDir: r.evidenceDir,
    startedAt: r.startedAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
  }));
}

export type ServiceAccountProfileRow = {
  actingPrincipalId: string;
  siteKeys: string[];
  targetDomains: string[];
  /** Credential freshness: configured | needs-reauth | unconfigured | unknown. */
  credentialStatus: string;
  lastTestedAt: string | null;
  lastErrorMsg: string | null;
};

/**
 * List provisioned service-account browser profiles for the Setup surface, with
 * credential freshness. One row per acting service Principal; joins the latest
 * binding's domains with the IntegrationCredential health signals (§10.1).
 */
export async function listServiceAccountProfiles(): Promise<ServiceAccountProfileRow[]> {
  const bindings = await prisma.browserSessionBinding.findMany({
    where: { profileKind: "service-account", actingPrincipalId: { not: null } },
    orderBy: { startedAt: "desc" },
  });

  const byPrincipal = new Map<string, { siteKeys: Set<string>; domains: Set<string>; credentialIds: Set<string> }>();
  for (const b of bindings) {
    const pid = b.actingPrincipalId as string;
    const entry = byPrincipal.get(pid) ?? { siteKeys: new Set(), domains: new Set(), credentialIds: new Set() };
    // profileRef is /profiles/<principalId>/<siteKey>/ — recover the siteKey segment.
    const seg = b.profileRef.split("/").filter(Boolean).pop();
    if (seg) entry.siteKeys.add(seg);
    for (const d of b.targetDomains) entry.domains.add(d);
    if (b.credentialId) entry.credentialIds.add(b.credentialId);
    byPrincipal.set(pid, entry);
  }

  const credIds = Array.from(new Set(Array.from(byPrincipal.values()).flatMap((e) => Array.from(e.credentialIds))));
  const creds = credIds.length
    ? await prisma.integrationCredential.findMany({ where: { integrationId: { in: credIds } } })
    : [];
  const credById = new Map(creds.map((c) => [c.integrationId, c]));

  return Array.from(byPrincipal.entries()).map(([pid, e]) => {
    const cred = Array.from(e.credentialIds).map((id) => credById.get(id)).find(Boolean);
    return {
      actingPrincipalId: pid,
      siteKeys: Array.from(e.siteKeys),
      targetDomains: Array.from(e.domains),
      credentialStatus: cred?.status ?? "unknown",
      lastTestedAt: cred?.lastTestedAt ? cred.lastTestedAt.toISOString() : null,
      lastErrorMsg: cred?.lastErrorMsg ?? null,
    };
  });
}

/** Count sessions per status for the ledger KPI tiles. */
export async function browserSessionStatusCounts(): Promise<Record<string, number>> {
  const grouped = await prisma.browserSessionBinding.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.status] = g._count._all;
  return out;
}
