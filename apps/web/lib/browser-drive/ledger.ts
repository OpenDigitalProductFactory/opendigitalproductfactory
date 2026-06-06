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
