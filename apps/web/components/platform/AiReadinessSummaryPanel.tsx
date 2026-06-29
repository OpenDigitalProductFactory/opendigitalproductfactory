import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";
import type {
  AiReadinessDomain,
  AiReadinessSummary,
  ReadinessState,
} from "@/lib/ai-readiness/readiness-summary";

const VERDICT: Record<
  AiReadinessSummary["state"],
  { label: string; tone: string; bg: string; icon: typeof CheckCircle2; intent: Intent }
> = {
  ready: {
    label: "Ready",
    tone: "var(--dpf-success)",
    bg: "var(--dpf-state-success)",
    icon: CheckCircle2,
    intent: "success",
  },
  attention: {
    label: "Needs attention",
    tone: "var(--dpf-warning)",
    bg: "var(--dpf-state-warning)",
    icon: AlertTriangle,
    intent: "warning",
  },
  blocked: {
    label: "Blocked",
    tone: "var(--dpf-error)",
    bg: "var(--dpf-state-error)",
    icon: ShieldAlert,
    intent: "danger",
  },
};

const DOMAIN_STATE: Record<
  ReadinessState,
  { label: string; tone: string; bg: string; icon: typeof CheckCircle2; intent: Intent }
> = {
  ready: {
    label: "Ready",
    tone: "var(--dpf-success)",
    bg: "var(--dpf-state-success)",
    icon: CheckCircle2,
    intent: "success",
  },
  attention: {
    label: "Attention",
    tone: "var(--dpf-warning)",
    bg: "var(--dpf-state-warning)",
    icon: AlertTriangle,
    intent: "warning",
  },
  blocked: {
    label: "Blocked",
    tone: "var(--dpf-error)",
    bg: "var(--dpf-state-error)",
    icon: ShieldAlert,
    intent: "danger",
  },
  diagnostic: {
    label: "Diagnostic",
    tone: "var(--dpf-info)",
    bg: "var(--dpf-state-info)",
    icon: CircleDashed,
    intent: "info",
  },
};

export function AiReadinessSummaryPanel({ summary }: { summary: AiReadinessSummary }) {
  const verdict = VERDICT[summary.state];
  const VerdictIcon = verdict.icon;
  return (
    <section className="space-y-4">
      <div
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        style={{ borderLeft: `4px solid ${verdict.tone}` }}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-label={`${verdict.label} status`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                style={{ color: verdict.tone, background: verdict.bg }}
              >
                <VerdictIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">
                  AI Readiness
                </p>
                <div className="mt-1">
                  <StatusBadge intent={verdict.intent} label={verdict.label} variant="soft" />
                </div>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-5 text-[var(--dpf-text)]">
              {summary.summary}
            </p>
          </div>
          <p className="shrink-0 text-xs text-[var(--dpf-muted)]">
            Updated <LocalTime value={summary.generatedAt} />
          </p>
        </div>
      </div>

      <div className="divide-y divide-[var(--dpf-border)] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        {summary.domains.map((domain) => (
          <ReadinessDomainRow key={domain.id} domain={domain} />
        ))}
      </div>
    </section>
  );
}

function ReadinessDomainRow({ domain }: { domain: AiReadinessDomain }) {
  const state = DOMAIN_STATE[domain.state];
  const Icon = state.icon;
  return (
    <div
      data-readiness-domain-row={domain.id}
      className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,0.9fr)_minmax(260px,1.5fr)_minmax(220px,1fr)_auto]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-label={`${state.label} status`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          style={{ color: state.tone, background: state.bg }}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{domain.label}</h2>
          <div className="mt-1">
            <StatusBadge intent={state.intent} label={state.label} variant="soft" />
          </div>
        </div>
      </div>

      <p className="min-w-0 text-sm leading-5 text-[var(--dpf-text)]">{domain.summary}</p>

      <div className="flex min-w-0 flex-wrap gap-2">
        {domain.evidence.slice(0, 3).map((entry) => (
          <span
            key={`${entry.label}-${entry.value}`}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)]"
          >
            <span className="font-medium text-[var(--dpf-text)]">{entry.label}:</span>
            <span className="truncate">{entry.value}</span>
          </span>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
        {domain.blocker?.href && (
          <Link
            data-readiness-primary-action={domain.id}
            href={domain.blocker.href}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            {domain.blocker.primaryActionLabel}
          </Link>
        )}
        <Link
          href={domain.diagnosticsHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          Diagnostics
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
