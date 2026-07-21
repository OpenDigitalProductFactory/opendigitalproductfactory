// Decision log — the audit surface over the DecisionInteraction ledger,
// split by governance tier (WWMD / WWWD / WSID). Answers "is the decision
// gate actually being used, and what did it decide?" — per-tier usage stats
// up top, the decision timeline below, drill-in per row.
// Server component; queries Prisma directly (same pattern as the decision-governance hub).

import Link from "next/link";
import { prisma } from "@dpf/db";

import { StatCard } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import { DecisionAuditTable } from "@/components/wiki/DecisionAuditTable";
import {
  DECISION_AUDIT_TIERS,
  buildCallerStats,
  buildTierStats,
  tierWhere,
  toAuditRow,
  type DecisionAuditRowInput,
  type DecisionAuditTier,
} from "@/lib/wiki/decision-audit";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Decision log",
};

type SearchParams = Promise<{ tier?: string }>;

const UNRESOLVED = ["defer", "escalate"];
const ROW_LIMIT = 200;

function isTier(value: string | undefined): value is DecisionAuditTier {
  return (DECISION_AUDIT_TIERS as readonly string[]).includes(value ?? "");
}

export default async function DecisionLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const activeTier = isTier(sp.tier) ? sp.tier : null;

  const now = Date.now();
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Per-tier usage stats (always all three, independent of the filter) +
  // the filtered timeline rows, in parallel.
  const [tierStatRaw, rows] = await Promise.all([
    Promise.all(
      DECISION_AUDIT_TIERS.map(async (tier) => {
        const where = tierWhere(tier);
        const [total, last7d, last30d, unresolved, latest] = await Promise.all([
          prisma.decisionInteraction.count({ where }),
          prisma.decisionInteraction.count({
            where: { ...where, createdAt: { gte: d7 } },
          }),
          prisma.decisionInteraction.count({
            where: { ...where, createdAt: { gte: d30 } },
          }),
          prisma.decisionInteraction.count({
            where: { ...where, outcomeType: { in: UNRESOLVED }, escalationCapture: null },
          }),
          prisma.decisionInteraction.findFirst({
            where,
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          }),
        ]);
        return buildTierStats({
          tier,
          total,
          last7d,
          last30d,
          unresolved,
          lastDecisionAt: latest?.createdAt ?? null,
        });
      }),
    ),
    prisma.decisionInteraction.findMany({
      where: activeTier ? tierWhere(activeTier) : undefined,
      orderBy: { createdAt: "desc" },
      take: ROW_LIMIT,
      select: {
        interactionId: true,
        createdAt: true,
        question: true,
        options: true,
        outcomeType: true,
        riskTier: true,
        principleConflict: true,
        domainClass: true,
        routeContext: true,
        rationale: true,
        confidenceAfter: true,
        outcomePayload: true,
        humanOutcome: true,
        gateKey: true,
        gateFallbackUsed: true,
        profile: { select: { kind: true, name: true } },
        escalationCapture: { select: { createdAt: true } },
        deferralCapture: { select: { gapReason: true } },
      },
    }) as Promise<DecisionAuditRowInput[]>,
  ]);

  const auditRows = rows.map(toAuditRow);
  const callerStats = buildCallerStats(auditRows);

  const tierFilters: Array<{ label: string; tier: DecisionAuditTier | null }> = [
    { label: "All tiers", tier: null },
    { label: "WWMD", tier: "wwmd" },
    { label: "WWWD", tier: "wwwd" },
    { label: "WSID", tier: "wsid" },
  ];

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
              Decision log
            </h1>
            <p className="text-sm text-[var(--dpf-muted)]">
              Every governed decision your AI workforce consulted the kernel on —
              what was asked, what was recommended, and which calls still need a
              human. A silent tier means that gate isn&rsquo;t being exercised.
            </p>
          </div>
          <Link
            href="/coworker-decisions"
            className="text-sm text-[var(--dpf-accent)] hover:underline shrink-0"
          >
            ← Coworker Decision Engine
          </Link>
        </div>
      </header>

      {/* Per-tier usage — the "is the gate in play?" answer at a glance. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {tierStatRaw.map((s) => (
          <StatCard
            key={s.tier}
            label={`${s.code} — ${s.expansion}`}
            value={s.total === 0 ? "never used" : String(s.last30d)}
            intent={s.total === 0 ? "warning" : s.unresolved > 0 ? "info" : "success"}
            hint={
              s.total === 0
                ? "No decisions recorded on this tier yet."
                : `${s.last30d} in 30d · ${s.unresolved} awaiting review · ${s.total} all-time`
            }
            href={`/coworker-decisions/decisions?tier=${s.tier}`}
          />
        ))}
      </div>

      {/* Who consults — a client working outside this list never consulted
          the kernel at all, which is itself the finding. */}
      {callerStats.length > 0 ? (
        <div className="mb-6 rounded-lg border border-[var(--dpf-border)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
            Consults by caller{activeTier ? ` — ${activeTier.toUpperCase()}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {callerStats.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-xs"
              >
                <span className="font-medium text-[var(--dpf-text)]">{c.label}</span>
                <span className="text-[var(--dpf-muted)]">×{c.total}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--dpf-muted)]">
            A client or agent that never appears here has never consulted the
            decision kernel.
          </p>
        </div>
      ) : null}

      {/* Tier filter */}
      <div className="flex items-center gap-2 mb-4">
        {tierFilters.map((f) => {
          const active = f.tier === activeTier;
          return (
            <Link
              key={f.label}
              href={f.tier ? `/coworker-decisions/decisions?tier=${f.tier}` : "/coworker-decisions/decisions"}
              className={
                active
                  ? "rounded-full border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-[var(--dpf-border)] px-3 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
              }
            >
              {f.label}
            </Link>
          );
        })}
        <span className="ml-auto text-xs text-[var(--dpf-muted)]">
          {auditRows.length === ROW_LIMIT
            ? `Showing the most recent ${ROW_LIMIT}`
            : `${auditRows.length} decision${auditRows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <DecisionAuditTable rows={auditRows} />

      {tierStatRaw.some((s) => s.lastDecisionAt) ? (
        <p className="mt-4 text-xs text-[var(--dpf-muted)]">
          Most recent decision:{" "}
          <LocalTime
            value={
              tierStatRaw
                .map((s) => s.lastDecisionAt)
                .filter((v): v is string => Boolean(v))
                .sort()
                .at(-1)
            }
          />
        </p>
      ) : null}
    </div>
  );
}
