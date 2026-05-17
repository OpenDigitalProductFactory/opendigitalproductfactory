"use client";

import {
  AlertTriangle,
  CheckCircle2,
  MessageSquarePlus,
  ShieldCheck,
} from "lucide-react";
import type { DecisionInteractionGateView } from "@/lib/decision-perspective/types";

type Props = {
  interaction: DecisionInteractionGateView | null | undefined;
  onCapture?: (interaction: DecisionInteractionGateView) => void;
};

type ConfidenceTier = "High" | "Medium" | "Low";

function outcomeLabel(outcomeType: DecisionInteractionGateView["outcomeType"]): string {
  switch (outcomeType) {
    case "recommend":
      return "Recommended";
    case "arbitrate":
      return "Arbitrated";
    case "escalate":
      return "Escalation required";
    case "defer":
      return "Coverage gap - deferred";
  }
}

function confidenceTier(score: number): ConfidenceTier {
  if (score >= 0.85) return "High";
  if (score >= 0.55) return "Medium";
  return "Low";
}

function confidenceLabel(score: number | null): string {
  return score == null ? "Unknown" : confidenceTier(score);
}

function captureLabel(outcomeType: DecisionInteractionGateView["outcomeType"]): string | null {
  if (outcomeType === "escalate") return "Capture human direction";
  if (outcomeType === "defer") return "Capture missing evidence";
  return null;
}

function actionPrompt(interaction: DecisionInteractionGateView): string | null {
  if (interaction.outcomeType === "escalate") {
    return interaction.escalationCaptured
      ? "Human direction has been captured for this gate."
      : "A responsible human should resolve the ambiguity before this build advances.";
  }
  if (interaction.outcomeType === "defer") {
    return interaction.deferralCaptured
      ? "The coverage gap has been captured for future material improvement."
      : "Capture the missing evidence so this decision class can earn autonomy later.";
  }
  return null;
}

function SourceList({ sources }: { sources: DecisionInteractionGateView["sources"] }) {
  if (sources.length === 0) {
    return <span className="text-[var(--dpf-muted)]">No sources</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {sources.slice(0, 3).map((source) => (
        <span
          key={`${source.materialId}-${source.sourceType}`}
          className="inline-flex max-w-full items-center rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--dpf-text)]"
          title={source.summary}
        >
          <span className="truncate">{source.sourceType}</span>
        </span>
      ))}
    </div>
  );
}

export function DecisionPerspectiveGatePanel({ interaction, onCapture }: Props) {
  if (!interaction) {
    return null;
  }

  const label = outcomeLabel(interaction.outcomeType);
  const tier = confidenceTier(interaction.confidenceScore);
  const prompt = actionPrompt(interaction);
  const buttonLabel = captureLabel(interaction.outcomeType);
  const captured =
    (interaction.outcomeType === "escalate" && interaction.escalationCaptured)
    || (interaction.outcomeType === "defer" && interaction.deferralCaptured);
  const statusLabel =
    interaction.outcomeType === "escalate"
      ? captured ? "Escalation captured" : "Escalation open"
      : interaction.outcomeType === "defer"
        ? captured ? "Deferral captured" : "Deferral open"
        : null;
  const Icon = interaction.outcomeType === "recommend" || interaction.outcomeType === "arbitrate"
    ? CheckCircle2
    : AlertTriangle;

  return (
    <section
      className="border-t border-[var(--dpf-border)] pt-3"
      data-testid="wwmd-gate-panel"
      aria-label="WWMD gate decision"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              WWMD gate
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--dpf-text)]">
                <Icon className="h-3 w-3" aria-hidden="true" />
                {label}
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--dpf-text)]">
                {tier} confidence
              </span>
              {interaction.principleConflict && (
                <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--dpf-text)]">
                  Principle conflict
                </span>
              )}
              {statusLabel && (
                <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--dpf-text)]">
                  {statusLabel}
                </span>
              )}
            </div>
          </div>
          <div className="max-w-full text-right text-[10px] text-[var(--dpf-muted)]">
            <div className="font-mono text-[var(--dpf-text)]">{interaction.profileVersionId}</div>
            <div>{interaction.domainClass}</div>
          </div>
        </div>

        {interaction.rationale && (
          <p className="text-xs leading-relaxed text-[var(--dpf-muted)]">
            {interaction.rationale}
          </p>
        )}

        <div className="grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <span className="font-semibold text-[var(--dpf-text)]">Sources: </span>
            <SourceList sources={interaction.sources} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] uppercase sm:justify-end">
            <span className="whitespace-nowrap">
              Before {confidenceLabel(interaction.confidenceBefore)}
            </span>
            <span className="whitespace-nowrap">
              After {confidenceLabel(interaction.confidenceAfter)}
            </span>
            <span className="whitespace-nowrap">
              {interaction.sources.length} source{interaction.sources.length === 1 ? "" : "s"}
            </span>
            <span className="whitespace-nowrap">
              {interaction.materialCount} material{interaction.materialCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {prompt && buttonLabel && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--dpf-border)] pt-3">
            <p className="max-w-[34rem] text-xs leading-relaxed text-[var(--dpf-muted)]">
              {prompt}
            </p>
            <button
              type="button"
              data-testid="wwmd-gate-capture"
              disabled={captured}
              onClick={() => onCapture?.(interaction)}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
              {buttonLabel}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
