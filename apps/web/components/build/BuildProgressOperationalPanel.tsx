"use client";

import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import { getTruthSourceAge } from "@/lib/build/progress-visibility-types";
import { BuildDispatchHistoryCard } from "./BuildDispatchHistoryCard";
import { BuildSandboxCard } from "./BuildSandboxCard";
import { BuildVerificationScopedCard } from "./BuildVerificationScopedCard";
import { TruthSourceBadge } from "./TruthSourceBadge";
import { StallEventHistoryStrip } from "./StallEventHistoryStrip";
import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import { formatDuration } from "@/lib/datetime";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { useT } from "@/lib/i18n/use-t";
import { useMessagesContext } from "@/lib/i18n/messages-context";
import { ProgressBar } from "@/components/ui/ProgressBar";

type Props = {
  projection: BuildProgressVisibility | null;
  /** When true, Dispatch attempts shows exit codes / tool detail (BI-F606D0E6). */
  engineerView?: boolean;
};

export function BuildProgressOperationalPanel({ projection, engineerView = false }: Props) {
  const t = useT("workrooms");
  const locale = useMessagesContext();
  const formatLocale = locale.formatLocale ?? locale.locale;
  if (!projection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--dpf-muted)]">
        Loading build progress...
      </div>
    );
  }

  const completed = projection.progress.primary.completed;
  const total = projection.progress.primary.total;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const primaryAge = getTruthSourceAge(projection.progress.primary.observedAt);
  const phaseOrder = ["ideate", "plan", "build", "review", "ship"] as const;
  const phaseRank = new Map<string,number>(phaseOrder.map((phase,index)=>[phase,index]));
  const phaseRows = [...projection.phaseRuns]
    .sort((a,b)=>(phaseRank.get(a.phase)??99)-(phaseRank.get(b.phase)??99))
    .map(r => ({
      phase:r.phase, active:!r.completedAt, total:false, durationMs:r.durationMs,
      input:r.inputTokens, output:r.outputTokens, calls:r.inferenceCount,
      estimate:r.costUsd !== null && r.costUsd.trim() !== "" && Number.isFinite(Number(r.costUsd)) ? Number(r.costUsd) : null,
    }));
  const totals = {
    input:phaseRows.reduce((sum,r)=>sum+r.input,0),
    output:phaseRows.reduce((sum,r)=>sum+r.output,0),
    calls:phaseRows.reduce((sum,r)=>sum+r.calls,0),
    cost:phaseRows.some(r=>r.estimate===null)?null:phaseRows.reduce((sum,r)=>sum+(r.estimate??0),0),
  };
  if (phaseRows.length > 1) {
    phaseRows.push({phase:"",active:false,total:true,durationMs:null,input:totals.input,output:totals.output,calls:totals.calls,estimate:totals.cost});
  }
  const phaseNames = Object.fromEntries(phaseOrder.map(key=>[key,t(`phaseCost.phases.${key}`)]));
  const phaseColumns: Column<typeof phaseRows[number]>[] = [
    {key:"phase",header:t("phaseCost.phase"),cell:r=><span>{r.total?t("phaseCost.total"):phaseNames[r.phase]??r.phase} {r.active?<StatusBadge label={t("phaseCost.active")} intent="neutral"/>:null}</span>,mobileFullWidth:true},
    {key:"duration",header:t("phaseCost.duration"),cell:r=>r.durationMs===null?t("outcomes.unavailable"):formatDuration(r.durationMs,{includeSeconds:true}),align:"right"},
    {key:"input",header:t("phaseCost.input"),cell:r=>formatMoney(r.input,null,formatLocale,{maximumFractionDigits:0}),align:"right"},
    {key:"output",header:t("phaseCost.output"),cell:r=>formatMoney(r.output,null,formatLocale,{maximumFractionDigits:0}),align:"right"},
    {key:"calls",header:t("phaseCost.calls"),cell:r=>formatMoney(r.calls,null,formatLocale,{maximumFractionDigits:0}),align:"right"},
    {key:"cost",header:t("phaseCost.estimate"),cell:r=>r.estimate===null?t("outcomes.unavailable"):formatMoney(r.estimate,"USD",formatLocale,{maximumFractionDigits:4}),align:"right"},
  ];

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">Task progress</p>
              <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
                {completed} / {total} tasks complete
              </h3>
            </div>
            <TruthSourceBadge
              source={projection.progress.primary.source}
              observedAt={projection.progress.primary.observedAt}
              ageLabel={primaryAge.label}
            />
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--dpf-text)]">DB taskResults progress</div>
              <div className="text-xs text-[var(--dpf-muted)]">{percent}%</div>
            </div>
            <ProgressBar
              className="mt-2"
              value={percent}
              size="sm"
              label="DB taskResults progress"
            />
          </div>

          {projection.progress.conflicts.length > 0 && (
            <div
              className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1"
              aria-label={`${projection.progress.conflicts.length} source-of-truth conflicts`}
            >
              {projection.progress.conflicts.map((conflict) => (
                <TruthSourceBadge
                  key={`${conflict.source}-${conflict.observedAt}`}
                  source={conflict.source}
                  observedAt={conflict.observedAt}
                  conflict
                />
              ))}
            </div>
          )}

          {projection.quietAgent.quiet && (
            <div className="mt-3 rounded border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
              Agent has been quiet for {projection.quietAgent.minutesQuiet}m
              <span className="text-[var(--dpf-muted)]"> - </span>
              <a
                className="font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
                href="#build-dispatch-history"
                onClick={() => {
                  // Layered enhancement: fire a custom event that the
                  // BuildDispatchHistoryCard listens for and uses to open
                  // the most-recent attempt's collapsed <details> + briefly
                  // highlight that row. The anchor scroll behavior is
                  // preserved — we DO NOT call preventDefault. See spec
                  // docs/superpowers/specs/2026-05-24-build-studio-quiet-agent-link-shows-last-action.md
                  // and BI-9A7DA4AC.
                  if (typeof document === "undefined") return;
                  document.dispatchEvent(new CustomEvent("dpf:open-last-dispatch-attempt"));
                }}
              >
                view last action
              </a>
            </div>
          )}
        </section>

        {projection.engineSelection && (
          <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3" aria-label="Build engine selection">
            <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">Execution engine</p>
            <p className="mt-1 text-sm text-[var(--dpf-text)]">{projection.engineSelection.summary}</p>
          </section>
        )}

        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Task list</h3>
          <div className="mt-2 space-y-1">
            {projection.tasks.tasks.length > 0 ? projection.tasks.tasks.map((task) => (
              <div key={`${task.taskIndex}-${task.title}`} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--dpf-text)]">{task.title}</span>
                  <span className="text-[var(--dpf-muted)]">{task.outcome}</span>
                </div>
                {task.summary && <div className="mt-1 truncate text-[var(--dpf-muted)]">{task.summary}</div>}
              </div>
            )) : (
              <p className="text-xs text-[var(--dpf-muted)]">No task rows recorded yet.</p>
            )}
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-3">
          {phaseRows.length > 0 ? <section className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1 p-4 space-y-3">
            <h3 className="text-base font-dpf-semibold text-dpf-text">{t("phaseCost.title")}</h3>
            <p className="text-sm text-dpf-muted">{t("phaseCost.summary",{tokens:formatMoney(totals.input+totals.output,null,formatLocale,{maximumFractionDigits:0}),calls:formatMoney(totals.calls,null,formatLocale,{maximumFractionDigits:0})})}</p>
            <DataTable ariaLabel={t("phaseCost.title")} responsive columns={phaseColumns} rows={phaseRows} getRowKey={r=>r.total?"summary:total":"phase:"+r.phase}/>
            <p className="text-sm text-dpf-muted">{t("phaseCost.note")}</p>
          </section> : null}
          <BuildSandboxCard sandbox={projection.sandbox} />
          <BuildDispatchHistoryCard attempts={projection.dispatchHistory} engineerView={engineerView} />
          <BuildVerificationScopedCard verification={projection.verification} />
        </div>

        {/* BI-4ab6be39 F3: stall history strip — only renders when this
            build has StallEvents. Silent on healthy builds. */}
        <StallEventHistoryStrip buildId={projection.buildId} />
      </div>
    </div>
  );
}
