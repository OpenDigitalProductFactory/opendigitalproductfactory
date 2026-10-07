import { createHash } from "node:crypto";
import type { BacklogTriageAssessmentOutcome } from "@dpf/db";
import { AUTO_TRIAGE_CONFIDENCE_THRESHOLD, autoApplyBuildSize, buildTriageDrainPrompt, parseTriageDecision, TRIAGE_DRAIN_SYSTEM_PROMPT, type TriageCandidate, type TriageDecision } from "./backlog-triage-drain";

export const TRIAGE_ASSESSMENT_KIND = "triage_assessment";
export const TRIAGE_POLICY_VERSION = "triage-assessment.v1";
export const MAX_TRIAGE_ATTEMPTS = 3;
export const TRIAGE_RUN_BUDGET_MS = 5 * 60_000;
export const TRIAGE_CALL_BUDGET_MS = 60_000;
export const TRIAGE_OUTCOMES = ["auto-built", "needs-review", "low-confidence", "invalid-response", "model-error", "ledger-error", "apply-error", "changed", "in-flight"] as const;
export type AssessmentOutcome = typeof TRIAGE_OUTCOMES[number];
export type Assessment = { fingerprint: string; outcome: AssessmentOutcome; attempts: number; retryAt: string | null; rationale?: string };
const TRANSIENT = new Set<AssessmentOutcome>(["model-error", "ledger-error", "apply-error", "in-flight"]);
export const ASSESSMENT_DB_OUTCOMES = {
  "auto-built": "autoBuilt", "needs-review": "needsReview", "low-confidence": "lowConfidence",
  "invalid-response": "invalidResponse", "model-error": "modelError", "ledger-error": "ledgerError",
  "apply-error": "applyError", changed: "changed", "in-flight": "inFlight",
} as const satisfies Record<AssessmentOutcome, BacklogTriageAssessmentOutcome>;

export function assessmentOutcomeFromDb(value: BacklogTriageAssessmentOutcome | null): AssessmentOutcome | null {
  return TRIAGE_OUTCOMES.find(outcome => ASSESSMENT_DB_OUTCOMES[outcome] === value) ?? null;
}

export function triageFingerprint(item: TriageCandidate, retriageId = ""): string {
  // Full body participates even though the prompt is bounded: new evidence must
  // invalidate a held assessment rather than silently disappear behind truncation.
  return createHash("sha256").update(JSON.stringify([TRIAGE_POLICY_VERSION, TRIAGE_DRAIN_SYSTEM_PROMPT, AUTO_TRIAGE_CONFIDENCE_THRESHOLD, buildTriageDrainPrompt(item), item.body ?? null, retriageId])).digest("hex");
}

export function readAssessment(value: unknown): Assessment | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Assessment>;
  if (typeof v.fingerprint !== "string" || !TRIAGE_OUTCOMES.includes(v.outcome as AssessmentOutcome) || !Number.isInteger(v.attempts) || (v.attempts ?? 0) < 1) return null;
  if (v.retryAt !== null && (typeof v.retryAt !== "string" || !Number.isFinite(Date.parse(v.retryAt)))) return null;
  return v as Assessment;
}

export function assessmentEligible(item: TriageCandidate, previous: unknown, now: Date, retriageId = ""): boolean {
  const assessment = readAssessment(previous);
  if (!assessment || assessment.fingerprint !== triageFingerprint(item, retriageId)) return true;
  if (!TRANSIENT.has(assessment.outcome) || assessment.attempts >= MAX_TRIAGE_ATTEMPTS) return false;
  return assessment.retryAt !== null && Date.parse(assessment.retryAt) <= now.getTime();
}

export function nextAssessment(fingerprint: string, outcome: AssessmentOutcome, attempts: number, now: Date, rationale?: string): Assessment {
  const delay = outcome === "in-flight" ? 2 * TRIAGE_CALL_BUDGET_MS : 60 * 60_000 * 4 ** (attempts - 1);
  return { fingerprint, outcome, attempts, retryAt: TRANSIENT.has(outcome) && attempts < MAX_TRIAGE_ATTEMPTS ? new Date(now.getTime() + delay).toISOString() : null, ...(rationale ? { rationale: rationale.slice(0, 400) } : {}) };
}

export type AssessmentDeps = {
  decide: (item: TriageCandidate) => Promise<string>;
  recordDecision: (item: TriageCandidate, decision: TriageDecision, size: string) => Promise<boolean>;
  applyBuild: (itemId: string, size: string, rationale: string) => Promise<boolean | void>;
  /** Bounds waiting; provider transport retains its own cancellation policy. */
  callBudgetMs?: number;
};

export async function assessTriageItem(item: TriageCandidate, deps: AssessmentDeps): Promise<{ outcome: AssessmentOutcome; rationale?: string }> {
  let decision: TriageDecision | null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const content = await Promise.race([
      deps.decide(item),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("triage-call-budget")), deps.callBudgetMs ?? TRIAGE_CALL_BUDGET_MS); }),
    ]);
    decision = parseTriageDecision(content);
  }
  catch { return { outcome: "model-error" }; }
  finally { if (timer) clearTimeout(timer); }
  if (!decision || !["build", "needs-human"].includes(decision.outcome) || typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) return { outcome: "invalid-response" };
  const rationale = decision.rationale?.slice(0, 400);
  if (decision.outcome === "needs-human") return { outcome: "needs-review", rationale };
  if (decision.confidence < AUTO_TRIAGE_CONFIDENCE_THRESHOLD) return { outcome: "low-confidence", rationale };
  const size = autoApplyBuildSize(decision, item);
  if (!size) return { outcome: "invalid-response" };
  try { if (!await deps.recordDecision(item, decision, size)) return { outcome: "ledger-error" }; }
  catch { return { outcome: "ledger-error" }; }
  try {
    const applied = await deps.applyBuild(item.itemId, size, `Auto-triaged by scheduled drain: ${rationale ?? "confident build"}`);
    return { outcome: applied === false ? "changed" : "auto-built", rationale };
  } catch { return { outcome: "apply-error" }; }
}
