// apps/web/components/build/DecompositionCoordinator.tsx
//
// Phase 4c — the page-level coordinator that wires the gate banner + the
// assistant slide-over to the three server actions. Owns the in-flight
// state machine (idle → proposing → ready-to-pick → approving / overriding).
//
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// The DesignDocSection in ReviewPanel renders this instead of the bare
// banner. The coordinator self-gates: if there's no size assessment or the
// decision is "ok", it renders nothing (matches the banner's own self-gate).
// When the assessment is recommended/required, it renders the banner with
// CTAs wired, plus the assistant slide-over when the operator opens it.
//
// Action dispatch:
//   - "Propose splits" → proposeBuildDecompositionAction(buildId) → opens panel
//     with the returned candidates. If candidates were already on the build
//     (priorRounds path), the panel opens immediately without a propose call.
//   - Panel "Regenerate" → proposeBuildDecompositionAction(buildId, hint).
//   - Panel "Approve" → approveDecompositionAction(buildId, candidate).
//     On success the build is superseded; the parent page refreshes via
//     revalidatePath inside the action.
//   - Banner "Keep as one build" + rationale → recordDecompositionOverrideAction.
//
// Error handling: server-action failures surface in a small status line
// under the banner. The coordinator does not block the page on failure —
// the operator can retry by clicking the CTA again.

"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { DecompositionAssistantPanel } from "@/components/build/DecompositionAssistantPanel";
import { DecompositionGateBanner } from "@/components/build/DecompositionGateBanner";
import type { DecompositionCandidate } from "@/lib/build/decomposition-candidates";
import {
  approveDecompositionAction,
  proposeBuildDecompositionAction,
  recordDecompositionOverrideAction,
} from "@/lib/actions/decomposition-actions";
import type {
  DecompositionOverrideSnapshot,
  SizeAssessmentSnapshot,
} from "@/lib/explore/feature-build-types";

export type DecompositionCoordinatorProps = {
  buildId: string;
  buildTitle?: string;
  parentAcceptanceCriteria: string[];
  assessment: SizeAssessmentSnapshot | null | undefined;
  /** Most recently persisted set of candidates (from designReview.
   *  decompositionCandidates.latest), if any. */
  initialCandidates?: DecompositionCandidate[];
  /** Already-recorded override, if any. When non-null the banner shows the
   *  chip instead of the action row. */
  existingOverride?: DecompositionOverrideSnapshot | null;
  /** Phase 7: hidden entry point for D38 Plan-review oscillation. */
  planOscillationEntry?: boolean;
};

type FlightState =
  | { kind: "idle" }
  | { kind: "proposing" }
  | { kind: "approving" }
  | { kind: "overriding" };

