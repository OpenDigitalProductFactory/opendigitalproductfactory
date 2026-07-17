// apps/web/lib/build/build-actions-core.ts
//
// Pure (no prisma / auth / Next.js / Inngest) domain helpers extracted from
// lib/actions/build.ts (BI-OPT-FAT-ACTIONS, Build slice). These functions are
// side-effect-free — input validation-free shape/transform/mapping, derivation,
// and formatting — so the deterministic Build-action logic lives in the build
// domain layer and is unit-testable on its own. Behavior-preserving relocation
// — identical bodies, mirroring the EA slice (ea-core.ts) and CRM slice.
//
// Orchestration (auth() checks, prisma, $transaction, revalidatePath, Inngest
// sends, the "use server" wrappers) STAYS in lib/actions/build.ts and imports
// these helpers back.

import type { Prisma } from "@dpf/db";
import type { BuildPhase } from "@/lib/feature-build-types";
import type { ResumeImplementationMode } from "@/lib/build/progress-visibility-types";
import type { legacyFeatureBuildBriefToBusinessBuildBriefInput } from "@/lib/build/business-build-brief";

/**
 * Map the derived business-build-brief object into the JSON-column payload the
 * BusinessBuildBrief create/update writes expect. Pure cast/shape — the caller
 * owns the prisma write.
 */
export function businessBriefJsonPayload(
  businessBrief: ReturnType<typeof legacyFeatureBuildBriefToBusinessBuildBriefInput>,
) {
  return {
    affectedPeople: businessBrief.affectedPeople as unknown as Prisma.InputJsonValue,
    sourceEvidence: businessBrief.sourceEvidence as unknown as Prisma.InputJsonValue,
    technicalInterpretation: businessBrief.technicalInterpretation as unknown as Prisma.InputJsonValue,
    riskProfile: businessBrief.riskProfile as unknown as Prisma.InputJsonValue,
    hiveReadiness: businessBrief.hiveReadiness as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Extract a persisted `sourceCurrency` sub-object from an opaque
 * `buildExecState` value, returning null unless it is a plain object carrying a
 * plain-object `sourceCurrency`. Pure guard/projection over unknown JSON.
 */
export function readPersistedSourceCurrency(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sourceCurrency = (value as { sourceCurrency?: unknown }).sourceCurrency;
  if (!sourceCurrency || typeof sourceCurrency !== "object" || Array.isArray(sourceCurrency)) {
    return null;
  }
  return sourceCurrency;
}

/**
 * Derive the PhaseHandoff context — the from/to agent ids and the evidence
 * digest (one-line summary per populated build artifact field) — for a phase
 * transition. Pure derivation over the build's artifact fields; the caller owns
 * the prisma.phaseHandoff.create write and supplies the gateResult/summary.
 */
export function derivePhaseHandoffContext(input: {
  currentPhase: string;
  targetPhase: string;
  build: {
    designDoc: unknown;
    designReview: unknown;
    buildPlan: unknown;
    planReview: unknown;
    verificationOut: unknown;
    acceptanceMet: unknown;
  };
}): {
  fromAgent: string;
  toAgent: string;
  evidenceFields: string[];
  evidenceDigest: Record<string, string>;
} {
  const { currentPhase, targetPhase, build } = input;
  const PHASE_AGENT: Record<string, string> = {
    ideate: "build-specialist",
    plan: "ea-architect",
    build: "build-specialist",
    review: "ops-coordinator",
    ship: "platform-engineer",
  };
  const fromAgent = PHASE_AGENT[currentPhase] ?? "build-specialist";
  const toAgent = PHASE_AGENT[targetPhase] ?? "build-specialist";

  // Build evidence digest — one-line summary per populated field
  const evidenceFields: string[] = [];
  const evidenceDigest: Record<string, string> = {};
  if (build.designDoc) { evidenceFields.push("designDoc"); evidenceDigest.designDoc = "Design document saved"; }
  if (build.designReview) {
    evidenceFields.push("designReview");
    const review = build.designReview as Record<string, unknown>;
    evidenceDigest.designReview = `${review.decision ?? "reviewed"} — ${String(review.summary ?? "").slice(0, 100)}`;
  }
  if (build.buildPlan) { evidenceFields.push("buildPlan"); evidenceDigest.buildPlan = "Implementation plan saved"; }
  if (build.planReview) {
    evidenceFields.push("planReview");
    const review = build.planReview as Record<string, unknown>;
    evidenceDigest.planReview = `${review.decision ?? "reviewed"} — ${String(review.summary ?? "").slice(0, 100)}`;
  }
  if (build.verificationOut) {
    evidenceFields.push("verificationOut");
    const v = build.verificationOut as Record<string, unknown>;
    evidenceDigest.verificationOut = `typecheck: ${v.typecheckPassed ? "pass" : "fail"}`;
  }
  if (build.acceptanceMet) {
    evidenceFields.push("acceptanceMet");
    evidenceDigest.acceptanceMet = Array.isArray(build.acceptanceMet)
      ? `${(build.acceptanceMet as Array<{ met?: boolean }>).filter(c => c.met).length}/${(build.acceptanceMet as unknown[]).length} criteria met`
      : "Evaluated";
  }

  return { fromAgent, toAgent, evidenceFields, evidenceDigest };
}

/**
 * Classify the resume-implementation outcome mode from the recovery inputs.
 * Pure decision ladder — no DB, no side effects.
 */
export function deriveResumeImplementationMode(args: {
  phase: BuildPhase;
  taskCount: number;
  resetTasks: number;
  verificationFailed: boolean;
}): ResumeImplementationMode {
  if (args.resetTasks > 0) {
    return "reset-blocked";
  }
  if (args.taskCount === 0) {
    return "replan-and-dispatch";
  }
  if (args.phase === "review" && args.verificationFailed) {
    return "rerun-verification";
  }
  return "already-running";
}

/**
 * Format the operator-facing message for a resume-implementation outcome. Pure
 * string formatting over the derived mode.
 */
export function formatResumeImplementationOutcomeMessage(
  mode: ResumeImplementationMode,
  resetTasks: number,
): string {
  if (mode === "reset-blocked") {
    return `Reset ${resetTasks} task${resetTasks === 1 ? "" : "s"} to BLOCKED; queued implementation resume.`;
  }
  if (mode === "replan-and-dispatch") {
    return "No persisted task rows were reset; queued implementation dispatch from the current plan.";
  }
  if (mode === "rerun-verification") {
    return "Cleared verification output; queued verification recovery through the existing implementation resume path.";
  }
  return "Resume request recorded; implementation already has observable work in progress.";
}
