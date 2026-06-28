import type {
  CoworkerCapabilityNeedReview,
  CoworkerCapabilityNeedReviewItem,
} from "@/lib/coworker-self-assessment/review-service";
import type {
  WorkPatternReadModel,
  WorkPatternSummary,
} from "@/lib/tak/work-pattern-read-model";
import { LocalTime } from "@/components/ui/LocalTime";
import { Chip, deepLink, EmptyState, Section } from "./panels";

export function NeedsAndPlaybooksPanel({
  needs,
  workPatterns,
}: {
  needs: CoworkerCapabilityNeedReview;
  workPatterns: WorkPatternReadModel;
}) {
  const visibleNeeds = needs.needs.slice(0, 5);
  return (
    <div>
      <Section
        title="Open needs"
        count={needs.summary.total}
        action={deepLink("/ops?origin=capability-need", "Review queue")}
      >
        {visibleNeeds.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {visibleNeeds.map((need) => (
              <NeedRow key={need.needId} need={need} />
            ))}
          </div>
        ) : (
          <EmptyState text="No open needs recorded for this coworker." />
        )}
      </Section>

      <Section title="Living Playbooks" count={workPatterns.summary.totalPatterns}>
        {workPatterns.patterns.length > 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Chip tone="accent">{workPatterns.summary.totalObservedRuns} observed runs</Chip>
              <Chip tone={workPatterns.summary.openNeedCount > 0 ? "warning" : "muted"}>
                {workPatterns.summary.openNeedCount} open needs
              </Chip>
              <Chip tone="muted">{workPatterns.summary.readyForReviewCount} review-ready</Chip>
              <Chip tone="muted">{workPatterns.summary.candidateOnlyCount} candidate-only</Chip>
            </div>
            {workPatterns.patterns.slice(0, 8).map((pattern) => (
              <PlaybookRow
                key={`${pattern.patternKey}:${pattern.routeContext ?? ""}:${pattern.riskClass ?? ""}`}
                pattern={pattern}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No Living Playbook candidates recorded for this coworker." />
        )}
      </Section>
    </div>
  );
}

function NeedRow({ need }: { need: CoworkerCapabilityNeedReviewItem }) {
  const severityTone =
    need.severity === "blocker" ? "error" : need.severity === "important" ? "warning" : "muted";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface)",
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 4 }}>
          <Chip tone={severityTone}>{need.kind}</Chip>
          <Chip tone="muted">{need.status}</Chip>
          {need.routeContext ? <Chip tone="accent">{need.routeContext}</Chip> : null}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", overflowWrap: "anywhere" }}>
          {need.need}
        </div>
        <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
          {need.blocks}
        </div>
      </div>
      <div style={{ display: "grid", gap: 4, justifyItems: "end", minWidth: 92 }}>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{need.createdAtLabel}</span>
        {need.linkedBacklogItemId ? <Chip tone="success">{need.linkedBacklogItemId}</Chip> : null}
      </div>
    </div>
  );
}

function PlaybookRow({ pattern }: { pattern: WorkPatternSummary }) {
  const statusTone =
    pattern.status === "active" ? "success" : pattern.status === "candidate" ? "warning" : "accent";
  const blockerLabel =
    pattern.readiness.blockers.length > 0
      ? pattern.readiness.blockers.slice(0, 2).join(", ")
      : "ready for review";
  return (
    <div
      style={{
        padding: "9px 10px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 5 }}>
            <Chip tone={statusTone}>{pattern.status}</Chip>
            <Chip tone="muted">{pattern.scope}</Chip>
            {pattern.routeContext ? <Chip tone="accent">{pattern.routeContext}</Chip> : null}
            {pattern.riskClass ? <Chip tone="warning">{pattern.riskClass}</Chip> : null}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", overflowWrap: "anywhere" }}>
            {pattern.candidate?.need ?? pattern.patternKey}
          </div>
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
            {pattern.candidate?.blocks ?? pattern.patternKey}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(58px, 1fr))",
            gap: 6,
            flex: "0 1 240px",
          }}
        >
          <PlaybookStat label="runs" value={String(pattern.observedRuns)} />
          <PlaybookStat label="done" value={String(pattern.completedRuns)} />
          <PlaybookStat label="failed" value={String(pattern.failedRuns)} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
        <Chip tone={pattern.openNeedCount > 0 ? "warning" : "muted"}>
          {pattern.openNeedCount} open needs
        </Chip>
        <Chip tone="muted">{pattern.evidenceRefs.length} evidence refs</Chip>
        <Chip tone={pattern.readiness.readyForReview ? "success" : "warning"}>{blockerLabel}</Chip>
        {pattern.latestObservedAt ? (
          <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: "auto" }}>
            latest <LocalTime value={pattern.latestObservedAt} mode="date" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PlaybookStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minHeight: 40,
        padding: "6px 8px",
        borderRadius: 5,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div style={{ fontSize: 9, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--dpf-text)", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