export function DecompositionCoordinator(props: DecompositionCoordinatorProps) {
  const {
    buildId,
    buildTitle,
    parentAcceptanceCriteria,
    assessment,
    initialCandidates,
    existingOverride,
    planOscillationEntry,
  } = props;

  const [_isPending, startTransition] = useTransition();
  const [flight, setFlight] = useState<FlightState>({ kind: "idle" });
  const [panelOpen, setPanelOpen] = useState(false);
  const [candidates, setCandidates] = useState<DecompositionCandidate[]>(
    initialCandidates ?? [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const shouldRenderBanner = assessment != null && assessment.decision !== "ok";
  const shouldHandlePlanOscillation = planOscillationEntry === true;

  const decisionLabel: "decompose-required" | "decompose-recommended" =
    assessment?.decision === "decompose-required" ? "decompose-required" : "decompose-recommended";

  const proposeAndOpen = useCallback((operatorHint?: string) => {
    setErrorMessage(null);
    setFlight({ kind: "proposing" });
    startTransition(async () => {
      try {
        const result = await proposeBuildDecompositionAction({
          buildId,
          ...(operatorHint ? { operatorHint } : {}),
        });
        if (!result.ok) {
          setErrorMessage(`Couldn't propose splits: ${result.error}`);
          setFlight({ kind: "idle" });
          return;
        }
        setCandidates(result.candidates);
        setPanelOpen(true);
        setFlight({ kind: "idle" });
      } catch (err) {
        setErrorMessage(
          `Propose splits failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        setFlight({ kind: "idle" });
      }
    });
  }, [buildId, startTransition]);

  const handleProposeSplits = useCallback(() => {
    // If we already have a persisted candidate set, open the panel directly
    // without a fresh LLM call. Otherwise, propose first.
    if (candidates.length > 0) {
      setErrorMessage(null);
      setPanelOpen(true);
      return;
    }
    proposeAndOpen();
  }, [candidates.length, proposeAndOpen]);

  useEffect(() => {
    if (!shouldHandlePlanOscillation) return;

    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ buildId?: unknown }>).detail;
      if (detail?.buildId !== buildId) return;
      handleProposeSplits();
    };

    document.addEventListener("open-build-decomposition", handleOpen);
    return () => document.removeEventListener("open-build-decomposition", handleOpen);
  }, [buildId, handleProposeSplits, shouldHandlePlanOscillation]);

  const handleApprove = (candidate: DecompositionCandidate) => {
    setErrorMessage(null);
    setFlight({ kind: "approving" });
    startTransition(async () => {
      try {
        const result = await approveDecompositionAction({
          buildId,
          candidate,
        });
        if (!result.ok) {
          setErrorMessage(`Couldn't approve decomposition: ${result.error}`);
          setFlight({ kind: "idle" });
          return;
        }
        // On success the originating build is superseded; revalidatePath in
        // the server action refreshes the page surface. Close the panel and
        // clear local state — the next render will likely unmount us anyway
        // because the build no longer matches the gate condition.
        setPanelOpen(false);
        setCandidates([]);
        setFlight({ kind: "idle" });
      } catch (err) {
        setErrorMessage(
          `Approve decomposition failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        setFlight({ kind: "idle" });
      }
    });
  };

  const handleRecordOverride = (rationale: string) => {
    setErrorMessage(null);
    setFlight({ kind: "overriding" });
    startTransition(async () => {
      try {
        const result = await recordDecompositionOverrideAction({
          buildId,
          rationale,
        });
        if (!result.ok) {
          setErrorMessage(`Couldn't record override: ${result.error}`);
          setFlight({ kind: "idle" });
          return;
        }
        setFlight({ kind: "idle" });
        // revalidatePath in the action will refresh the server-rendered
        // banner to show the existing-override chip.
      } catch (err) {
        setErrorMessage(
          `Record override failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        setFlight({ kind: "idle" });
      }
    });
  };

  if (!shouldRenderBanner && !shouldHandlePlanOscillation && !panelOpen) {
    return null;
  }

  return (
    <>
      {shouldRenderBanner && assessment && (
        <DecompositionGateBanner
          assessment={assessment}
          onProposeSplits={handleProposeSplits}
          onRecordOverride={handleRecordOverride}
          actionsDisabled={flight.kind !== "idle"}
          existingOverride={existingOverride ?? null}
        />
      )}
      {errorMessage && (
        <p
          data-testid="decomposition-coordinator-error"
          className="mt-1 text-[11px]"
          style={{ color: "var(--dpf-error, var(--dpf-warning))" }}
        >
          {errorMessage}
        </p>
      )}
      <DecompositionAssistantPanel
        open={panelOpen}
        parentAcceptanceCriteria={parentAcceptanceCriteria}
        candidates={candidates}
        approving={flight.kind === "approving"}
        regenerating={flight.kind === "proposing"}
        {...(buildTitle ? { parentBuildTitle: buildTitle } : {})}
        decisionLabel={decisionLabel}
        onApprove={handleApprove}
        onRegenerate={(hint) => {
          // Reuse the propose action with the operator hint.
          if (hint && hint.length > 0) proposeAndOpen(hint);
          else proposeAndOpen();
        }}
        onClose={() => setPanelOpen(false)}
      />
    </>
  );
}
