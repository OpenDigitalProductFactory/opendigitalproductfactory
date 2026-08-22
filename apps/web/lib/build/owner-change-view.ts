import type { BuildStudioCustomerStatus } from "./customer-status-projection";
import { normalizeVerificationOutput } from "./verification-output";
import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import type { BusinessBuildBrief } from "./business-build-brief";
import type { BuildStudioOwnerState } from "./owner-status-reconciliation";

export const OWNER_PROOF_STATES = [
  "passed",
  "failed",
  "not-applicable",
  "not-recorded",
  "stale",
] as const;

export type OwnerProofState = typeof OWNER_PROOF_STATES[number];

export type OwnerProofCheck = {
  key: "acceptance" | "automated" | "ux";
  label: string;
  state: OwnerProofState;
  summary: string;
  observedAt: string | null;
};

export type OwnerProofPacket = {
  requestedOutcome: string;
  whatChanged: string | null;
  checks: OwnerProofCheck[];
  openRisks: string[];
};

export type OwnerChangeView = {
  changeId: string;
  title: string;
  outcome: string;
  now: string;
  next: string;
  ownerState: BuildStudioOwnerState;
  brief: BusinessBuildBrief | null;
  proof: OwnerProofPacket;
  pendingDecisionId: string | null;
  preview: { available: boolean; drivingThisChange: boolean };
  technicalDetailsAvailable: boolean;
};

const EVIDENCE_WRITE_GRACE_MS = 5 * 60 * 1000;

type OwnerStatus = Pick<BuildStudioCustomerStatus, "lifecyclePosition" | "nextAction" | "ownerState">;

export function projectOwnerChangeView(input: {
  build: FeatureBuildRow;
  status?: OwnerStatus | null;
  previewDrivingBuildId?: string | null;
}): OwnerChangeView {
  const { build, status } = input;
  const outcome = toOutcomeStatement(firstText(
    build.businessBuildBrief?.businessOutcome,
    build.designDoc?.problemStatement,
    build.description,
    build.originator?.resolution,
    build.title,
  ));
  const previewAvailable =
    build.sandboxPort !== null && ["build", "review", "ship"].includes(build.phase);
  const pendingDecision = build.decisionInteraction;

  return {
    changeId: build.buildId,
    title: build.title,
    outcome,
    now: status?.lifecyclePosition ?? fallbackNow(build.phase),
    next: status?.nextAction ?? fallbackNext(build.phase),
    ownerState: status?.ownerState ?? fallbackOwnerState(build.phase),
    brief: build.businessBuildBrief ?? null,
    proof: {
      requestedOutcome: outcome,
      whatChanged: firstTextOrNull(build.diffSummary),
      checks: [
        acceptanceCheck(build),
        automatedCheck(build),
        uxCheck(build),
      ],
      openRisks: build.businessBuildBrief?.openQuestions ?? [],
    },
    pendingDecisionId:
      pendingDecision && !pendingDecision.chosenOptionId
        ? pendingDecision.interactionId
        : null,
    preview: {
      available: previewAvailable,
      drivingThisChange:
        previewAvailable && input.previewDrivingBuildId === build.buildId,
    },
    technicalDetailsAvailable: true,
  };
}

function acceptanceCheck(build: FeatureBuildRow): OwnerProofCheck {
  if (build.phase === "ideate" || build.phase === "plan" || build.phase === "build") {
    return proof("acceptance", "Outcome checks", "not-applicable", "Checked during review.");
  }
  const criteria = build.acceptanceMet;
  if (!criteria?.length) {
    return proof("acceptance", "Outcome checks", "not-recorded", "No outcome-check result is recorded.");
  }
  const failed = criteria.filter((criterion) => !criterion.met).length;
  const observedAt = build.evidenceObservedAt?.acceptance ?? null;
  if (failed > 0) {
    return proof("acceptance", "Outcome checks", "failed", `${failed} outcome check${failed === 1 ? "" : "s"} did not pass.`, observedAt);
  }
  if (!observedAt) {
    return proof("acceptance", "Outcome checks", "not-recorded", "The outcome-check result has no accepted evidence receipt.");
  }
  if (isOlderThanBuild(observedAt, build.updatedAt)) {
    return proof("acceptance", "Outcome checks", "stale", "The Change was updated after these outcome checks ran.", observedAt);
  }
  return proof("acceptance", "Outcome checks", "passed", `${criteria.length} outcome check${criteria.length === 1 ? "" : "s"} passed.`, observedAt);
}

