// BI-22601A38. Resolve the architect's advisory from what happened downstream.
//
// The architect (AGT-WS-EA) reviews a design or plan and recommends "aligned"
// or "revise-before-building". The advisory is advisory by contract, so it is
// routed to the profession corpus and never to a person. That is right:
// escalation is a property of the decision, not a way to collect trust samples
// (principles/escalation-is-a-gate-not-a-trust-tier). It meant no advisory was
// ever resolved, so the architect could never be measured.
//
// WWMD decision DI-ABF1EFCB4BC1 chose to resolve an advisory from the reviewed
// document's own record instead of asking a person:
//
//   re-reviewed-with-changed-document  the same build's same document was
//                                       reviewed again with different content,
//                                       so it was revised before building.
//   advanced-unchanged                 the build moved past the reviewed phase
//                                       with the document exactly as reviewed,
//                                       so it was built as reviewed ("aligned").
//
// Anything else resolves nothing: a build abandoned or failed, a document that
// changed without a re-review, a build still in the reviewed phase.
//
// This is an OUTCOME signal, not a person's choice. It is recorded with
// resolvedBy "outcome" and never pooled with human samples (BI-7D1E43DE). It is
// also concordance, not attribution: a design revised after the advisory may
// have been revised for the checklist reviewers' reasons, not the architect's.
//
// Pure: no IO.

import { createHash } from "node:crypto";

import { canonicalize } from "@/lib/decision/decision-chain";

import type { ArchitectureAdvisoryOption } from "./architecture-advisory-ledger";

export type ReviewedArtifactKind = "design" | "plan";

/** What an advisory records about the document it reviewed. */
export type ReviewedArtifact = { buildId: string; kind: ReviewedArtifactKind; digest: string };

/** The key in `outcomePayload` that carries the reviewed artifact. */
export const REVIEWED_ARTIFACT_PAYLOAD_KEY = "reviewedArtifact" as const;

/** The phase a document is reviewed in, and the phases that come after it. */
const REVIEWED_PHASE: Record<ReviewedArtifactKind, string> = { design: "ideate", plan: "plan" };
const PHASES_AFTER: Record<ReviewedArtifactKind, ReadonlySet<string>> = {
  design: new Set(["plan", "build", "review", "ship", "complete"]),
  plan: new Set(["build", "review", "ship", "complete"]),
};

/** The phase the build is in when this kind of document is reviewed. */
export function reviewedPhaseFor(kind: ReviewedArtifactKind): string {
  return REVIEWED_PHASE[kind];
}

/** sha256 of the document's canonical JSON, so key order is not a revision. */
export function reviewedArtifactDigest(document: unknown): string {
  return createHash("sha256").update(canonicalize(document ?? null)).digest("hex");
}

export function readReviewedArtifact(outcomePayload: unknown): ReviewedArtifact | null {
  if (!outcomePayload || typeof outcomePayload !== "object") return null;
  const value = (outcomePayload as Record<string, unknown>)[REVIEWED_ARTIFACT_PAYLOAD_KEY];
  if (!value || typeof value !== "object") return null;
  const { buildId, kind, digest } = value as Record<string, unknown>;
  if (typeof buildId !== "string" || !buildId) return null;
  if (kind !== "design" && kind !== "plan") return null;
  if (typeof digest !== "string" || !digest) return null;
  return { buildId, kind, digest };
}

export type AdvisoryForOutcome = ReviewedArtifact & {
  interactionId: string;
  proposedOptionId: string | null;
  createdAt: Date;
};

export type BuildForOutcome = {
  buildId: string;
  phase: string;
  designDoc: unknown;
  buildPlan: unknown;
};

export type AdvisoryOutcomeSignal = "re-reviewed-with-changed-document" | "advanced-unchanged";

export type AdvisoryOutcome = {
  chosenOptionId: ArchitectureAdvisoryOption;
  /** Whether what happened matches what the architect recommended. */
  agreement: boolean;
  signal: AdvisoryOutcomeSignal;
  resolvedAt: string;
  evidence: {
    buildId: string;
    kind: ReviewedArtifactKind;
    /** The later review that saw the revised document, when that is the signal. */
    laterInteractionId: string | null;
    buildPhase: string;
  };
};

function currentDocument(build: BuildForOutcome, kind: ReviewedArtifactKind): unknown {
  return kind === "design" ? build.designDoc : build.buildPlan;
}

/**
 * The outcome of each advisory the record can resolve, by interactionId. An
 * advisory missing from the map stays unresolved. `now` stamps an
 * advanced-unchanged resolution, which has no single event time of its own.
 */
export function deriveArchitectureAdvisoryOutcomes(
  advisories: readonly AdvisoryForOutcome[],
  builds: readonly BuildForOutcome[],
  now: Date = new Date(),
): Map<string, AdvisoryOutcome> {
  const buildById = new Map(builds.map((build) => [build.buildId, build]));
  const byDocument = new Map<string, AdvisoryForOutcome[]>();
  for (const advisory of advisories) {
    const key = `${advisory.buildId}\u0000${advisory.kind}`;
    const list = byDocument.get(key) ?? [];
    list.push(advisory);
    byDocument.set(key, list);
  }

  const outcomes = new Map<string, AdvisoryOutcome>();
  for (const list of byDocument.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    list.forEach((advisory, index) => {
      if (advisory.proposedOptionId !== "aligned" && advisory.proposedOptionId !== "revise-before-building") return;
      const build = buildById.get(advisory.buildId);
      if (!build) return;
      const proposed = advisory.proposedOptionId;
      const resolve = (
        chosenOptionId: ArchitectureAdvisoryOption,
        signal: AdvisoryOutcomeSignal,
        resolvedAt: Date,
        laterInteractionId: string | null,
      ) =>
        outcomes.set(advisory.interactionId, {
          chosenOptionId,
          agreement: chosenOptionId === proposed,
          signal,
          resolvedAt: resolvedAt.toISOString(),
          evidence: { buildId: build.buildId, kind: advisory.kind, laterInteractionId, buildPhase: build.phase },
        });

      const revisedBy = list.slice(index + 1).find((later) => later.digest !== advisory.digest);
      if (revisedBy) {
        resolve("revise-before-building", "re-reviewed-with-changed-document", revisedBy.createdAt, revisedBy.interactionId);
        return;
      }
      const advanced = PHASES_AFTER[advisory.kind].has(build.phase);
      const unchanged = reviewedArtifactDigest(currentDocument(build, advisory.kind)) === advisory.digest;
      if (advanced && unchanged) resolve("aligned", "advanced-unchanged", now, null);
    });
  }
  return outcomes;
}
