// Decision-first owner copy for a proposed CoworkerActionEnvelope (BI-F95B0795).
//
// The envelope row stores the approval binding, not the proposed call. The
// pending ToolExecution.parameters (and, for some envelopes, argsJson) carry
// the exact arguments. This module projects those arguments plus bound
// subject/gate semantics into owner language. Unknown shapes fail closed.

export const GOVERNED_AUDIT_PARAMETER_KEYS = new Set([
  "_surface",
  "_takAlignment",
  "_takPrecondition",
]);

const KNOWN_DECISIONS = ["pass", "fail", "not-applicable"] as const;
export type EnvelopeRecordedDecision = (typeof KNOWN_DECISIONS)[number];

export type EnvelopeFinding = {
  issue: string;
  severity: "critical" | "important";
};

export type EnvelopeReviewBindingSummary = {
  gate: string;
  itemId: string;
};

export type EnvelopeDecisionSummary = {
  kind: "known" | "unknown";
  headline: string;
  recommendation: string;
  authorization: string;
  recordedIfAuthorized: string;
  authorizeDoes: string;
  declineDoes: string;
  ifYouDoNothing: string;
  decision?: EnvelopeRecordedDecision;
  findings: EnvelopeFinding[];
  reason?: string;
  subjectId?: string;
  gate?: string;
  recommenderLabel: string;
  authorizerLabel: string;
  toolName: string;
};

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Strip governed-audit keys and the stored approval binding. */
export function originalToolParameters(value: unknown): Record<string, unknown> | null {
  const record = objectRecord(value);
  if (!record) return null;
  const entries = Object.entries(record).filter(
    ([key]) => key !== "approvalBinding" && !GOVERNED_AUDIT_PARAMETER_KEYS.has(key),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function envelopeIdFromExecutionResult(result: unknown): string | null {
  const data = objectRecord(objectRecord(result)?.data);
  const envelopeId = data?.envelopeId;
  return typeof envelopeId === "string" && envelopeId.trim() ? envelopeId : null;
}

function parseDecision(value: unknown): EnvelopeRecordedDecision | undefined {
  return typeof value === "string" && (KNOWN_DECISIONS as readonly string[]).includes(value)
    ? value as EnvelopeRecordedDecision
    : undefined;
}

function parseFindings(value: unknown): EnvelopeFinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const findings: EnvelopeFinding[] = [];
  for (const entry of value) {
    const record = objectRecord(entry);
    if (!record || typeof record.issue !== "string" || !record.issue.trim()) return undefined;
    if (record.severity !== "critical" && record.severity !== "important") return undefined;
    findings.push({ issue: record.issue, severity: record.severity });
  }
  return findings;
}

function findingsPhrase(findings: EnvelopeFinding[]): string {
  if (findings.length === 0) return "with no findings";
  if (findings.length === 1) return "with 1 finding";
  return `with ${findings.length} findings`;
}

function researchRecommendation(
  gate: string,
  decision: EnvelopeRecordedDecision,
  findings: EnvelopeFinding[],
): string {
  if (gate === "research") {
    if (decision === "pass") return `research passes ${findingsPhrase(findings)}`;
    if (decision === "fail") return `research does not pass ${findingsPhrase(findings)}`;
    return "research is not applicable";
  }
  if (decision === "pass") return `${gate} passes ${findingsPhrase(findings)}`;
  if (decision === "fail") return `${gate} does not pass ${findingsPhrase(findings)}`;
  return `${gate} is not applicable`;
}

function researchAuthorization(
  gate: string,
  decision: EnvelopeRecordedDecision,
): string {
  if (gate === "research" && decision === "pass") {
    return "record that receipt so implementation planning may continue";
  }
  if (gate === "research" && decision === "fail") {
    return "record that receipt; implementation planning stays blocked until research passes";
  }
  if (gate === "research") {
    return "record that research does not apply to this item";
  }
  return `record that ${gate} receipt`;
}

function unknownSummary(input: {
  toolName: string;
}): EnvelopeDecisionSummary {
  return {
    kind: "unknown",
    headline: "Authorize this coworker record?",
    recommendation: "this action needs a person to record it",
    authorization: "record the coworker's proposed action if you accept it",
    recordedIfAuthorized:
      "A coworker proposed a record. The exact effect is not summarized for this action type.",
    authorizeDoes: "Records the proposed action.",
    declineDoes: "Does not record it. Your coworker stops.",
    ifYouDoNothing: "the window closes and the record is not written.",
    findings: [],
    recommenderLabel: "Your coworker",
    authorizerLabel: "You",
    toolName: input.toolName,
  };
}

export function summarizeCoworkerEnvelopeDecision(input: {
  toolName: string;
  proposedParameters: unknown;
  argsJson?: unknown;
  reviewBinding?: EnvelopeReviewBindingSummary;
  recommenderAgentId: string;
  authorizerUserId: string;
}): EnvelopeDecisionSummary {
  const fromExecution = originalToolParameters(input.proposedParameters);
  const fromEnvelope = originalToolParameters(input.argsJson);
  const params = fromExecution ?? fromEnvelope ?? {};
  const toolName = input.toolName.trim();
  const gate =
    (typeof params.gate === "string" && params.gate.trim())
    || input.reviewBinding?.gate.trim()
    || "";
  const subjectId =
    (typeof params.itemId === "string" && params.itemId.trim())
    || input.reviewBinding?.itemId.trim()
    || "";
  const decision = parseDecision(params.decision);
  const parsedFindings = parseFindings(params.findings);
  const findings =
    parsedFindings
    ?? (toolName === "record_initiative_evidence" && gate === "research" ? [] : []);
  const reason = typeof params.reason === "string" && params.reason.trim()
    ? params.reason.trim()
    : undefined;

  if (toolName !== "record_initiative_evidence" || !decision || !gate) {
    return unknownSummary({ toolName });
  }

  const recommendation = researchRecommendation(gate, decision, findings);
  const authorization = researchAuthorization(gate, decision);
  const recordedIfAuthorized = subjectId
    ? `${gate} on ${subjectId} will be recorded as ${decision} ${findingsPhrase(findings)}.`
    : `${gate} will be recorded as ${decision} ${findingsPhrase(findings)}.`;

  return {
    kind: "known",
    headline: gate === "research"
      ? "Authorize this research receipt?"
      : "Authorize this coworker record?",
    recommendation,
    authorization,
    recordedIfAuthorized,
    authorizeDoes: "Records the recommendation as a receipt.",
    declineDoes: "Does not record it. Your coworker stops.",
    ifYouDoNothing: decision === "pass" && gate === "research"
      ? "the receipt is not recorded and implementation planning stays blocked."
      : "the receipt is not recorded and the work stays blocked.",
    decision,
    findings,
    ...(reason ? { reason } : {}),
    ...(subjectId ? { subjectId } : {}),
    gate,
    recommenderLabel: "Your coworker",
    authorizerLabel: "You",
    toolName,
  };
}