function automatedCheck(build: FeatureBuildRow): OwnerProofCheck {
  if (build.phase === "ideate" || build.phase === "plan") {
    return proof("automated", "Automated checks", "not-applicable", "Checks start after the plan is approved.");
  }
  const verification = normalizeVerificationOutput(build.verificationOut);
  if (
    verification.typecheckPassed === null
    || verification.testsPassed === null
    || verification.testsFailed === null
  ) {
    return proof("automated", "Automated checks", "not-recorded", "No complete automated-check result is recorded.");
  }
  if (!verification.typecheckPassed || verification.testsFailed > 0) {
    return proof(
      "automated",
      "Automated checks",
      "failed",
      !verification.typecheckPassed
        ? "The production type check failed."
        : `${verification.testsFailed} automated test${verification.testsFailed === 1 ? "" : "s"} failed.`,
      verification.observedAt,
    );
  }
  if (!verification.observedAt) {
    return proof("automated", "Automated checks", "not-recorded", "The automated result has no observation time.");
  }
  if (isOlderThanBuild(verification.observedAt, build.updatedAt)) {
    return proof("automated", "Automated checks", "stale", "The Change was updated after these checks ran.", verification.observedAt);
  }
  return proof(
    "automated",
    "Automated checks",
    "passed",
    `${verification.testsPassed ?? 0} automated test${verification.testsPassed === 1 ? "" : "s"} passed and the production type check passed.`,
    verification.observedAt,
  );
}

function uxCheck(build: FeatureBuildRow): OwnerProofCheck {
  if (build.uxVerificationStatus === "skipped") {
    return proof("ux", "Experience review", "not-applicable", "Experience review was explicitly marked not applicable.");
  }
  if (build.phase === "ideate" || build.phase === "plan" || build.phase === "build") {
    return proof("ux", "Experience review", "not-applicable", "Experience review happens after implementation.");
  }
  if (!build.uxVerificationStatus || build.uxVerificationStatus === "running") {
    return proof("ux", "Experience review", "not-recorded", "No completed experience-review result is recorded.");
  }
  const failed = build.uxTestResults?.filter((result) => !result.passed).length ?? 0;
  const observedAt = build.evidenceObservedAt?.ux ?? null;
  if (build.uxVerificationStatus === "failed" || failed > 0) {
    return proof("ux", "Experience review", "failed", failed > 0 ? `${failed} experience check${failed === 1 ? "" : "s"} failed.` : "Experience review failed.", observedAt);
  }
  if (!observedAt) {
    return proof("ux", "Experience review", "not-recorded", "The experience-review result has no accepted evidence receipt.");
  }
  if (isOlderThanBuild(observedAt, build.updatedAt)) {
    return proof("ux", "Experience review", "stale", "The Change was updated after the experience review ran.", observedAt);
  }
  return proof("ux", "Experience review", "passed", "The recorded experience review passed.", observedAt);
}

function proof(
  key: OwnerProofCheck["key"],
  label: string,
  state: OwnerProofState,
  summary: string,
  observedAt: string | null = null,
): OwnerProofCheck {
  return { key, label, state, summary, observedAt };
}

function isOlderThanBuild(observedAt: string | null, updatedAt: Date): boolean {
  if (!observedAt) return false;
  const observedTime = Date.parse(observedAt);
  return Number.isFinite(observedTime)
    && observedTime + EVIDENCE_WRITE_GRACE_MS < updatedAt.getTime();
}

function fallbackOwnerState(phase: BuildPhase): BuildStudioOwnerState {
  if (phase === "complete") return "complete";
  if (phase === "failed" || phase === "abandoned") return "failed";
  return "working";
}

