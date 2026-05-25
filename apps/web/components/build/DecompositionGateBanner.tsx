// apps/web/components/build/DecompositionGateBanner.tsx
//
// Phase 3 of the design-time decomposition rollout — informational banner
// surfaced after a passed design review when the deterministic sizeDesignDoc
// counter (Phase 2) decided the design is `decompose-recommended` or
// `decompose-required`.
//
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-
//   decomposition-design.md (§4.1 "Decomposition prompt at Ideate exit").
// BI: BI-2E6CC391.
//
// Phase 3 is informational only: the operator sees the size rationale, the
// trip evidence, and a notice that the decomposition assistant lands in the
// next phase. No "Propose splits" call-to-action (Phase 4), no override text
// field (Phase 4), no enforcement.
//
// Returns `null` for null assessments and for decision="ok" so the component
// can be unconditionally mounted inside `<DesignDocSection>` — it self-gates.
//
// All colours come from DPF theme tokens; no hardcoded hex.

"use client";

import { useState } from "react";

import type {
  DecompositionOverrideSnapshot,
  SizeAssessmentSnapshot,
} from "@/lib/explore/feature-build-types";

type Props = {
  assessment: SizeAssessmentSnapshot | null | undefined;
  /** Phase 4b — fires when the operator clicks "Propose splits". The parent
   *  page is expected to invoke propose_decomposition (if no candidates exist
   *  yet) and then open the DecompositionAssistantPanel. When omitted, the
   *  CTA is hidden — the banner stays informational (Phase 3 behaviour). */
  onProposeSplits?: () => void;
  /** Phase 4b — fires with the operator-typed rationale when they choose
   *  "Keep as one build (explain why)" on required tier. The parent calls
   *  record_decomposition_override. When omitted, the override path is
   *  hidden. Recommended-tier ignores this prop (override only meaningful
   *  at required-tier per spec §4.1). */
  onRecordOverride?: (rationale: string) => void;
  /** Disables both CTAs while in-flight work runs upstream. */
  actionsDisabled?: boolean;
  /** When non-null, the override has already been recorded — banner shows a
   *  small chip with the rationale instead of the override-entry form. */
  existingOverride?: DecompositionOverrideSnapshot | null;
};

export function DecompositionGateBanner({
  assessment,
  onProposeSplits,
  onRecordOverride,
  actionsDisabled,
  existingOverride,
}: Props) {
  if (!assessment) return null;
  if (assessment.decision === "ok") return null;

  const isRequired = assessment.decision === "decompose-required";
  const tone = isRequired ? "required" : "recommended";

  const headline = isRequired
    ? "Heads up — this design is bigger than fits in one build."
    : "Worth considering — this design is on the larger side.";

  const subhead = isRequired
    ? "Plan iteration on designs this size tends to oscillate without converging. Splitting into 2-4 smaller builds that ship one at a time will plan faster and be easier to verify."
    : "Plans this size can converge, but smaller is faster. Consider splitting into 2-3 builds.";

  const hasActions = onProposeSplits != null || (isRequired && onRecordOverride != null);

  return (
    <div
      data-testid="decomposition-gate-banner"
      data-tone={tone}
      className="mt-3 rounded-md border p-3 text-xs"
      style={{
        background: "var(--surface-elevated, var(--dpf-surface))",
        borderColor: isRequired
          ? "var(--border-warning-subtle, var(--dpf-warning))"
          : "var(--border-info-subtle, var(--dpf-muted))",
        color: "var(--dpf-text)",
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: isRequired ? "var(--dpf-warning)" : "var(--dpf-muted)" }}
      >
        {isRequired ? "Decomposition required" : "Decomposition recommended"}
      </div>

      <p className="mt-1 font-semibold leading-snug">{headline}</p>
      <p className="mt-1 leading-snug" style={{ color: "var(--dpf-text-secondary)" }}>
        {subhead}
      </p>

      <ObservedBreakdown assessment={assessment} />

      <TripList assessment={assessment} />

      <Rationale text={assessment.rationale} />

      {existingOverride ? (
        <OverrideRecordedChip override={existingOverride} />
      ) : hasActions ? (
        <ActionRow
          isRequired={isRequired}
          onProposeSplits={onProposeSplits}
          onRecordOverride={onRecordOverride}
          actionsDisabled={actionsDisabled ?? false}
        />
      ) : (
        <NextPhaseNotice />
      )}
    </div>
  );
}

