"use client";
import { useT } from "@/lib/i18n/use-t";
import { useMessagesContext } from "@/lib/i18n/messages-context";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Surface } from "@/components/ui/Surface";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge, EmptyState } from "@/components/ui/report-kit";
import { routingHref, type RoutingScope } from "@/lib/ai-operations-map/routing-management-scope";
import { type RoutingReceipt } from "@/lib/ai-operations-map/routing-management-types";
export const ROUTING_ACTION_CLASS = "inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--dpf-border)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";
export const formatRoutingCost = (value: number | null, locale: string, unavailable: string) => value === null ? unavailable : formatMoney(value, "USD", locale, { maximumFractionDigits: 4 });
/** Native in-DOM modal owns inertness, keyboard focus containment and Escape; theme is DPF tokens. */
export function RoutingManagementOverlay({ title, children, onClose }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
}) {
    const t = useT("routingManagement");
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog?.showModal();
        return () => { dialog?.close(); if (returnFocus?.isConnected)
            returnFocus.focus(); };
    }, []);
    return <dialog ref={ref} aria-label={title} onCancel={onClose} className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-4xl overflow-hidden border-0 bg-transparent p-0 text-[var(--dpf-text)] shadow-xl backdrop:bg-[color-mix(in_srgb,var(--dpf-text)_40%,transparent)]">
    <Surface padding="none" rounded="xl"><header className="flex items-center justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <button type="button" autoFocus className={ROUTING_ACTION_CLASS} onClick={onClose} aria-label={t("closeRoutingInspector")}>{t("close")}</button>
    </header>
    <div className="max-h-[calc(85dvh-5rem)] space-y-5 overflow-y-auto p-4">{children}</div></Surface>
  </dialog>;
}
export function RoutingManagementInspector({ receipt: r, scope, onClose }: {
    receipt: RoutingReceipt;
    scope: RoutingScope;
    onClose: () => void;
}) {
    const t = useT("routingManagement");
    const { locale } = useMessagesContext();
    const money = (value: number | null) => formatRoutingCost(value, locale, t("notRecorded"));
    return <RoutingManagementOverlay title={t("routingDecision")} onClose={onClose}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-lg font-semibold break-words">{r.task} → {r.providerId ?? t("unresolvedProvider")}</p><p className="text-sm text-[var(--dpf-muted)]">{r.modelId ?? t("modelNotRecorded")} · <LocalTime value={r.occurredAt}/></p></div>
      <StatusBadge intent={r.execution === "success" ? "success" : r.execution === "error" ? "danger" : r.execution === "blocked" ? "warning" : "neutral"} label={r.execution}/>
    </div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <Fact label={t("requestExecution")} value={r.execution}/>
      <Fact label={t("selectedModelExecution")} value={r.selectedExecution}/>
      <Fact label={t("assignment")} value={r.actorId ?? t("attributionNotRecorded")}/>
      <Fact label={t("dataSensitivity")} value={r.sensitivity}/>
      <Fact label={t("screening")} value={r.screen ? `${r.screen.routeEffect} · ${r.screen.transformation}` : t("screeningReceiptUnavailable")}/>
      <Fact label={t("account")} value={t("notRecordedInThisSafeReceipt")}/>
      <Fact label={t("recordedCost")} value={`${money(r.costUsd)}${r.costSource ? ` · ${r.costSource}` : ""}`}/>
      <Fact label={t("recordedTokens")} value={r.tokens?.toLocaleString() ?? t("notRecorded")}/>
    </dl>
    {r.shadowMode && <StatusBadge intent="neutral" label={t("shadowDecision")}/>}
    {r.execution === "success" && r.selectedExecution === "error" && <StatusBadge intent="warning" label={t("recovered")}/>}
    <section><h3 className="mb-2 font-semibold">{t("whyThisPath")}</h3><p className="text-sm text-[var(--dpf-muted)]">{t("selectedEndpoint")}<span className="break-all font-mono">{r.endpointId}</span>. {r.correlation === "exact" ? t("attemptsAreJoinedByAnExactRequestTrace") : r.correlation === "ambiguous" ? t("thisTraceBelongsToMultipleDecisionsAttemptsAnd") : t("noRequestTraceWasRecordedAttemptAndCost")}</p></section>
    <section><h3 className="mb-2 font-semibold">{t("excludedCandidates")}{r.exclusions.length}</h3>
      {r.exclusions.length ? <ul className="space-y-2">{r.exclusions.map((e, i) => <li key={i} className="flex flex-wrap justify-between gap-2 rounded-md bg-[var(--dpf-surface-2)] p-3 text-sm"><span>{e.providerId ?? t("providerNotRecorded")} · {e.modelId ?? t("modelNotRecorded")}</span><StatusBadge intent="warning" label={t(`holds.${e.hold}`)}/></li>)}</ul> : <p className="text-sm text-[var(--dpf-muted)]">{t("noExclusionReceiptRecorded")}</p>}
    </section>
    <section><h3 className="mb-2 font-semibold">{t("attemptsInRecordedOrder")}</h3>
      {r.attempts.length ? <ol className="space-y-2">{r.attempts.map((a, i) => <li key={a.id} className="rounded-lg border border-[var(--dpf-border)] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{i + 1}. {a.providerId} · {a.modelId}</p><StatusBadge intent={a.status === "success" ? "success" : "warning"} label={a.status}/></div>
        <p className="mt-1 text-[var(--dpf-muted)]">{t("channel")}{a.channel} · <LocalTime value={a.startedAt}/> · {a.durationMs === null ? t("durationUnknown") : t("ms", { p0: a.durationMs })}</p>
        <p className="mt-1 text-[var(--dpf-muted)]">{t("attemptEstimate")}{money(a.estimatedCostUsd)}{t("input")}{a.inputTokens ?? "unknown"}{t("output")}{a.outputTokens ?? "unknown"}{t("tokens")}</p>
        {a.hold && <p className="mt-1 text-sm">{t(`holds.${a.hold}`)}</p>}
        <p className="mt-1">{t("operatorFeedback")}{a.feedback === null ? t("notRecorded") : a.feedback ? t("accepted") : t("retriedDiscarded")}</p>
      </li>)}</ol> : <EmptyState size="sm" title={t("noCorrelatedAttemptEvidence")}/>}
    </section>
    <section><h3 className="mb-2 font-semibold">{t("taskQuality")}</h3><p className="text-sm text-[var(--dpf-muted)]">{r.quality === null ? t("noDecisionLinkedEvaluatorScoreExecutionSuccessAnd") : t("evaluatorScore", { p0: r.quality })}</p><p className="mt-1 break-words text-sm">{t("recipe")}{r.recipeKey ?? t("notRecorded")}{t("evaluator")}{r.evaluator ?? t("notRecorded")}</p></section>
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">{t("sourceEvidenceIdentifiers")}</summary><p className="break-all font-mono">{t("routedecisionlog")}{r.id}</p><ul className="mt-2 space-y-1 break-all font-mono">{r.sourceIds.map(id => <li key={id}>{id}</li>)}</ul></details>
    <footer className="flex flex-wrap gap-2">
      {r.providerId && <Link className={ROUTING_ACTION_CLASS} href={routingHref(`/platform/ai/providers/${encodeURIComponent(r.providerId)}`, { ...scope, provider: r.providerId })}>{t("providerSettingsOverrides")}</Link>}
      {r.actorId && <Link className={ROUTING_ACTION_CLASS} href={`/platform/ai/agent/${encodeURIComponent(r.actorId)}`}>{t("assignmentSettings")}</Link>}
    </footer>
  </RoutingManagementOverlay>;
}
function Fact({ label, value }: {
    label: string;
    value: string;
}) {
    return <div className="min-w-0 rounded-md bg-[var(--dpf-surface-2)] p-3"><dt className="text-xs text-[var(--dpf-muted)]">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}
