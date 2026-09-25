// apps/web/lib/build/finalize-stage.ts
//
// BI-A0521CB0 — Build Studio's finalize stage. Founder decision (2026-09-25):
// the build path writes what review requires itself. Live on FB-D671B016, the
// code was correct (57/57 tests, clean typecheck) but the build stopped in
// review: its commits carried no decision trailers, and nothing wrote the
// failure analysis the semantic review requires.
//
// Two rules keep this honest:
// - The gauntlet is the validator. The specialist is handed the gauntlet's own
//   failure text (which states each trailer's grammar and allowed values), its
//   lines are checked for shape only, and the caller re-runs the gauntlet.
//   Re-implementing each gate's grammar here would drift from the gates.
// - Code owns identity. The model writes the failure analysis narrative; the
//   schema version, Workroom, tree, diff digest, design reference and evidence
//   ids come from the platform, and validateFailureAnalysis decides.

import { validateFailureAnalysis, type FailureAnalysis, type FailureAnalysisIdentity, type FailureVerificationEvidence } from "@/lib/change-review/failure-analysis";

/** Guards whose only remedy is a recorded decision, and the trailer each needs. */
const TRAILER_GUARDS: Readonly<Record<string, string>> = {
  "Docs Impact Gate": "Docs-Impact-Decision",
  "Seed Contribution Fit Gate": "Seed-Fit-Decision",
  "Convergence-Impact Gate": "Convergence-Impact-Decision",
  "Data-Impact Gate": "Data-Impact-Decision",
  "Design Grounding Gate": "Design-Grounding-Decision",
  "Spec/Plan/Doc Gate": "Process-Spine-Decision",
};

/**
 * The trailers that would satisfy these failures, or null when any failure is
 * something a decision cannot fix. A real defect must stay a failure.
 */