function ActionRow({
  isRequired,
  onProposeSplits,
  onRecordOverride,
  actionsDisabled,
}: {
  isRequired: boolean;
  onProposeSplits: (() => void) | undefined;
  onRecordOverride: ((rationale: string) => void) | undefined;
  actionsDisabled: boolean;
}) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [rationale, setRationale] = useState("");

  const showOverride = isRequired && onRecordOverride != null;

  const submitOverride = () => {
    const trimmed = rationale.trim();
    if (trimmed.length === 0 || !onRecordOverride) return;
    onRecordOverride(trimmed);
    setRationale("");
    setOverrideOpen(false);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {overrideOpen ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Explain why a single build is the right call here…"
            aria-label="Override rationale"
            className="flex-1 rounded border px-2 py-1 text-[11px]"
            style={{
              borderColor: "var(--border-default, var(--dpf-muted))",
              background: "var(--surface-input, var(--dpf-surface))",
              color: "var(--dpf-text)",
            }}
          />
          <button
            type="button"
            onClick={submitOverride}
            disabled={actionsDisabled || rationale.trim().length === 0}
            className="rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
            style={{
              background: "var(--dpf-warning)",
              color: "var(--dpf-on-accent, white)",
            }}
          >
            Record override
          </button>
          <button
            type="button"
            onClick={() => {
              setOverrideOpen(false);
              setRationale("");
            }}
            className="text-[10px]"
            style={{ color: "var(--dpf-muted)" }}
          >
            cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {onProposeSplits && (
            <button
              type="button"
              onClick={onProposeSplits}
              disabled={actionsDisabled}
              className="rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
              style={{
                background: "var(--dpf-accent)",
                color: "var(--dpf-on-accent, white)",
              }}
            >
              Propose splits
            </button>
          )}
          {showOverride && (
            <button
              type="button"
              onClick={() => setOverrideOpen(true)}
              disabled={actionsDisabled}
              className="text-[11px] underline disabled:opacity-50"
              style={{ color: "var(--dpf-text-secondary)" }}
            >
              Keep as one build (explain why)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OverrideRecordedChip({ override }: { override: DecompositionOverrideSnapshot }) {
  return (
    <p
      className="mt-3 rounded border px-2 py-1 text-[11px] leading-snug"
      style={{
        borderColor: "var(--border-default, var(--dpf-muted))",
        background: "var(--surface-canvas, transparent)",
        color: "var(--dpf-text-secondary)",
      }}
    >
      <span
        className="mr-1 font-semibold"
        style={{ color: "var(--dpf-text)" }}
      >
        Override recorded:
      </span>
      {override.rationale}
    </p>
  );
}

function ObservedBreakdown({ assessment }: { assessment: SizeAssessmentSnapshot }) {
  const { breakdown } = assessment;
  const items: Array<{ label: string; value: number }> = [
    { label: "DB models", value: breakdown.models.count },
    { label: "API endpoints", value: breakdown.endpoints.count },
    { label: "acceptance criteria", value: breakdown.acs.count },
    { label: "ACs with complexity multipliers", value: breakdown.multipliers.count },
    { label: "UI routes", value: breakdown.routes.count },
  ];
  return (
    <ul
      className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5"
      style={{ color: "var(--dpf-text-secondary)" }}
    >
      {items.map((it) => (
        <li key={it.label} className="text-[11px]">
          <span className="font-mono">{it.value}</span> {it.label}
        </li>
      ))}
    </ul>
  );
}

function TripList({ assessment }: { assessment: SizeAssessmentSnapshot }) {
  if (assessment.trips.length === 0) return null;
  return (
    <div className="mt-2">
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--dpf-muted)" }}
      >
        Threshold trips
      </div>
      <ul className="mt-0.5 list-disc pl-4">
        {assessment.trips.map((trip) => (
          <li
            key={`${trip.dimension}-${trip.level}`}
            className="text-[11px] leading-snug"
            style={{ color: "var(--dpf-text-secondary)" }}
          >
            <span className="font-mono">{trip.dimension}</span> = {trip.observed}{" "}
            (≥ {trip.threshold} {trip.level})
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rationale({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p
      className="mt-2 text-[11px] italic leading-snug"
      style={{ color: "var(--dpf-text-secondary)" }}
    >
      {text}
    </p>
  );
}

function NextPhaseNotice() {
  return (
    <p
      className="mt-2 text-[10px] leading-snug"
      style={{ color: "var(--dpf-muted)" }}
    >
      The decomposition assistant (which proposes splits and creates child
      builds under one Epic) ships in the next phase. Until then this banner
      is informational — your build advances to Plan as today.
    </p>
  );
}
