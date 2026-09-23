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

/** One proposed field, in the order the coworker sent it. */
export type EnvelopeProposedField = { label: string; value: string };

export type EnvelopeDecisionSummary = {
  /**
   * known   - a tool-specific summary (research receipts).
   * exact   - no tool-specific summary, but the exact proposed content is shown.
   * unknown - the proposed content could not be loaded; the effect is
   *           UNRESOLVED and the card says so rather than inviting a click.
   */
  kind: "known" | "exact" | "unknown";
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
  /** What the coworker will do, in plain words. */
  action: string;
  /** Where it lands: the record or surface the change is written to. */
  target: string;
  /** The exact proposed content, bounded for display. Empty when unresolved. */
  proposed: EnvelopeProposedField[];
  /** The declared consequence of the action, or a plain statement that none is declared. */
  consequence: string;
  /** Why a person is asked: the governing reason recorded on the envelope. */
  whyAPerson: string;
  /** What authorizing covers, and what it does not. */
  scope: string;
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

const ACTION_LABELS: Record<string, string> = {
  record_workroom_evidence: "Add an evidence entry to a Workroom timeline",
  record_runtime_verification: "Record a runtime verification result",
  record_execution_evidence: "Record execution evidence on a backlog item",
  create_backlog_item: "Create a new backlog item",
  update_backlog_item: "Edit a backlog item",
  update_backlog_item_status: "Change the status of a backlog item",
  create_workroom: "Open a new Workroom",
  update_workroom_status: "Change the status of a Workroom",
  invite_room_participant: "Give a participant access to a room",
  manage_coworker_tool_grant: "Change the tool permissions of a coworker",
  claim_backlog_item_for_work: "Claim a backlog item for work",
  claim_nonprod_environment_lease: "Reserve a shared test environment",
  record_initiative_evidence: "Record a readiness receipt",
};

const CONSEQUENCE_WORDS: Record<string, string> = {
  outward: "Reaches outside the platform, to people or systems beyond it.",
  irreversible: "Cannot be undone once it runs.",
  authority: "Changes who may do what.",
};

const MAX_FIELDS = 12;
const MAX_VALUE_CHARS = 600;

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced ? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}` : key;
}

function displayValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}… (${text.length - MAX_VALUE_CHARS} more characters)`
    : text;
}

/** The exact proposed arguments as label/value pairs, in the order sent. */
export function proposedFields(params: Record<string, unknown>): EnvelopeProposedField[] {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const shown = entries.slice(0, MAX_FIELDS).map(([key, value]) => ({
    label: humanizeKey(key),
    value: displayValue(value),
  }));
  if (entries.length > MAX_FIELDS) {
    shown.push({ label: "More fields", value: `${entries.length - MAX_FIELDS} more not shown` });
  }
  return shown;
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Where the change lands, derived from the arguments the coworker sent. */
export function envelopeTarget(toolName: string, params: Record<string, unknown>): string {
  const capsule = stringParam(params, "capsuleId");
  if (capsule) return `Workroom ${capsule}`;
  const item = stringParam(params, "itemId");
  if (item) return `Backlog item ${item}`;
  if (toolName === "create_backlog_item") {
    const epic = stringParam(params, "epicId");
    return epic ? `The backlog, under epic ${epic}` : "The backlog";
  }
  return stringParam(params, "targetId") ?? stringParam(params, "url") ?? "Not named in the proposal";
}

function actionLabel(toolName: string): string {
  return ACTION_LABELS[toolName] ?? `Run ${toolName}`;
}

function consequenceText(consequence: string | null | undefined): string {
  return consequence && CONSEQUENCE_WORDS[consequence]
    ? CONSEQUENCE_WORDS[consequence]
    : "None declared. It adds or changes a platform record that can be corrected afterwards.";
}

const SCOPE_TEXT =
  "Covers this one request only: this coworker, this exact content, before the window closes. "
  + "It does not cover later requests. It does not review the content or confirm that any test it cites is correct.";

type SummaryContext = {
  toolName: string;
  params: Record<string, unknown> | null;
  consequence?: string | null;
  rationale?: string | null;
};

function sharedFacts(input: SummaryContext) {
  return {
    action: actionLabel(input.toolName),
    target: input.params
      ? envelopeTarget(input.toolName, input.params)
      : "Unknown: the proposal could not be loaded",
    proposed: input.params ? proposedFields(input.params) : [],
    consequence: consequenceText(input.consequence),
    whyAPerson: input.rationale?.trim() || "No reason was recorded for asking a person.",
    scope: SCOPE_TEXT,
  };
}

function unknownSummary(input: SummaryContext): EnvelopeDecisionSummary {
  if (input.params) {
    const action = actionLabel(input.toolName);
    return {
      kind: "exact",
      headline: "Authorize this coworker change?",
      recommendation: "your coworker proposes the exact change shown",
      authorization: `${action.charAt(0).toLowerCase()}${action.slice(1)}, exactly as shown`,
      recordedIfAuthorized: `${action}, with exactly the content shown.`,
      authorizeDoes: "Lets your coworker make this exact change.",
      declineDoes: "Nothing is changed. Your coworker stops.",
      ifYouDoNothing: "the window closes and nothing is changed.",
      findings: [],
      recommenderLabel: "Your coworker",
      authorizerLabel: "You",
      toolName: input.toolName,
      ...sharedFacts(input),
    };
  }
  return {
    kind: "unknown",
    headline: "Effect unresolved: this request cannot be shown",
    recommendation: "the proposed content could not be loaded",
    authorization: "decline unless you already know what this request writes",
    recordedIfAuthorized:
      "The proposed content could not be loaded, so this card cannot show what would be recorded.",
    authorizeDoes: "Lets your coworker run a change this card cannot show.",
    declineDoes: "Nothing is changed. Your coworker stops.",
    ifYouDoNothing: "the window closes and nothing is changed.",
    findings: [],
    recommenderLabel: "Your coworker",
    authorizerLabel: "You",
    toolName: input.toolName,
    ...sharedFacts(input),
  };
}

export function summarizeCoworkerEnvelopeDecision(input: {
  toolName: string;
  proposedParameters: unknown;
  argsJson?: unknown;
  reviewBinding?: EnvelopeReviewBindingSummary;
  recommenderAgentId: string;
  authorizerUserId: string;
  /** The tool's declared consequence, when it declares one. */
  consequence?: string | null;
  /** The governing reason stored on the envelope. */
  rationale?: string | null;
}): EnvelopeDecisionSummary {
  const fromExecution = originalToolParameters(input.proposedParameters);
  const fromEnvelope = originalToolParameters(input.argsJson);
  const resolvedParams = fromExecution ?? fromEnvelope;
  const params = resolvedParams ?? {};
  const context: SummaryContext = {
    toolName: input.toolName.trim(),
    params: resolvedParams,
    consequence: input.consequence ?? null,
    rationale: input.rationale ?? null,
  };
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
    return unknownSummary(context);
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
    ...sharedFacts(context),
  };
}
