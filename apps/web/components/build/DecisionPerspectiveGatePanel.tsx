"use client";

import { type FormEvent, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquarePlus,
  ShieldCheck,
} from "lucide-react";
import type { DecisionGateCaptureDraft } from "@/lib/decision-perspective/capture-types";
import type { DecisionInteractionGateView } from "@/lib/decision-perspective/types";
import { VoiceRationalePlayer } from "./VoiceRationalePlayer";

type Props = {
  interaction: (DecisionInteractionGateView & { profile?: { voiceEnabled?: boolean } | null }) | null | undefined;
  onCapture?: (capture: DecisionGateCaptureDraft) => Promise<void> | void;
  voiceOutput?: { audioStorageKey: string; durationMs: number } | null;
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
  if (outcomeType === "escalate") return "Capture owner direction";
  if (outcomeType === "defer") return "Capture missing evidence";
  return null;
}

function actionPrompt(interaction: DecisionInteractionGateView): string | null {
  if (interaction.outcomeType === "escalate") {
    return interaction.escalationCaptured
      ? "Owner direction has been captured for this gate."
      : "The accountable owner should resolve the ambiguity before this build advances.";
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

export function DecisionPerspectiveGatePanel({ interaction, onCapture, voiceOutput }: Props) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [rationale, setRationale] = useState("");
  const [objectionsResolvedText, setObjectionsResolvedText] = useState("");
  const [suggestedSourceTypesText, setSuggestedSourceTypesText] = useState("");
  const [candidateMaterial, setCandidateMaterial] = useState(false);
  // BI-6DCF772F: which scored option the human is picking. Defaults to the
  // kernel's recommendation when the gate scored options; "" when it did not.
  const [chosenOptionId, setChosenOptionId] = useState<string>(interaction?.recommendedOptionId ?? "");
  const [pendingCapture, setPendingCapture] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSaved, setCaptureSaved] = useState(false);

  if (!interaction) {
    return null;
  }

  const activeInteraction = interaction;
  const label = outcomeLabel(activeInteraction.outcomeType);
  const tier = confidenceTier(activeInteraction.confidenceScore);
  const prompt = actionPrompt(activeInteraction);
  const buttonLabel = captureLabel(activeInteraction.outcomeType);
  const captured =
    (activeInteraction.outcomeType === "escalate" && activeInteraction.escalationCaptured)
    || (activeInteraction.outcomeType === "defer" && activeInteraction.deferralCaptured)
    || captureSaved;
  const statusLabel =
    activeInteraction.outcomeType === "escalate"
      ? captured ? "Escalation captured" : "Escalation open"
      : activeInteraction.outcomeType === "defer"
        ? captured ? "Deferral captured" : "Deferral open"
        : null;
  const Icon = activeInteraction.outcomeType === "recommend" || activeInteraction.outcomeType === "arbitrate"
    ? CheckCircle2
    : AlertTriangle;
  const captureOutcomeType =
    activeInteraction.outcomeType === "escalate" || activeInteraction.outcomeType === "defer"
      ? activeInteraction.outcomeType
      : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captureOutcomeType) return;

    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      setCaptureError(
        captureOutcomeType === "escalate"
          ? "Owner direction is required."
          : "Missing evidence detail is required.",
      );
      return;
    }

    setPendingCapture(true);
    setCaptureError(null);
    try {
      await onCapture?.({
        interactionId: activeInteraction.interactionId,
        outcomeType: captureOutcomeType,
        answer: trimmedAnswer,
        criteriaText,
        rationale,
        objectionsResolvedText,
        suggestedSourceTypesText,
        candidateMaterial,
        chosenOptionId: chosenOptionId || undefined,
      });
      setCaptureSaved(true);
      setCaptureOpen(false);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "WWMD capture could not be saved.");
    } finally {
      setPendingCapture(false);
    }
  }

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
              {activeInteraction.principleConflict && (
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
            <div className="font-mono text-[var(--dpf-text)]">{activeInteraction.profileVersionId}</div>
            <div>{activeInteraction.domainClass}</div>
          </div>
        </div>

        {activeInteraction.rationale && (
          <p className="text-xs leading-relaxed text-[var(--dpf-muted)]">
            {activeInteraction.rationale}
          </p>
        )}

        {activeInteraction.profile?.voiceEnabled && (
          <VoiceRationalePlayer
            audioUrl={voiceOutput ? `/api/voice/audio/${voiceOutput.audioStorageKey}` : undefined}
            durationMs={voiceOutput?.durationMs}
          />
        )}

        <div className="grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <span className="font-semibold text-[var(--dpf-text)]">Sources: </span>
            <SourceList sources={activeInteraction.sources} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] uppercase sm:justify-end">
            <span className="whitespace-nowrap">
              Before {confidenceLabel(activeInteraction.confidenceBefore)}
            </span>
            <span className="whitespace-nowrap">
              After {confidenceLabel(activeInteraction.confidenceAfter)}
            </span>
            <span className="whitespace-nowrap">
              {activeInteraction.sources.length} source{activeInteraction.sources.length === 1 ? "" : "s"}
            </span>
            <span className="whitespace-nowrap">
              {activeInteraction.materialCount} material{activeInteraction.materialCount === 1 ? "" : "s"}
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
              onClick={() => {
                setCaptureError(null);
                setCaptureOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
              {buttonLabel}
            </button>
          </div>
        )}

        {captureOpen && captureOutcomeType && !captured && (
          <form
            onSubmit={handleSubmit}
            className="border-t border-[var(--dpf-border)] pt-3"
            data-testid="wwmd-gate-capture-form"
          >
            <div className="grid gap-3">
              {activeInteraction.scoredOptions && activeInteraction.scoredOptions.length > 0 && (
                <fieldset
                  className="grid gap-1.5 text-xs font-semibold text-[var(--dpf-text)]"
                  data-testid="wwmd-gate-option-pick"
                >
                  <legend className="mb-1">Which option did you choose?</legend>
                  {activeInteraction.scoredOptions.map((option) => (
                    <label key={option.id} className="flex items-center gap-2 font-normal text-[var(--dpf-text)]">
                      <input
                        type="radio"
                        name="wwmd-chosen-option"
                        value={option.id}
                        checked={chosenOptionId === option.id}
                        onChange={() => setChosenOptionId(option.id)}
                        className="accent-[var(--dpf-accent)]"
                      />
                      <span>{option.description}</span>
                      {activeInteraction.recommendedOptionId === option.id && (
                        <span className="text-[var(--dpf-muted)]">(recommended)</span>
                      )}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="grid gap-1 text-xs font-semibold text-[var(--dpf-text)]">
                {captureOutcomeType === "escalate" ? "Owner direction" : "Missing evidence"}
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={3}
                  required
                  className="min-h-20 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                />
              </label>

              {captureOutcomeType === "escalate" ? (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-[var(--dpf-text)]">
                    Decision criteria
                    <textarea
                      value={criteriaText}
                      onChange={(event) => setCriteriaText(event.target.value)}
                      rows={2}
                      className="min-h-16 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-[var(--dpf-text)]">
                    Rationale
                    <textarea
                      value={rationale}
                      onChange={(event) => setRationale(event.target.value)}
                      rows={2}
                      className="min-h-16 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-[var(--dpf-text)]">
                    Resolved objections
                    <textarea
                      value={objectionsResolvedText}
                      onChange={(event) => setObjectionsResolvedText(event.target.value)}
                      rows={2}
                      className="min-h-16 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                    />
                  </label>
                </>
              ) : (
                <label className="grid gap-1 text-xs font-semibold text-[var(--dpf-text)]">
                  Suggested source types
                  <textarea
                    value={suggestedSourceTypesText}
                    onChange={(event) => setSuggestedSourceTypesText(event.target.value)}
                    rows={2}
                    className="min-h-16 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  />
                </label>
              )}

              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--dpf-text)]">
                <input
                  type="checkbox"
                  checked={candidateMaterial}
                  onChange={(event) => setCandidateMaterial(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--dpf-border)] bg-[var(--dpf-bg)]"
                />
                Promote as candidate decision material
              </label>

              {captureError && (
                <p className="text-xs text-[var(--dpf-error)]" role="alert">
                  {captureError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={pendingCapture}
                  className="inline-flex items-center rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingCapture ? "Saving WWMD capture..." : "Save WWMD capture"}
                </button>
                <button
                  type="button"
                  disabled={pendingCapture}
                  onClick={() => setCaptureOpen(false)}
                  className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
