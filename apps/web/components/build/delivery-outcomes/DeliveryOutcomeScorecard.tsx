"use client";
import Link from "next/link";
import type { MessageKey } from "@dpf/i18n";
import { useT } from "@/lib/i18n/use-t";
import { formatDuration } from "@/lib/datetime";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { LocalTime } from "@/components/ui/LocalTime";
import { DataTable, EmptyState, FilterBar, Notice, KpiCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { DeliveryOutcomeScorecard as Scorecard, DurationSummary, Economy, OutcomeObservation } from "@/lib/delivery-outcomes/projection";
type UsageRow = {
    key: string;
    room: OutcomeObservation;
    scope: "exclusive" | "inclusive";
    value: Economy;
};
/** Formatting only: cohort selection, metric definitions and math stay server-owned. */
export function DeliveryOutcomeScorecard({ data, query = "", dimension = "all", formatLocale }: {
    data: Scorecard;
    formatLocale: string;
    query?: string;
    dimension?: string;
}) {
    const t = useT("workrooms");
    const unavailable = t("outcomes.unavailable");
    const duration = (ms: number | null) => ms === null ? unavailable : formatDuration(ms);
    const amount = (value: number | null) => value === null ? unavailable : formatMoney(value, null, formatLocale, { maximumFractionDigits: 0 });
    const money = (value: number | null) => value === null ? unavailable : formatMoney(value, "USD", formatLocale, { maximumFractionDigits: 6 });
    const stageNames = Object.fromEntries(data.stages.map(s => [s.key, t(`outcomes.stages.${s.key}`)]));
    const milestoneNames = Object.fromEntries(data.milestoneCounts.map(s => [s.key, t(`outcomes.milestones.${s.key}`)]));
    const timeColumns: Column<DurationSummary>[] = [{ key: "stage", header: t("outcomes.columns.measure"), cell: r => stageNames[r.key] }, { key: "p50", header: t("outcomes.columns.median"), cell: r => duration(r.p50Ms) }, { key: "p90", header: t("outcomes.columns.p90"), cell: r => duration(r.p90Ms) }, { key: "sample", header: t("outcomes.columns.complete"), cell: r => `${r.sample} / ${r.incomplete}` }];
    const roomColumns: Column<OutcomeObservation>[] = [
        { key: "room", header: t("outcomes.evidence.workroom"), cell: r => <Link className="text-dpf-accent hover:underline" href={r.href}>{r.capsuleId} · {r.title}</Link>, mobileFullWidth: true },
        { key: "outcome", header: t("outcomes.columns.outcome"), cell: r => <StatusBadge intent={r.milestones.verified ? "success" : "neutral"} label={r.milestones.verified ? t("outcomes.result.verified") : r.quality.abandoned ? t("outcomes.result.abandoned") : r.quality.superseded ? t("outcomes.result.superseded") : t("outcomes.result.unverified")}/> },
        { key: "cycle", header: t("outcomes.columns.cycle"), cell: r => duration(r.durations.cycle) },
        { key: "attention", header: t("outcomes.columns.attention"), cell: r => <details><summary className="cursor-pointer">{t("outcomes.quality.inspect")}</summary><dl className="mt-2 space-y-1 text-sm">
        <dt>{t("outcomes.quality.checks")}</dt><dd>{unavailable} / {unavailable}</dd>
        <dt>{t("outcomes.quality.commits")}</dt><dd>{amount(r.quality.postOpenCommits)}</dd>
        <dt>{t("outcomes.quality.regressions")}</dt><dd>{amount(r.quality.reopens)} / {amount(r.quality.regressions)}</dd>
        <dt>{t("outcomes.quality.tools")}</dt><dd>{amount(r.attention.toolCalls)} / {amount(r.attention.failedToolCalls)}</dd>
        <dt>{t("outcomes.quality.approvals")}</dt><dd>{amount(r.attention.approvals)} / {amount(r.attention.takeovers)}</dd>
        <dt>{t("outcomes.quality.interventions")}</dt><dd>{unavailable} / {unavailable}</dd>
        <dt>{t("outcomes.quality.utilization")}</dt><dd>{unavailable} / {unavailable}</dd>
        <dt>{t("outcomes.quality.risk")}</dt><dd>{unavailable} / {unavailable}</dd>
    </dl></details> },
        { key: "evidence", header: t("outcomes.columns.evidence"), cell: r => <span className="flex flex-wrap gap-2">{r.evidence.slice(1).map(e => <a className="text-dpf-accent hover:underline" key={e.href} href={e.href}>{t(e.label === "Pull request" ? "outcomes.evidence.pullRequest" : "outcomes.evidence.finalAcceptance")}</a>)}</span> },
    ];
    const usageColumns: Column<UsageRow>[] = [
        { key: "room", header: t("outcomes.columns.scope"), cell: r => <Link className="text-dpf-accent hover:underline" href={r.room.href}>{r.room.capsuleId} · {r.scope === "exclusive" ? t("outcomes.economy.direct") : t("outcomes.economy.descendants")}</Link>, mobileFullWidth: true },
        { key: "input", header: t("outcomes.columns.uncached"), cell: r => amount(r.value.inputTokens) },
        { key: "cached", header: t("outcomes.columns.cache"), cell: r => `${amount(r.value.cachedInputTokens)} / ${amount(r.value.cacheCreationInputTokens)}` },
        { key: "output", header: t("outcomes.columns.output"), cell: r => `${amount(r.value.outputTokens)} / ${amount(r.value.reasoningTokens)}` },
        { key: "cost", header: t("outcomes.columns.estimate"), cell: r => money(r.value.apiEquivalentUsd) },
        { key: "invoice", header: t("outcomes.columns.invoice"), cell: r => `${money(r.value.invoicedUsd)} / ${money(r.value.subscriptionUsd)}` },
    ];
    const cycle = data.stages.find(s => s.key === "cycle")!;
    const usage = data.observations.flatMap(room => (["exclusive", "inclusive"] as const).map(scope => ({ key: `${room.capsuleId}:${scope}`, room, scope, value: room.economy[scope] })));
    return <section className="space-y-6 px-4 py-4 text-dpf-text">
    <div><Link href="/build/work" className="text-sm text-dpf-accent hover:underline">{t("outcomes.sources.rooms")}</Link><h1 className="mt-3 text-dpf-heading font-dpf-semibold">{t("outcomes.title")}</h1>
      <p className="mt-1 text-sm text-dpf-muted">{t("outcomes.period", { from: data.cohort.start.slice(0, 10), to: data.cohort.end.slice(0, 10), slices: data.observations.length, campaigns: data.campaigns })}</p></div>
    <div className="grid gap-3 md:grid-cols-3">
      <KpiCard label={t("outcomes.verified")} value={data.state === "failed" ? t("outcomes.unavailable") : `${data.verified} / ${data.observations.length}`} hint={t("outcomes.verifiedHint")}/>
      <KpiCard label={t("outcomes.cycle")} value={duration(cycle.p50Ms)} hint={t("outcomes.cycleHint", { p90: duration(cycle.p90Ms), sample: cycle.sample })}/>
      <KpiCard label={t("outcomes.firstPass")} value={unavailable} hint={t("outcomes.firstPassHint")}/>
    </div>
    {data.state === "failed" ? <Notice variant="error" title={t("outcomes.notes.readUnavailable")}>{t("outcomes.readFailure")}</Notice> : data.state === "partial" || data.state === "stale" ? <Notice variant="warn" title={t("outcomes.partial")}>{t("outcomes.partialHint")}</Notice> : null}
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">{t("outcomes.cohort")}</summary>
      <p className="mt-3 text-sm text-dpf-muted">{t("outcomes.cohortDescription")} {t("outcomes.confidence")}</p>
      <p className="mt-2 text-sm text-dpf-muted">{t("outcomes.limits")}</p>
      <DataTable ariaLabel={t("outcomes.tables.sources")} responsive rows={data.sources} getRowKey={r => r.key + ":" + r.state} columns={[
            { key: "source", header: t("outcomes.columns.source"), cell: r => t(`outcomes.sources.${r.key}` as MessageKey<"workrooms">) }, { key: "state", header: t("outcomes.columns.coverage"), cell: r => t(`outcomes.state.${r.state}`) }, { key: "rows", header: t("outcomes.columns.rows"), cell: r => amount(r.count) }, { key: "observed", header: t("outcomes.columns.observed"), cell: r => <LocalTime value={r.observedAt}/> }, { key: "note", header: t("outcomes.columns.limits"), cell: r => t(`outcomes.notes.${r.note ?? "recorded"}` as MessageKey<"workrooms">) },
        ]}/>
    </details>
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">{t("outcomes.time")}</summary>
      <p className="my-3 text-sm text-dpf-muted">{t("outcomes.timeHint")}</p>
      <DataTable ariaLabel={t("outcomes.tables.time")} responsive rows={data.stages} columns={timeColumns} getRowKey={r => r.key}/>
      <DataTable ariaLabel={t("outcomes.tables.milestones")} responsive rows={data.milestoneCounts} getRowKey={r => r.key} columns={[
            { key: "milestone", header: t("outcomes.columns.milestone"), cell: r => milestoneNames[r.key] }, { key: "count", header: t("outcomes.columns.recordedMissing"), cell: r => `${r.count} / ${r.missing}` },
        ]}/>
    </details>
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">{t("outcomes.usage")}</summary>
      <p className="my-3 text-sm text-dpf-muted">{t("outcomes.usageHint")}</p>
      <DataTable ariaLabel={t("outcomes.tables.usage")} responsive columns={usageColumns} rows={usage} getRowKey={r => r.key} pageSize={10}/>
    </details>
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">{t("outcomes.records")}</summary>
      <div className="my-3"><FilterBar mode="url" basePath="/build/work" preserveKeys={["view"]} value={{ view: "outcomes", q: query, dimension }} resultCount={data.observations.length} facets={[
            { kind: "search", key: "q", placeholder: t("outcomes.search") }, { kind: "select", key: "dimension", label: t("outcomes.match"), options: [{ value: "all", label: t("outcomes.all") }, { value: "campaign", label: t("outcomes.campaign") }, { value: "model", label: t("outcomes.model") }, { value: "installation", label: t("outcomes.installation") }, { value: "kind", label: t("outcomes.workKind") }, { value: "repository", label: t("outcomes.repository") }, { value: "risk", label: t("outcomes.risk") }, { value: "profile", label: t("outcomes.profile") }] },
        ]}/></div>
      {data.observations.length ? <DataTable ariaLabel={t("outcomes.tables.records")} responsive columns={roomColumns} rows={data.observations} getRowKey={r => r.capsuleId} pageSize={10}/> : <EmptyState title={t("outcomes.noRooms")} description={t("outcomes.noRoomsHint")}/>}
    </details>
  </section>;
}
