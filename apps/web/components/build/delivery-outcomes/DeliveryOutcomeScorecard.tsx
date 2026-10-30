"use client";
import Link from "next/link";
import { LocalTime } from "@/components/ui/LocalTime";
import { DataTable, EmptyState, FilterBar, Notice, KpiCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { DeliveryOutcomeScorecard as Scorecard, DurationSummary, Economy, OutcomeObservation } from "@/lib/delivery-outcomes/projection";
const duration = (ms: number | null) => ms === null ? "Unavailable" : ms >= 86400000 ? `${(ms / 86400000).toFixed(1)}d` : ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : `${Math.round(ms / 60000)}m`;
const amount = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const stageNames: Record<DurationSummary["key"], string> = { cycle: "Claim to verified", claimedToPr: "Claim to PR", prToReady: "PR to ready", readyToMerge: "Ready to merge", mergeToVerified: "Merge to verified", process: "Process", wait: "Wait" };
const milestoneNames={claimed:"Claimed",firstCommit:"First commit",prOpen:"PR open",reviewReady:"Review ready",merged:"Merged",verified:"Verified"};
const timeColumns: Column<DurationSummary>[] = [{ key: "stage", header: "Measure", cell: r => stageNames[r.key] }, { key: "p50", header: "Median", cell: r => duration(r.p50Ms) }, { key: "p90", header: "p90", cell: r => duration(r.p90Ms) }, { key: "sample", header: "Complete / missing", cell: r => `${r.sample} / ${r.incomplete}` }];
const roomColumns: Column<OutcomeObservation>[] = [
    { key: "room", header: "Workroom", cell: r => <Link className="text-dpf-accent hover:underline" href={r.href}>{r.capsuleId} · {r.title}</Link>, mobileFullWidth: true },
    { key: "outcome", header: "Outcome", cell: r => <StatusBadge intent={r.milestones.verified ? "success" : "neutral"} label={r.milestones.verified ? "Verified" : r.quality.abandoned ? "Abandoned" : r.quality.superseded ? "Superseded" : "Not verified"}/> },
    { key: "cycle", header: "Cycle", cell: r => duration(r.durations.cycle) },
    { key: "attention", header: "Quality and attention", cell: r => <details><summary className="cursor-pointer">Inspect measures</summary><dl className="mt-2 space-y-1 text-sm">
        <dt>Protected checks / findings per kLOC</dt><dd>Unavailable / Unavailable</dd>
        <dt>Post-open commits</dt><dd>{amount(r.quality.postOpenCommits)}</dd>
        <dt>Reopens / regressions</dt><dd>{amount(r.quality.reopens)} / {amount(r.quality.regressions)}</dd>
        <dt>Tools / failed calls</dt><dd>{amount(r.attention.toolCalls)} / {amount(r.attention.failedToolCalls)}</dd>
        <dt>Recorded approvals / takeovers</dt><dd>{amount(r.attention.approvals)} / {amount(r.attention.takeovers)}</dd>
        <dt>Non-progress calls / interventions</dt><dd>Unavailable / Unavailable</dd>
        <dt>Lease wait / lane utilization</dt><dd>Unavailable / Unavailable</dd>
        <dt>Package breadth / risk tier</dt><dd>Unavailable / Unavailable</dd>
    </dl></details> },
    { key: "evidence", header: "Evidence", cell: r => <span className="flex flex-wrap gap-2">{r.evidence.slice(1).map(e => <a className="text-dpf-accent hover:underline" key={e.href} href={e.href}>{e.label}</a>)}</span> },
];
type UsageRow = {
    key: string;
    room: OutcomeObservation;
    scope: "exclusive" | "inclusive";
    value: Economy;
};
const usageColumns: Column<UsageRow>[] = [
    { key: "room", header: "Workroom / scope", cell: r => <Link className="text-dpf-accent hover:underline" href={r.room.href}>{r.room.capsuleId} · {r.scope === "exclusive" ? "Direct" : "With descendants"}</Link>, mobileFullWidth: true },
    { key: "input", header: "Uncached input", cell: r => amount(r.value.inputTokens) },
    { key: "cached", header: "Cache read / write", cell: r => `${amount(r.value.cachedInputTokens)} / ${amount(r.value.cacheCreationInputTokens)}` },
    { key: "output", header: "Output / reasoning", cell: r => `${amount(r.value.outputTokens)} / ${amount(r.value.reasoningTokens)}` },
    { key: "cost", header: "API-equivalent estimate (USD)", cell: r => amount(r.value.apiEquivalentUsd) },
    { key: "invoice", header: "Invoiced spend / subscription (USD)", cell: r => `${amount(r.value.invoicedUsd)} / ${amount(r.value.subscriptionUsd)}` },
];
/** Formatting only: cohort selection, metric definitions and math stay server-owned. */
export function DeliveryOutcomeScorecard({ data, query = "", dimension = "all" }: {
    data: Scorecard;
    query?: string;
    dimension?: string;
}) {
    const cycle = data.stages.find(s => s.key === "cycle")!;
    const usage = data.observations.flatMap(room => (["exclusive", "inclusive"] as const).map(scope => ({ key: `${room.capsuleId}:${scope}`, room, scope, value: room.economy[scope] })));
    return <section className="space-y-6 px-4 py-4 text-dpf-text">
    <div><Link href="/build/work" className="text-sm text-dpf-accent hover:underline">Workrooms</Link><h1 className="mt-3 text-dpf-heading font-dpf-semibold">Delivery outcomes</h1>
      <p className="mt-1 text-sm text-dpf-muted">30 days · {data.cohort.start.slice(0, 10)} to {data.cohort.end.slice(0, 10)} · {data.observations.length} visible slices · {data.campaigns} campaigns</p></div>
    <div className="grid gap-3 md:grid-cols-3">
      <KpiCard label="Verified outcomes" value={data.state === "failed" ? "Unavailable" : `${data.verified} / ${data.observations.length}`} hint="Source and final live acceptance matched"/>
      <KpiCard label="Cycle time" value={duration(cycle.p50Ms)} hint={`Median · p90 ${duration(cycle.p90Ms)} · ${cycle.sample} complete pairs`}/>
      <KpiCard label="First-pass checks" value="Unavailable" hint="Protected-check history is missing"/>
    </div>
    {data.state === "failed" ? <Notice variant="error" title="Read unavailable">Room data could not be verified. Return to Workrooms and try this view again.</Notice> : data.state === "partial" || data.state === "stale" ? <Notice variant="warn" title="Partial coverage">Open cohort and sources before comparing periods.</Notice> : null}
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">Cohort and sources</summary>
      <p className="mt-3 text-sm text-dpf-muted">{data.cohort.definition} {data.cohort.confidence}</p>
      <p className="mt-2 text-sm text-dpf-muted">Missing milestones stay unavailable. A merged PR or completed room does not establish a verified outcome. No person or model is ranked by PR count or lines changed.</p>
      <DataTable ariaLabel="Source coverage" responsive rows={data.sources} getRowKey={r => r.key + ":" + r.state} columns={[
            { key: "source", header: "Source", cell: r => r.key }, { key: "state", header: "Coverage", cell: r => r.state }, { key: "rows", header: "Recorded rows", cell: r => r.count }, {key:"observed",header:"Observed",cell:r=><LocalTime value={r.observedAt}/>}, { key: "note", header: "Limits", cell: r => r.note ?? "Recorded within this period" },
        ]}/>
    </details>
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">Where time goes</summary>
      <p className="my-3 text-sm text-dpf-muted">Process is measured execution time, separate from waiting. It does not measure human touch time or value added. Percentiles use complete pairs; missing pairs remain visible.</p>
      <DataTable ariaLabel="Time through delivery" responsive rows={data.stages} columns={timeColumns} getRowKey={r => r.key}/>
      <DataTable ariaLabel="Recorded delivery milestones" responsive rows={data.milestoneCounts} getRowKey={r=>r.key} columns={[
        {key:"milestone",header:"Milestone",cell:r=>milestoneNames[r.key]},{key:"count",header:"Recorded / missing",cell:r=>`${r.count} / ${r.missing}`},
      ]}/>
    </details>
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">Usage and cost</summary>
      <p className="my-3 text-sm text-dpf-muted">Unique retained adapter runs, direct or with task descendants. Cache reads, writes, output and reasoning stay separate. Estimates are not invoices. Totals with missing classes are incomplete; ambiguous input accounting stays unavailable.</p>
      <DataTable ariaLabel="Usage and spend by Workroom" responsive columns={usageColumns} rows={usage} getRowKey={r => r.key} pageSize={10}/>
    </details>
    <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4"><summary className="cursor-pointer font-dpf-medium">Workrooms and evidence</summary>
      <div className="my-3"><FilterBar mode="url" basePath="/build/work" preserveKeys={["view"]} value={{ view: "outcomes", q: query, dimension }} resultCount={data.observations.length} facets={[
            { kind: "search", key: "q", placeholder: "Search cohort" }, { kind: "select", key: "dimension", label: "Match", options: [{ value: "all", label: "All fields" }, { value: "campaign", label: "Campaign" }, { value: "model", label: "Model" }, { value: "installation", label: "Installation" }, { value: "kind", label: "Work kind" }, { value: "repository", label: "Repository" }, { value: "risk", label: "Risk tier" }, { value: "profile", label: "Effort / profile" }] },
        ]}/></div>
      {data.observations.length ? <DataTable ariaLabel="Outcome evidence" responsive columns={roomColumns} rows={data.observations} getRowKey={r => r.capsuleId} pageSize={10}/> : <EmptyState title="No visible Workrooms" description="No admitted rooms match this fixed period and filter. This is not a measure of productivity."/>}
    </details>
  </section>;
}
