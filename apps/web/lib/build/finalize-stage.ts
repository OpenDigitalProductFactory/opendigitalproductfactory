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

/** A platform-decided acceptance for one scenario (BI-09FB398D). Never from the model. */
export type RiskAcceptanceGrant = {
  key: string;
  authority: FailureVerificationEvidence;
  followUpReference: string;
  /** One sentence for the rationale: who decided, under what, and who owns it. */
  note: string;
};

/**
 * The platform fills identity, evidence and any acceptance authority; the
 * narrative fills the rest. A residual risk keeps only the narrative's owner,
 * disposition and rationale: an authority id or follow-up the model wrote is
 * dropped, because a narrative is never an authority receipt.
 */
export function composeFailureAnalysis(input: {
  identity: FailureAnalysisIdentity;
  designReference: string;
  evidenceIds: readonly string[];
  narrative: FailureAnalysisNarrative;
  acceptances?: readonly RiskAcceptanceGrant[];
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
    scenarios: n.scenarios.map((s) => {
      const { residualRisk, ...scenario } = s;
      const grant = input.acceptances?.find((a) => a.key === s.key);
      const base = { owner: residualRisk?.owner, disposition: residualRisk?.disposition, rationale: residualRisk?.rationale };
      return {
        ...scenario,
        evidenceIds,
        residualRisk: grant && residualRisk?.disposition === "deferred"
          ? { ...base, disposition: "accepted" as const, rationale: `${base.rationale ?? ""} ${grant.note}`.trim(),
            authorityEvidenceId: grant.authority.id, followUpReference: grant.followUpReference }
          : base,
      };
    }) as FailureAnalysis["scenarios"],
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

/** The validator's reason codes, restated so the model can act on them. */
export function explainRetryReason(reason: string): string {
  const disposition = reason.match(/^risk-disposition-requires-authority:(.+)$/);
  if (disposition) {
    return `scenario "${disposition[1]}" used a disposition the platform cannot record. Mark it "mitigated" if this change's prevention and containment mitigate it, "blocked" if this change should mitigate it but does not, or "deferred" if its mitigation lies outside this change. Never mark it "accepted": the platform records acceptance.`;
  }
  if (reason === "unsupported-exhaustive-safety-claim") return "remove any claim that every failure is eliminated or that there is zero risk.";
  if (reason === "elimination-rationale-missing") return "give either eliminated (with at least one entry) or noEliminationRationale.";
  return reason;
}

function failureAnalysisPrompt(input: { evidence: readonly FailureVerificationEvidence[]; diffSummary: string; retryReasons?: string[] }): string {
  return [
    "Write the failure analysis for a finished Build Studio change, as JSON with these string fields:",
    "designAnalysis, scope, affectedPeople, invariants, boundaries, and either eliminated (array of {opportunity, mechanism})",
    "or noEliminationRationale; and scenarios (array, at least one) of {key, trigger, effect, severity (low|medium|high|critical),",
    "exposure, prevention, containment, detection, recovery, residualRisk: {owner, disposition, rationale}}.",
    "Every text field needs at least 20 characters of specific content. Keep depth proportional to consequence.",
    "Use disposition \"mitigated\" only when the prevention and containment you describe actually mitigate it.",
    // Acceptance is recorded by the platform, never by the model (FB-D671B016,
    // 2026-09-25). BI-09FB398D: a risk whose mitigation lies outside the change
    // is "deferred"; the escalation gate then decides it under WWMD and, when
    // it is not damaging, accepts it with an owning item.
    "Use exactly one of three dispositions:",
    "- \"mitigated\": this change's own prevention and containment mitigate it.",
    "- \"blocked\": a real risk this change should mitigate but does not. The build goes back to be fixed.",
    "- \"deferred\": a real risk whose mitigation lies outside this change (for example infrastructure durability or another",
    "  service). Say in the rationale where it belongs. The platform decides it under governance and files the item that owns it.",
    "Never mark a risk \"accepted\": the platform records acceptance, not you.",
    "Keep severity proportional to what the change does: tightening validation or correcting documentation lowers risk, and should not be rated critical.",
    "Never claim that all failures are eliminated or that there is zero risk.",
    input.retryReasons?.length ? `Your previous answer failed validation:\n${input.retryReasons.map((r) => `- ${explainRetryReason(r)}`).join("\n")}\nFix those.` : "",
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

/** A risk the analysis says this change does not mitigate, as handed back for repair. */
export type UnmitigatedRisk = {
  key: string; severity: "low" | "medium" | "high" | "critical";
  trigger: string; effect: string; disposition: string; rationale: string;
};

const DISPOSITION_REASON = /^risk-disposition-requires-authority:/;

/**
 * What the escalation gate made of the out-of-scope risks (BI-09FB398D):
 * accepted with an owning item, damaging and so for a person, or undecided and
 * so back on the bounded repair path.
 */
export type RiskAcceptanceOutcome = {
  accepted: RiskAcceptanceGrant[];
  owner: UnmitigatedRisk[];
  unaccepted: UnmitigatedRisk[];
};

function unmitigatedRisks(analysis: FailureAnalysis): UnmitigatedRisk[] {
  return analysis.scenarios
    .filter((s) => s.residualRisk.disposition !== "mitigated")
    .map((s) => ({
      key: s.key, severity: s.severity, trigger: s.trigger, effect: s.effect,
      disposition: s.residualRisk.disposition, rationale: s.residualRisk.rationale,
    }));
}

/**
 * Narrative from the model, identity from the platform, verdict from the validator. One retry.
 *
 * BI-83E1ADF8: an analysis that fails only because a risk is not mitigated is a
 * verdict on the change, not a malformed answer. "blocked" is what the prompt
 * asks for when a real risk is unmitigated, so it is never retried — a retry
 * only pressures the model to relabel the risk "mitigated". Accepted/deferred
 * get the one retry (the prompt forbids them); still unmitigated after it, the
 * risks are returned for the build to repair. The validator rule is unchanged.
 */
export async function authorFailureAnalysis(input: {
  llm: (prompt: string) => Promise<string>;
  identity: FailureAnalysisIdentity;
  designReference: string;
  evidence: readonly FailureVerificationEvidence[];
  diffSummary: string;
  /**
   * BI-09FB398D: decide risks the analysis places outside this change through
   * the escalation gate. Absent, they stay on the repair path as before.
   */
  acceptOutOfScopeRisks?: (risks: UnmitigatedRisk[]) => Promise<RiskAcceptanceOutcome>;
}): Promise<
  | { kind: "ok"; failureAnalysis: FailureAnalysis }
  | { kind: "risk-blocked"; risks: UnmitigatedRisk[] }
  | { kind: "risk-needs-owner"; risks: UnmitigatedRisk[] }
  | { kind: "invalid"; reasons: string[] }
> {
  let reasons: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = extractJson(await input.llm(failureAnalysisPrompt({ ...input, retryReasons: reasons })));
    if (!raw || typeof raw !== "object") {
      reasons = ["response was not a JSON object"];
      continue;
    }
    const compose = (acceptances?: readonly RiskAcceptanceGrant[]) => composeFailureAnalysis({
      identity: input.identity,
      designReference: input.designReference,
      evidenceIds: input.evidence.map((e) => e.id),
      narrative: raw as FailureAnalysisNarrative,
      acceptances,
    });
    const verdict = validateFailureAnalysis(compose(), input.identity, input.evidence);
    if (verdict.valid && verdict.analysis) return { kind: "ok", failureAnalysis: verdict.analysis };
    reasons = verdict.reasons;
    if (!verdict.analysis || reasons.length === 0 || !reasons.every((r) => DISPOSITION_REASON.test(r))) continue;

    const risks = unmitigatedRisks(verdict.analysis);
    // In scope: the change should mitigate it, so it goes back to be repaired.
    const inScope = risks.filter((r) => r.disposition === "blocked");
    if (inScope.length > 0) return { kind: "risk-blocked", risks: inScope };
    // "accepted" is the platform's to record; the model gets one retry to say
    // what it means, then the risk is treated as unmitigated.
    if (risks.some((r) => r.disposition === "accepted")) {
      if (attempt === 1) return { kind: "risk-blocked", risks };
      continue;
    }
    // Every open risk lies outside this change: the escalation gate decides.
    if (!input.acceptOutOfScopeRisks) return { kind: "risk-blocked", risks };
    const decided = await input.acceptOutOfScopeRisks(risks);
    if (decided.owner.length > 0) return { kind: "risk-needs-owner", risks: decided.owner };
    if (decided.unaccepted.length > 0) return { kind: "risk-blocked", risks: decided.unaccepted };
    const evidence = [...input.evidence, ...decided.accepted.map((a) => a.authority)];
    const accepted = validateFailureAnalysis(compose(decided.accepted), input.identity, evidence);
    if (accepted.valid && accepted.analysis) return { kind: "ok", failureAnalysis: accepted.analysis };
    return { kind: "invalid", reasons: accepted.reasons };
  }
  return { kind: "invalid", reasons };
}
