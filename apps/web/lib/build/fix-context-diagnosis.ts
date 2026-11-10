// apps/web/lib/build/fix-context-diagnosis.ts
//
// The RULE half of fix-build self-diagnosis. The dispatch/IO half lives in
// ideate-on-approval.ts; everything decidable is here so it is testable without
// the dispatch stack — the same split review-fix-outcome.ts uses.
//
// Why this exists: a fix build whose fixContext lacks reproSteps, rootCause or
// fixApproach fails review with "Incomplete fix diagnosis" and escalates to a
// human at round 0, because regenerating the designDoc cannot fill those
// fields. On an unattended install nobody answers, and the build is reaped at
// seven days. Measured on this install: of 16 abandoned fix builds, 14 had an
// incomplete diagnosis, and "design repair escalated" is the single largest
// cause of abandonment (14 of 45).
//
// The briefs are not empty — they carry a "## Problem" narrative naming dates,
// entity ids and observed symptoms. That is material an investigator can work
// from, so the build should attempt its own diagnosis before spending a human.
//
// The hard rule: a diagnosis is either GROUNDED or it is refused. A fabricated
// root cause is worse than an escalation, because it launders a guess into the
// evidence trail and the plan phase then builds on it.

/** The three fields `isFixContextComplete` requires. */
export type FixDiagnosis = {
  reproSteps: string;
  rootCause: string;
  fixApproach: string;
};

export type DiagnosisRefusal = {
  refused: true;
  /** Why it was refused — surfaced in BuildActivity so the trail says what happened. */
  reason: string;
};

/** Minimum characters for a field to count as said-something-real. */
const MIN_FIELD_CHARS = 24;

/**
 * Phrases a model emits when it could not actually determine the answer.
 * Treating these as a diagnosis is the fabrication this module exists to stop.
 */
const NON_ANSWER = [
  "unknown",
  "unclear",
  "not sure",
  "cannot determine",
  "could not determine",
  "unable to determine",
  "needs investigation",
  "requires investigation",
  "further investigation",
  "tbd",
  "n/a",
  "not applicable",
  "insufficient information",
  "no information",
  "placeholder",
];

function saysSomething(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_FIELD_CHARS) return false;
  const lowered = trimmed.toLowerCase();
  // A field that is ONLY a non-answer is refused; one that mentions uncertainty
  // inside a substantive answer is kept, because real diagnoses carry caveats.
  return !NON_ANSWER.some((phrase) => lowered === phrase || lowered.startsWith(`${phrase}.`) || lowered.startsWith(`${phrase},`));
}

/**
 * Accept a model's diagnosis only when all three fields say something real.
 *
 * Partial diagnoses are refused rather than merged: `isFixContextComplete`
 * requires all three, so writing two of them would leave the build failing the
 * same review while claiming progress in its activity trail.
 */
export function parseFixDiagnosis(raw: unknown): FixDiagnosis | DiagnosisRefusal {
  let candidate: unknown = raw;

  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { refused: true, reason: "diagnosis response contained no JSON object" };
    try {
      candidate = JSON.parse(match[0]);
    } catch {
      return { refused: true, reason: "diagnosis response was not parseable JSON" };
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { refused: true, reason: "diagnosis response was not an object" };
  }

  const doc = candidate as Record<string, unknown>;
  const missing = (["reproSteps", "rootCause", "fixApproach"] as const).filter(
    (field) => !saysSomething(doc[field]),
  );
  if (missing.length > 0) {
    return {
      refused: true,
      reason: `diagnosis did not establish ${missing.join(", ")} — escalating rather than recording a guess`,
    };
  }

  return {
    reproSteps: (doc.reproSteps as string).trim(),
    rootCause: (doc.rootCause as string).trim(),
    fixApproach: (doc.fixApproach as string).trim(),
  };
}

export function isDiagnosisRefusal(
  value: FixDiagnosis | DiagnosisRefusal,
): value is DiagnosisRefusal {
  return (value as DiagnosisRefusal).refused === true;
}

/**
 * The investigator's brief. It asks for grounding explicitly and tells the model
 * that refusing is a valid, preferred outcome — the prompt half of the rule that
 * a guess must never reach the evidence trail.
 */
export function buildFixDiagnosisPrompt(input: {
  title: string;
  problem: string;
  priorIssues?: readonly string[];
}): string {
  const prior = input.priorIssues?.length
    ? `\n\nThe review rejected the current diagnosis for:\n${input.priorIssues.map((i) => `  - ${i}`).join("\n")}`
    : "";
  return (
    `Diagnose this defect so it can be planned against. You are the design author, `
    + `not a reviewer.\n\nTITLE: ${input.title}\n\nREPORTED PROBLEM:\n${input.problem}${prior}\n\n`
    + `Investigate before answering: read the code paths the report names, and confirm the `
    + `behaviour on the current tree rather than from memory.\n\n`
    + `Respond with ONLY a JSON object:\n`
    + `{"reproSteps":"...","rootCause":"...","fixApproach":"..."}\n\n`
    + `reproSteps  — how to observe the defect, concretely enough to repeat.\n`
    + `rootCause   — the mechanism, naming the file/function responsible.\n`
    + `fixApproach — what to change, and what deliberately stays unchanged.\n\n`
    + `If the report does not give you enough to establish any one of these, say so `
    + `plainly in that field instead of guessing. A refused diagnosis is escalated to a `
    + `human, which is the correct outcome. A guess recorded as fact is not — it becomes `
    + `the evidence the plan phase builds on.`
  );
}
