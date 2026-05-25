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

import type { SizeAssessmentSnapshot } from "@/lib/explore/feature-build-types";

type Props = {
  assessment: SizeAssessmentSnapshot | null | undefined;
};

export function DecompositionGateBanner({ assessment }: Props) {
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

      <NextPhaseNotice />
    </div>
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
