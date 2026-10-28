// BI-FEDD8F45 — /ops/gate-efficacy: whether gates and guards earn their cost.
// GPP §11 measures and per-guard catch, false-refusal, override and cost, each
// with numerator, denominator, unit and what it leaves out. Read-only: no
// approval or write action. Unknown is shown as unknown, never as zero or as a
// reassuring badge. Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.6, §5.1.

import { prisma } from "@dpf/db";

import { GuardTable, MeasureTable, type GuardRow } from "@/components/ops/GateEfficacyTables";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { StatCard } from "@/components/ui/report-kit/StatCard";
import { LocalTime } from "@/components/ui/LocalTime";
import { loadEfficacyReport } from "@/lib/gpp/efficacy/efficacy-measures-store";
import { getT } from "@/lib/i18n/t.server";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

export const dynamic = "force-dynamic";

export default async function GateEfficacyPage() {
  const [report, t] = await Promise.all([loadEfficacyReport(prisma), getT("admin")]);
  const runs = report.guards.reduce((sum, g) => sum + g.runs, 0);
  const classified = report.guards.reduce((sum, g) => sum + (g.catchRate.denominator ?? 0), 0);
  const unknown = report.gpp.filter((m) => m.value === null).map((m) => m.id);
  const waiting = report.approvalLoad.find((m) => m.id === "envelopes:waiting")?.numerator ?? 0;
  const guardRows: GuardRow[] = report.guards.map((g) => ({
    guardId: g.guardId,
    runs: g.runs,
    totalDurationMs: g.totalDurationMs,
    medianDurationMs: g.medianDurationMs,
    catchRate: g.catchRate,
    falseRefusalRate: g.falseRefusalRate,
    overrideRate: g.overrideRate,
    undecidedShare: g.undecidedShare,
  }));

  return (
    <div>
      <div className="mb-4" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("gateEfficacy.title")}</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {t("gateEfficacy.from")} <LocalTime value={report.period.from} /> {t("gateEfficacy.to")} <LocalTime value={report.period.to} />:{" "}
          {t("gateEfficacy.summary", { runs: runs.toLocaleString(), classified: classified.toLocaleString(), unknown: unknown.join(", ") || t("gateEfficacy.none") })}
        </p>
        <p className="mt-1 text-sm text-[var(--dpf-text)]" {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "" }}>
          {t("gateEfficacy.noDecision")}
        </p>
      </div>

      <PlatformTabNav />

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
        <StatCard label={t("gateEfficacy.stats.checks")} value={runs.toLocaleString()} hint={t("gateEfficacy.stats.checksHint")} />
        <StatCard label={t("gateEfficacy.stats.refusals")} value={classified.toLocaleString()} />
        <StatCard label={t("gateEfficacy.stats.waiting")} value={waiting.toLocaleString()} hint={t("gateEfficacy.stats.waitingHint")} />
        <StatCard label={t("gateEfficacy.stats.unknown")} value={unknown.length.toLocaleString()} intent={unknown.length > 0 ? "warning" : "neutral"} />
      </section>

      <details className="mt-6">
        <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--dpf-text)]">{t("gateEfficacy.sections.measures")}</summary>
        <div className="mt-2 space-y-4">
          <MeasureTable rows={report.gpp} label={t("gateEfficacy.tables.gpp")} />
          <MeasureTable rows={[...report.proxies, ...report.approvalLoad]} label={t("gateEfficacy.tables.proxies")} />
          <MeasureTable rows={[...report.m1PerAgent, ...report.m3Mix, ...report.m4ByAction]} label={t("gateEfficacy.tables.breakdowns")} />
        </div>
      </details>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--dpf-text)]">{t("gateEfficacy.sections.guards")}</summary>
        <div className="mt-2">
          <GuardTable rows={guardRows} />
        </div>
      </details>
    </div>
  );
}
