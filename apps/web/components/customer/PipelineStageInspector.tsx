import Link from "next/link";
import { AgentWorkLauncher } from "@/components/agent/AgentWorkLauncher";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import {
  PIPELINE_STAGE_UPDATE_OPTIONS,
  type PipelineInspectorView,
} from "@/lib/crm/pipeline-inspector";

type PipelineStageInspectorProps = {
  inspector: PipelineInspectorView;
  className?: string;
  showFullDetailLink?: boolean;
  stageFormAction?: (formData: FormData) => void | Promise<void>;
};

function InfoStat({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function StageUpdateForm({
  inspector,
  action,
}: {
  inspector: PipelineInspectorView;
  action?: PipelineStageInspectorProps["stageFormAction"];
}) {
  if (!action) return null;
  return (
    <form action={action} className="mt-3 flex gap-2">
      <input type="hidden" name="opportunityId" value={inspector.id} />
      <select
        name="stage"
        defaultValue={inspector.stage}
        className="min-w-0 flex-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs text-[var(--dpf-text)]"
      >
        {PIPELINE_STAGE_UPDATE_OPTIONS.map((stage) => (
          <option
            key={stage.value}
            value={stage.value}
            className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
          >
            {stage.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="shrink-0 rounded bg-[var(--dpf-accent)] px-3 py-2 text-xs font-medium text-white"
      >
        Update stage
      </button>
    </form>
  );
}

export function PipelineStageInspector({
  inspector,
  className = "",
  showFullDetailLink = true,
  stageFormAction,
}: PipelineStageInspectorProps) {
  return (
    <section
      className={[
        "rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Stage inspector
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
            {inspector.title}
          </h2>
          <p className="mt-1 truncate text-xs text-[var(--dpf-muted)]">
            {inspector.account.name}
            {inspector.contactLabel ? ` / ${inspector.contactLabel}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CustomerStatusBadge label={inspector.stageLabel} tone={inspector.stageTone} />
          {inspector.staleLabel ? (
            <CustomerStatusBadge label={inspector.staleLabel} tone="warning" />
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <InfoStat label="Stage age" value={inspector.stageAgeLabel} />
        <InfoStat label="Probability" value={inspector.probabilityLabel} />
        <InfoStat label="Expected value" value={inspector.expectedValueLabel} />
        <InfoStat label="Expected close" value={inspector.expectedCloseLabel} />
      </dl>

      <StageUpdateForm inspector={inspector} action={stageFormAction} />

      <div className="mt-4 border-t border-[var(--dpf-border)] pt-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Suggested next action
        </p>
        <p className="mt-1 text-sm text-[var(--dpf-text)]">{inspector.suggestedNextAction}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Source engagement
          </p>
          {inspector.sourceEngagement ? (
            <>
              <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">
                {inspector.sourceEngagement.label}
              </p>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                {inspector.sourceEngagement.detail}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              No source engagement is linked yet.
            </p>
          )}
        </div>

        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Linked quote
          </p>
          {inspector.latestQuote ? (
            <>
              <div className="mt-1 flex items-center justify-between gap-2">
                <Link
                  href={`/customer/quotes/${inspector.latestQuote.id}`}
                  className="text-sm font-mono text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]"
                >
                  {inspector.latestQuote.quoteNumber}
                </Link>
                <CustomerStatusBadge
                  label={inspector.latestQuote.statusLabel}
                  tone={inspector.latestQuote.statusTone}
                />
              </div>
              {inspector.latestQuote.totalLabel ? (
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {inspector.latestQuote.totalLabel}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              No quote is linked yet.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Stage exit criteria
        </p>
        <ul className="mt-2 space-y-1">
          {inspector.stageExitCriteria.map((criterion) => (
            <li key={criterion} className="text-xs text-[var(--dpf-text)]">
              {criterion}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Recent activity
        </p>
        {inspector.recentActivities.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">No activity recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {inspector.recentActivities.map((activity) => (
              <div key={activity.id} className="border-l border-[var(--dpf-border)] pl-3">
                <p className="text-xs font-medium text-[var(--dpf-text)]">{activity.label}</p>
                <p className="text-[10px] text-[var(--dpf-muted)]">{activity.detail}</p>
                {activity.body ? (
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--dpf-muted)]">
                    {activity.body}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {showFullDetailLink ? (
        <Link
          href={`/customer/opportunities/${inspector.id}`}
          className="mt-4 inline-flex rounded border border-[var(--dpf-border)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          Open full detail
        </Link>
      ) : null}

      <div className="mt-4">
        <AgentWorkLauncher
          agentName="Customer Advisor"
          primaryActionLabel="Ask Customer Advisor"
          topics={inspector.aiTopics}
        />
      </div>
    </section>
  );
}
