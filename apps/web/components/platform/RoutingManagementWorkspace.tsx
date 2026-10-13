"use client";
import { useT } from "@/lib/i18n/use-t";
import { useMessagesContext } from "@/lib/i18n/messages-context";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DataTable, EmptyState, FilterBar, SearchableSelect, StatCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { ActivityRoutingWorkbench } from "./ActivityRoutingWorkbench";
import { LocalTime } from "@/components/ui/LocalTime";
import { readRoutingScope, routingHref, type RoutingScope } from "@/lib/ai-operations-map/routing-management-scope";
import { filterRoutingReceipts, routingCohorts, routingEvidenceAnchor } from "@/lib/ai-operations-map/routing-management-view-model";
import { type RoutingManagementData, type RoutingReceipt } from "@/lib/ai-operations-map/routing-management-types";
import type { OperationsMapRoutingTopology } from "@/lib/ai-operations-map/types";
import { RoutingManagementInspector, RoutingManagementOverlay, ROUTING_ACTION_CLASS, formatRoutingCost } from "./RoutingManagementInspector";
type Props = {
    data: RoutingManagementData;
    topology: OperationsMapRoutingTopology;
    evidenceEnd: string;
    windowLabel: string;
};
type Cohort = ReturnType<typeof routingCohorts>[number];
export function RoutingManagementWorkspace({ data, topology, evidenceEnd, windowLabel }: Props) {
    const t = useT("routingManagement");
    const { locale } = useMessagesContext();
    const money = (value: number | null) => formatRoutingCost(value, locale, t("notRecorded"));
    const params = useSearchParams();
    const scope = readRoutingScope(params);
    const anchor = routingEvidenceAnchor(evidenceEnd, data.observedAt);
    const query = "";
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<"assignments" | "providers" | "decisions" | "tuning" | null>(null);
    const [catalogQuery, setCatalogQuery] = useState("");
    const rows = useMemo(() => filterRoutingReceipts(data.receipts, scope, anchor, query), [data.receipts, scope.task, scope.provider, scope.data, scope.minutes, anchor, query]);
    const selected = data.receipts.find(r => r.id === selectedId);
    const cohorts = routingCohorts(rows);
    const controlById = new Map(data.controls.map(c => [c.providerId, c.view]));
    const providers = topology.providers.filter(p => p.providerType === "llm");
    const providerLabel = (id: string) => providers.find(p => p.providerId === id)?.label ?? id;
    const assignments = [...new Set(rows.map(r => r.actorId ?? "unattributed"))];
    const changeScope = (next: Partial<RoutingScope>) => {
        window.history.pushState(null, "", routingHref(`/platform/ai/operations-map?${params}`, { ...scope, ...next }));
    };
    const openCatalog = (kind: NonNullable<typeof catalog>) => { setCatalogQuery(""); setCatalog(kind); };
    const costCovered = rows.filter(r => r.costUsd !== null).length;
    const known = rows.filter(r => r.execution !== "unknown" && r.execution !== "pending");
    const stops = rows.filter(r => r.execution === "error" || r.execution === "blocked").length;
    const columns: Column<RoutingReceipt>[] = [
        { key: "task", header: t("taskAssignment"), cell: r => <button type="button" onClick={() => { setCatalog(null); setSelectedId(r.id); }} className="min-h-11 text-start text-[var(--dpf-accent)] underline underline-offset-2"><span className="block font-medium">{r.task}</span><span className="block text-xs text-[var(--dpf-muted)]">{r.actorId ?? t("unattributed")}</span></button> },
        { key: "route", header: t("selectedRoute"), cell: r => <div className="break-words">{r.providerId ? providerLabel(r.providerId) : t("unresolved")}<p className="text-xs text-[var(--dpf-muted)]">{r.modelId ?? t("modelUnknown")} · {r.sensitivity}</p></div> },
        { key: "execution", header: t("execution"), cell: r => <StatusBadge intent={r.execution === "success" ? "success" : r.execution === "error" ? "danger" : r.execution === "blocked" ? "warning" : "neutral"} label={r.execution}/> },
        { key: "cost", header: t("cost"), cell: r => money(r.costUsd), align: "right" },
        { key: "time", header: t("recorded"), cell: r => <LocalTime value={r.occurredAt}/> },
    ];
    const evaluationColumns: Column<Cohort>[] = [
        { key: "task", header: t("taskModelCohort"), cell: c => <div className="break-words"><p className="font-medium">{c.sample.task}</p><p className="text-xs text-[var(--dpf-muted)]">{c.sample.providerId ?? t("unknown")} · {c.sample.modelId ?? t("unknownModel")}</p><p className="text-xs text-[var(--dpf-muted)]">{c.sample.recipeKey ?? t("recipeUnavailable")}</p></div> },
        { key: "runs", header: t("routed"), cell: c => c.count },
        { key: "execution", header: t("modelExecutionSuccess"), cell: c => c.knownExecution ? t("knownUnknown", { p0: c.successes, p1: c.knownExecution, p2: c.count - c.knownExecution }) : t("noExecutionEvidence", { unknown: c.count }) },
        { key: "quality", header: t("evaluatedQuality"), cell: c => t("scored", { p0: c.evaluated, p1: c.count, p2: c.evaluated ? "" : " · unavailable" }) },
        { key: "feedback", header: t("operatorFeedback2"), cell: c => c.feedback.length ? t("acceptedAttempts", { p0: c.feedback.filter(a => a.feedback).length, p1: c.feedback.length }) : t("noFeedback") },
        { key: "cost", header: t("recordedCost"), cell: c => <span>{c.costCovered ? money(c.recordedCost) : t("unknown")}<span className="block text-xs text-[var(--dpf-muted)]">{t("pricedCount", { known: c.costCovered, total: c.count })}</span></span> },
    ];
    return <section aria-labelledby="routing-management-title" className="space-y-4 text-[var(--dpf-text)]" data-routing-management>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 id="routing-management-title" className="text-xl font-semibold">{t("routingManagement")}</h1><p className="mt-1 text-sm text-[var(--dpf-muted)]">{scope.view === "evaluation" ? t("compareOutcomesForTheSameTaskAndRecipe") : t("followWorkToItsModelInspectADecision")}</p></div><Link href={routingHref("/platform/ai/providers", scope)} className={ROUTING_ACTION_CLASS}>{t("manageProviders")}</Link></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SearchableSelect className="[&_input]:w-full [&_input]:min-w-0 [&_input]:min-h-11 [&_input]:text-sm" label={t("task")} value={scope.task} options={[{ value: "all", label: t("allTasks2") }, ...[...new Set(data.receipts.map(r => r.task))].map(task => ({ value: task, label: task }))]} onChange={task => changeScope({ task })}/>
      <SearchableSelect className="[&_input]:w-full [&_input]:min-w-0 [&_input]:min-h-11 [&_input]:text-sm" label={t("provider")} value={scope.provider} options={[{ value: "all", label: t("allProviders") }, ...providers.map(p => ({ value: p.providerId, label: p.label }))]} onChange={provider => changeScope({ provider })}/>
      <FilterBar className="[&_select]:min-h-11 [&_select]:text-sm" mode="client" facets={[{ kind: "select", key: "data", label: t("data2"), options: ["all", "public", "internal", "confidential", "restricted"].map(value => ({ value, label: t(`data.${value as "all" | "public" | "internal" | "confidential" | "restricted"}`) })) }]} value={{ data: scope.data }} onChange={next => changeScope({ data: next.data })}/>
      <FilterBar className="[&_select]:min-h-11 [&_select]:text-sm" mode="client" facets={[{ kind: "select", key: "window", label: t("window"), options: [{ value: "15", label: t("window15") }, { value: "60", label: t("window60") }, { value: "1440", label: t("window1440") }, { value: "10080", label: t("window10080") }] }]} value={{ window: String(scope.minutes) }} onChange={next => changeScope({ minutes: Number(next.window) })}/>
    </div>
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <StatCard label={t("routedDecisions")} value={rows.length} hint={t("withExecutionEvidence", { p0: known.length })}/>
      <StatCard label={t("executionSuccess")} value={known.length ? `${known.filter(r => r.execution === "success").length}/${known.length}` : t("noEvidence")} hint={t("unknownNotAQualityScore", { p0: rows.length - known.length })}/>
      <StatCard label={t("errorsBlocks")} value={stops} hint={t("inspectForCauseAndAttempts")} intent={stops ? "warning" : "neutral"}/>
      <StatCard label={t("recordedCost")} value={costCovered ? money(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)) : t("unknown")} hint={t("decisionsPriced", { p0: costCovered, p1: rows.length })}/>
    </div>
    {scope.view === "evaluation" ? <section aria-label={t("taskEvaluation")} className="space-y-3">
      <p className="text-sm text-[var(--dpf-muted)]">{t("completionEvaluatorQualityAndOperatorFeedbackAreSeparate")}</p>
      <DataTable columns={evaluationColumns} rows={cohorts} getRowKey={c => c.key} pageSize={6} empty={t("noOutcomeCohortsInThisScope")}/>
      <button className={ROUTING_ACTION_CLASS} onClick={() => openCatalog("tuning")}>{t("tuningProposalsAndAssignmentEvidence")}</button>
    </section> : <>
      <Surface as="section" aria-label={t("groupedRoutingFlow")} padding="none" rounded="xl" className="overflow-hidden">
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <FlowGroup label={t("assignments")} count={assignments.length} onOpen={() => openCatalog("assignments")}>
            {assignments.slice(0, 3).map(id => <button type="button" key={id} className={`${ROUTING_ACTION_CLASS} w-full justify-between gap-2`} onClick={() => { const r = rows.find(r => (r.actorId ?? "unattributed") === id); if (r)
            setSelectedId(r.id); }}><span className="min-w-0 truncate">{topology.coworkers.find(c => c.agentId === id)?.label ?? id}</span><span>{rows.filter(r => (r.actorId ?? "unattributed") === id).length}</span></button>)}
          </FlowGroup>
          <span aria-hidden="true" className="self-center text-center text-xl text-[var(--dpf-muted)] md:rotate-0">→</span>
          <div className="flex flex-col justify-center rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] p-4"><p className="font-semibold">{t("routingDecisions")}</p><p className="mt-2 text-sm">{t("scopeDecisionCount", { count: rows.length })}</p><p className="mt-1 text-xs text-[var(--dpf-muted)]">{t("taskDataPolicyModelEligibility")}</p><button className={`${ROUTING_ACTION_CLASS} mt-3`} onClick={() => openCatalog("decisions")}>{t("inspectTraffic")}</button></div>
          <span aria-hidden="true" className="self-center text-center text-xl text-[var(--dpf-muted)]">→</span>
          <FlowGroup label={t("providersModels")} count={providers.length} onOpen={() => openCatalog("providers")}>
            {providers.filter(p => scope.provider === "all" || p.providerId === scope.provider).slice(0, 3).map(p => <button key={p.providerId} className={`${ROUTING_ACTION_CLASS} w-full justify-between gap-2 text-start`} onClick={() => { changeScope({ provider: p.providerId }); openCatalog("providers"); }}><span className="min-w-0 truncate">{p.label}<span className="block text-xs text-[var(--dpf-muted)]">{t("catalogCount", { count: data.models.filter(m => m.providerId === p.providerId).length })}</span></span><StatusBadge intent={controlById.get(p.providerId)?.restrictions.length ? "warning" : "neutral"} label={controlById.get(p.providerId)?.eligibility.label ?? p.status}/></button>)}
          </FlowGroup>
        </div>
        {!rows.length && <EmptyState size="sm" title={t("noRoutingEvidenceInThisScope")} description={t("widenTheTimeWindowOrChangeAFilter")}/>}
      </Surface>
      <section aria-label={t("recentRoutingDecisions")} className="space-y-2"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{t("recentDecisions")}</h2><button className={ROUTING_ACTION_CLASS} onClick={() => openCatalog("decisions")}>{t("viewAllCount", { count: rows.length })}</button></div><DataTable columns={columns} rows={rows.slice(0, 3)} getRowKey={r => r.id} empty={t("noDecisionsRecordedInThisScope")}/></section>
    </>}
    <p className="text-xs text-[var(--dpf-muted)]">{windowLabel}{t("thisIsBoundedEvidenceNotACompleteTraffic")}</p>
    {selected && <RoutingManagementInspector receipt={selected} scope={scope} onClose={() => setSelectedId(null)}/>}
    {catalog && <RoutingManagementOverlay title={catalog === "tuning" ? t("tuningProposalsAndAssignmentEvidence") : catalog === "providers" ? t("providerAndModelCatalog") : catalog === "assignments" ? t("assignments") : t("routingTraffic")} onClose={() => setCatalog(null)}>
      {catalog !== "tuning" && <FilterBar className="[&_select]:min-h-11 [&_select]:text-sm" mode="client" facets={[{ kind: "search", key: "q", placeholder: t("searchByNameTaskModelOrIdentifier") }]} value={{ q: catalogQuery }} onChange={v => setCatalogQuery(v.q)}/>}
      {catalog === "tuning" ? <><p className="text-sm text-[var(--dpf-muted)]">{t("platformTuningNote")}</p><ActivityRoutingWorkbench activityRouting={topology.activityRouting}/></> : catalog === "decisions" ? <DataTable columns={columns} rows={filterRoutingReceipts(rows, scope, anchor, catalogQuery)} getRowKey={r => r.id} pageSize={10}/> : catalog === "assignments" ? <ul className="space-y-2">{assignments.filter(id => `${id} ${topology.coworkers.find(c => c.agentId === id)?.label}`.toLowerCase().includes(catalogQuery.toLowerCase())).map(id => <li key={id}><p className="font-medium">{topology.coworkers.find(c => c.agentId === id)?.label ?? id}</p><div className="mt-2 flex flex-wrap gap-2">{rows.filter(r => (r.actorId ?? "unattributed") === id).map(r => <button key={r.id} className={ROUTING_ACTION_CLASS} onClick={() => { setCatalog(null); setSelectedId(r.id); }}>{r.task} · {r.modelId ?? t("unknown")}</button>)}{id !== "unattributed" && <Link className={ROUTING_ACTION_CLASS} href={`/platform/ai/agent/${encodeURIComponent(id)}`}>{t("assignmentSettings")}</Link>}</div></li>)}</ul> : <ul className="space-y-3">{providers.filter(p => (scope.provider === "all" || p.providerId === scope.provider) && `${p.label} ${p.providerId} ${data.models.filter(m => m.providerId === p.providerId).map(m => m.label + m.modelId).join(" ")}`.toLowerCase().includes(catalogQuery.toLowerCase())).map(p => <li key={p.providerId} className="rounded-lg border border-[var(--dpf-border)] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{p.label}</h3><Link className={ROUTING_ACTION_CLASS} href={routingHref(`/platform/ai/providers/${encodeURIComponent(p.providerId)}`, { ...scope, provider: p.providerId })}>{t("settingsOverrides")}</Link></div>{controlById.get(p.providerId)?.restrictions.map(r => <p key={r.key} className="mt-2 text-sm text-[var(--dpf-muted)]">{r.summary}{r.until && <> · <LocalTime value={r.until}/></>}</p>)}<p className="mt-2 text-sm text-[var(--dpf-muted)]">{controlById.get(p.providerId)?.eligibility.reason ?? t("eligibilityEvidenceUnavailable")}</p><details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t("exposedCount", { count: data.models.filter(m => m.providerId === p.providerId).length })}</summary><ul className="space-y-2">{data.models.filter(m => m.providerId === p.providerId).map(m => <li key={m.endpointId} className="break-words text-sm">{m.label} · {m.modelId} <StatusBadge label={m.status} intent="neutral"/></li>)}</ul></details></li>)}</ul>}
    </RoutingManagementOverlay>}
  </section>;
}
function FlowGroup({ label, count, onOpen, children }: {
    label: string;
    count: number;
    onOpen: () => void;
    children: React.ReactNode;
}) {
    const t = useT("routingManagement");
    return <div className="min-w-0 space-y-2"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{label}</h2><button className="min-h-11 text-xs text-[var(--dpf-accent)] underline" onClick={onOpen}>{t("allCount", { count })}</button></div>{children}</div>;
}