export function trailerKeysForFailedGuards(failedGuards: readonly string[]): string[] | null {
  if (failedGuards.length === 0) return null;
  const keys: string[] = [];
  for (const guard of failedGuards) {
    const key = TRAILER_GUARDS[guard];
    if (!key) return null;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** One well-formed `Key: value` line per required key; anything else is dropped. */
export function parseTrailerLines(
  text: string,
  keys: readonly string[],
): { kind: "ok"; lines: string[] } | { kind: "missing"; missing: string[] } {
  const lines: string[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const match = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith(`${key}:`));
    const value = match?.slice(key.length + 1).trim() ?? "";
    if (value.length < 3) missing.push(key);
    else lines.push(`${key}: ${value}`);
  }
  return missing.length === 0 ? { kind: "ok", lines } : { kind: "missing", missing };
}

function gateDecisionPrompt(input: { keys: readonly string[]; guardOutput: string; diffSummary: string; retryFor?: string[] }): string {
  return [
    "You are recording gate decisions for a finished Build Studio change. Each failed gate below needs exactly one trailer line.",
    "Read each gate's own failure text: it states the trailer's grammar and its allowed values. Use only those values, and give a",
    "specific reason grounded in the change. Never claim a mechanism the change does not use.",
    "",
    `Required trailers: ${input.keys.join(", ")}`,
    input.retryFor?.length ? `Your previous answer was missing or empty for: ${input.retryFor.join(", ")}. Provide them.` : "",
    "",
    "Changed files:",
    input.diffSummary.slice(0, 4000),
    "",
    "Gate failure output:",
    input.guardOutput.slice(-8000),
    "",
    "Reply with ONLY the trailer lines, one per line, in the form `Key: value`.",
  ].filter(Boolean).join("\n");
}

/** Ask once; retry once naming what was missing; then report honestly. */
export async function authorGateDecisions(input: {
  llm: (prompt: string) => Promise<string>;
  keys: readonly string[];
  guardOutput: string;
  diffSummary: string;
}): Promise<{ kind: "ok"; lines: string[] } | { kind: "missing"; missing: string[] }> {
  let parsed = parseTrailerLines(await input.llm(gateDecisionPrompt(input)), input.keys);
  if (parsed.kind !== "ok") {
    parsed = parseTrailerLines(await input.llm(gateDecisionPrompt({ ...input, retryFor: parsed.missing })), input.keys);
  }
  return parsed;
}

export type FailureAnalysisNarrative = {
  designAnalysis: string;
  scope: string;
  affectedPeople: string;
  invariants: string;
  boundaries: string;
  eliminated?: Array<{ opportunity: string; mechanism: string }>;
  noEliminationRationale?: string;
  scenarios: Array<{
    key: string; trigger: string; effect: string; severity: "low" | "medium" | "high" | "critical";
    exposure: string; prevention: string; containment: string; detection: string; recovery: string;
    residualRisk: { owner: string; disposition: "mitigated" | "accepted" | "deferred" | "blocked"; rationale: string };
  }>;
};

/** The platform fills identity and evidence; the narrative fills the rest. */
export function composeFailureAnalysis(input: {
  identity: FailureAnalysisIdentity;
  designReference: string;
  evidenceIds: readonly string[];
  narrative: FailureAnalysisNarrative;
}): FailureAnalysis {
  const n = input.narrative;
  const evidenceIds = [...input.evidenceIds];
  return {
    schemaVersion: 1,
    capsuleId: input.identity.capsuleId,
    headTreeHash: input.identity.headTreeHash,
    diffDigest: input.identity.diffDigest,
    design: { reference: input.designReference, analysis: n.designAnalysis },
    scope: n.scope,
    affectedPeople: n.affectedPeople,
    invariants: n.invariants,
    boundaries: n.boundaries,
    eliminated: (n.eliminated ?? []).map((e) => ({ opportunity: e.opportunity, mechanism: e.mechanism, evidenceIds })),
    ...(n.noEliminationRationale ? { noEliminationRationale: n.noEliminationRationale } : {}),
    scenarios: n.scenarios.map((s) => ({ ...s, evidenceIds })),
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function failureAnalysisPrompt(input: { evidence: readonly FailureVerificationEvidence[]; diffSummary: string; retryReasons?: string[] }): string {
  return [
    "Write the failure analysis for a finished Build Studio change, as JSON with these string fields:",
    "designAnalysis, scope, affectedPeople, invariants, boundaries, and either eliminated (array of {opportunity, mechanism})",
    "or noEliminationRationale; and scenarios (array, at least one) of {key, trigger, effect, severity (low|medium|high|critical),",
    "exposure, prevention, containment, detection, recovery, residualRisk: {owner, disposition, rationale}}.",
    "Every text field needs at least 20 characters of specific content. Keep depth proportional to consequence.",
    "Use disposition \"mitigated\" only when the prevention and containment you describe actually mitigate it.",
    "Never claim that all failures are eliminated or that there is zero risk.",
    input.retryReasons?.length ? `Your previous answer failed validation: ${input.retryReasons.join(", ")}. Fix those.` : "",
    "",
    "Changed files:",
    input.diffSummary.slice(0, 4000),
    "",
    "Executed evidence you can rely on:",
    ...input.evidence.map((e) => `- ${e.id}: ran \`${e.expected.slice(0, 200)}\`; observed: ${e.observed.slice(0, 300)}`),
    "",
    "Reply with ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

/** Narrative from the model, identity from the platform, verdict from the validator. One retry. */
export async function authorFailureAnalysis(input: {
  llm: (prompt: string) => Promise<string>;
  identity: FailureAnalysisIdentity;
  designReference: string;
  evidence: readonly FailureVerificationEvidence[];
  diffSummary: string;
}): Promise<{ kind: "ok"; failureAnalysis: FailureAnalysis } | { kind: "invalid"; reasons: string[] }> {
  let reasons: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = extractJson(await input.llm(failureAnalysisPrompt({ ...input, retryReasons: reasons })));
    if (!raw || typeof raw !== "object") {
      reasons = ["response was not a JSON object"];
      continue;
    }
    const candidate = composeFailureAnalysis({
      identity: input.identity,
      designReference: input.designReference,
      evidenceIds: input.evidence.map((e) => e.id),
      narrative: raw as FailureAnalysisNarrative,
    });
    const verdict = validateFailureAnalysis(candidate, input.identity, input.evidence);
    if (verdict.valid && verdict.analysis) return { kind: "ok", failureAnalysis: verdict.analysis };
    reasons = verdict.reasons;
  }
  return { kind: "invalid", reasons };
}