/** Canonical phase -> plain-language position. The ONE map (BI one-attention-truth). */
export function fallbackNow(phase: BuildPhase): string {
  const labels: Record<BuildPhase, string> = {
    ideate: "Understanding the outcome",
    plan: "Shaping the approach",
    build: "Building the change",
    review: "Checking the work",
    ship: "Ready for a release decision",
    complete: "Live",
    failed: "Blocked by a problem",
    abandoned: "Work stopped",
  };
  return labels[phase];
}

/** Canonical phase -> next action. Note ship returns a real action, never
 *  "no action needed": a ship-phase build is waiting on the owner. */
export function fallbackNext(phase: BuildPhase): string {
  if (phase === "complete") return "Review whether the outcome improves as expected.";
  if (phase === "failed") return "Resolve the blocker before work continues.";
  if (phase === "abandoned") return "Resume only if this outcome is still valuable.";
  if (phase === "ship") return "Review the proof before release.";
  return "No action is needed unless Build Studio asks for a decision.";
}


/** Longest an outcome statement may be before it is clamped. */
export const OUTCOME_STATEMENT_MAX = 240;

/**
 * Reduce whatever the fallback chain found to ONE readable sentence.
 *
 * The chain's third entry is `build.description`, which for any build promoted
 * from the backlog is the WHOLE markdown BI body — "## Problem ... ## Scope ...
 * ## Acceptance criteria". BuildOperatorOverview rendered that into a single
 * plain <p>, so the operator's first viewport was a wall of unrendered markdown
 * (literal "##" and "> **" on screen), unclamped and occluded by the details
 * drawer. The full text is not lost: the drawer's Canonical doc section already
 * renders the same string as proper formatted markdown.
 *
 * So this is deliberately lossy. The Outcome slot answers "what did I ask for?"
 * in one line; anything longer belongs behind disclosure.
 */
export function toOutcomeStatement(raw: string): string {
  let text = raw.trim();
  if (!text) return text;

  // Drop fenced code blocks entirely — never a useful outcome statement.
  text = text.replace(/```[\s\S]*?```/g, " ");

  const lines = text.split(/\r?\n/);
  const prose: string[] = [];
  for (const line of lines) {
    let s = line.trim();
    if (!s) {
      // A blank line ends the first paragraph once we have prose.
      if (prose.length > 0) break;
      continue;
    }
    // Skip structural markdown: headings, list bullets, table rows, rules.
    if (/^#{1,6}\s/.test(s)) continue;
    if (/^[-*+]\s/.test(s) || /^\d+\.\s/.test(s)) continue;
    if (/^\|/.test(s) || /^[-=]{3,}$/.test(s)) continue;
    // Blockquote markers are noise, but the quoted text may be the statement.
    s = s.replace(/^>\s?/, "");
    if (!s) continue;
    prose.push(s);
  }

  // When a body carries no prose at all (headings + bullets only), fall back to
  // the raw text — but still strip the structural markers, or the operator sees
  // literal "##" and "-" in the Outcome slot.
  let statement = (
    prose.length > 0
      ? prose.join(" ")
      : text
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^[-*+]\s+/gm, "")
        .replace(/^\d+\.\s+/gm, "")
        .replace(/^>\s?/gm, "")
  ).trim();

  // Strip inline markdown emphasis/code, and reduce links to their label.
  statement = statement
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)[*_]([^*_]+)[*_](?!\w)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (statement.length <= OUTCOME_STATEMENT_MAX) return statement;

  // Prefer a sentence boundary inside the budget; otherwise clamp on a word.
  const window = statement.slice(0, OUTCOME_STATEMENT_MAX);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentenceEnd > OUTCOME_STATEMENT_MAX * 0.4) {
    return statement.slice(0, sentenceEnd + 1);
  }
  const wordEnd = window.lastIndexOf(" ");
  return `${statement.slice(0, wordEnd > 0 ? wordEnd : OUTCOME_STATEMENT_MAX).trimEnd()}\u2026`;
}

function firstText(...values: Array<string | null | undefined>): string {
  return firstTextOrNull(...values) ?? "Outcome not recorded yet.";
}

function firstTextOrNull(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
