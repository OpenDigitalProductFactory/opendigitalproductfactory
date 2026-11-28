import { SOURCE_CATALOG, DEFAULT_LOCALE, formatSource } from "@dpf/i18n";
import type { ToolConsequence } from "@dpf/validators/gpp/tool-facts";
import {
  formatPresentationParam,
  isApprovalPresentationCompatibleWithConsequence,
  matchesApprovalPresentationParams,
  type ApprovalPosture,
  type ToolApprovalPresentation,
} from "@/lib/tool-approval-presentation";

// Decision-first owner copy for a proposed CoworkerActionEnvelope (BI-F95B0795).
//
// The envelope row stores the approval binding, not the proposed call. The
// pending ToolExecution.parameters (and, for some envelopes, argsJson) carry
// the exact arguments. This module projects those arguments plus bound
// subject/gate semantics into owner language. Unknown shapes fail closed.

export const TASK_EXECUTION_FENCE_AUDIT_KEY = "_taskExecutionFence";
export const GOVERNED_AUDIT_PARAMETER_KEYS = new Set([
  "_surface",
  "_takAlignment",
  "_takPrecondition",
  // The platform approval-resume marker (approval-resume-marker.ts, BI-C8EC05C9).
  "_approvalResume",
  TASK_EXECUTION_FENCE_AUDIT_KEY,
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
   * handover - a room handed to a new assistant, in plain words (BI-F4EB23C1).
   * admission - a coworker admitted to a room with its data access raised to
   *           the room's level, in plain words (BI-6AE64074).
   */
  kind: "known" | "exact" | "unknown" | "handover" | "admission";
  /** What a handover changes and keeps; present only for kind "handover". */
  handover?: { changes: string[]; keeps: string[]; nextStep?: string };
  /** What an admission with a raise changes and keeps; present only for kind "admission". */
  admission?: { changes: string[]; keeps: string[] };
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
  /** A readable target name resolved under the viewing person's access policy. */
  targetLabel?: string;
  duplicateLabel?: string;
  /** A bounded preview of the proposed content. Empty when unresolved. */
  proposed: EnvelopeProposedField[];
  /** Complete original input for review; absent on older projections, null when unresolved. */
  completeProposedContent?: string | null;
  /** The declared consequence of the action, or a plain statement that none is declared. */
  consequence: string;
  /** Why a person is asked: the governing reason recorded on the envelope. */
  whyAPerson: string;
  /** What authorizing covers, and what it does not. */
  scope: string;
  /** Declared consequence class from the tool registry, when present. */
  declaredConsequence?: ToolConsequence | null;
  /**
   * Verified registry presentation metadata when the tool declared one AND
   * the captured parameters strictly matched its `allowedParams` contract.
   */
  approvalPresentation?: ToolApprovalPresentation;
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
  rebind_workroom_shape: "Move a Workroom to a newer version of its work shape",
  invite_room_participant: "Give a participant access to a room",
  manage_coworker_tool_grant: "Change the tool permissions of a coworker",
  reassign_workroom_executor: "Hand a Workroom to a new assistant",
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

function materialFactLabel(path: string[]): string {
  const labels = path.map(humanizeKey);
  if (path[0]?.toLowerCase() === "payment" && path.length > 1) {
    return labels.slice(1).join(" · ");
  }
  if (path[0]?.toLowerCase() === "permission" && path.length === 2) {
    return labels[0] ?? "Permission";
  }
  return labels.join(" · ");
}

function displayValue(value: unknown): string {
  const text = typeof value === "string" && value !== "" ? value : JSON.stringify(value) ?? String(value);
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}… (${text.length - MAX_VALUE_CHARS} more characters)`
    : text;
}

/** A bounded preview; completeProposedContent retains the full input. */
export function proposedFields(
  params: Record<string, unknown>,
  presentation?: ToolApprovalPresentation | null,
): EnvelopeProposedField[] {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined,
  );
  const shown = entries.slice(0, MAX_FIELDS).map(([key, value]) =>
    formatPresentationParam(presentation, key, value, humanizeKey(key), displayValue(value)),
  );
  if (entries.length > MAX_FIELDS) {
    shown.push({ label: "More fields", value: `${entries.length - MAX_FIELDS} more not shown` });
  }
  return shown;
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Recognize only the exact captured request, not a tool's broader capabilities. */
export function duplicateBacklogRequest(toolName: string, params: Record<string, unknown>) {
  const merge = toolName === "merge_backlog_items";
  if (!merge && toolName !== "retire_backlog_item") return null;
  const allowed = merge
    ? ["canonicalItemId", "duplicateItemId", "rationale", "reconcileOnly"]
    : ["itemId", "duplicateOfId", "outcome", "rationale", "reason"];
  if (Object.keys(params).some(key => !allowed.includes(key))) return null;
  if (params.rationale !== undefined && typeof params.rationale !== "string") return null;
  if (merge ? params.reconcileOnly !== undefined && params.reconcileOnly !== false
    : params.outcome !== "duplicate" || !stringParam(params, "rationale")
      || (params.reason !== undefined && typeof params.reason !== "string")) return null;
  const duplicateId = stringParam(params, merge ? "duplicateItemId" : "itemId");
  const canonicalId = stringParam(params, merge ? "canonicalItemId" : "duplicateOfId");
  if (!duplicateId || !canonicalId || duplicateId === canonicalId) return null;
  return { kind: merge ? "merge" as const : "retire" as const, duplicateId, canonicalId };
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
    : "None declared. The consequences and reversibility of this action are not established.";
}

const SCOPE_TEXT =
  "Covers this one request only: this coworker, this exact content, before the window closes. "
  + "It does not cover later requests. It does not review the content or confirm that any test it cites is correct.";

type SummaryContext = {
  toolName: string;
  /** Empty recorded content remains inspectable without becoming a classified action. */
  hasEmptyOriginal?: boolean;
  params: Record<string, unknown> | null;
  consequence?: ToolConsequence | null;
  rationale?: string | null;
  targetLabel?: string;
  duplicateLabel?: string;
  approvalPresentation?: ToolApprovalPresentation;
};

function sharedFacts(input: SummaryContext) {
  const rawTarget = input.params
    ? envelopeTarget(input.toolName, input.params)
    : input.hasEmptyOriginal ? SOURCE_CATALOG.approvals.card.primary.notProvided : "Unknown: the proposal could not be loaded";
  const target = rawTarget === "Not named in the proposal" && input.approvalPresentation?.scopeLabel
    ? input.approvalPresentation.scopeLabel
    : rawTarget;
  return {
    action: actionLabel(input.toolName),
    target,
    proposed: input.params ? proposedFields(input.params, input.approvalPresentation) : [],
    completeProposedContent: input.params ? JSON.stringify(input.params, null, 2) : input.hasEmptyOriginal ? "{}" : null,
    consequence: input.approvalPresentation?.impact ?? consequenceText(input.consequence),
    whyAPerson: input.rationale?.trim() || "No reason was recorded for asking a person.",
    scope: SCOPE_TEXT,
    declaredConsequence: input.consequence ?? null,
    ...(input.approvalPresentation ? { approvalPresentation: input.approvalPresentation } : {}),
    ...(input.targetLabel ? { targetLabel: input.targetLabel } : {}),
    ...(input.duplicateLabel ? { duplicateLabel: input.duplicateLabel } : {}),
  };
}

function unknownSummary(input: SummaryContext): EnvelopeDecisionSummary {
  if (input.approvalPresentation) {
    const pres = input.approvalPresentation;
    return {
      kind: "exact",
      headline: pres.question,
      recommendation: pres.whyDefault ?? "your coworker asks to run this registered action",
      authorization: `${pres.question.replace(/\?$/, "")}`,
      recordedIfAuthorized: pres.what,
      authorizeDoes: pres.what,
      declineDoes: pres.declineDoes ?? "Nothing is changed. Your coworker stops.",
      ifYouDoNothing: "the window closes and nothing is changed.",
      findings: [],
      recommenderLabel: "Your coworker",
      authorizerLabel: "You",
      toolName: input.toolName,
      ...sharedFacts(input),
    };
  }
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
    headline: input.hasEmptyOriginal ? SOURCE_CATALOG.approvals.card.primary.unresolvedTitle : "Effect unresolved: this request cannot be shown",
    recommendation: input.hasEmptyOriginal ? SOURCE_CATALOG.approvals.card.primary.unresolvedRecommendation : "the proposed content could not be loaded",
    authorization: "decline unless you already know what this request writes",
    recordedIfAuthorized:
      input.hasEmptyOriginal ? SOURCE_CATALOG.approvals.card.primary.unresolvedDescription
        : "The proposed content could not be loaded, so this card cannot show what would be recorded.",
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

const ASSISTANT_NAMES: Record<string, { name: string; match: string }> = {
  "codex-desktop": { name: "Codex", match: "codex" },
  "claude-desktop": { name: "Claude", match: "claude" },
  "grok-desktop": { name: "Grok", match: "grok" },
};

/**
 * reassign_workroom_executor changes the room's executor, moves its lease to
 * the asking assistant, and admits that assistant to this one room as a
 * contributor (reassign-executor-handler.ts). Say exactly that, and nothing
 * the handler does not do.
 */
function handoverSummary(
  input: SummaryContext, params: Record<string, unknown>, recommenderAgentId: string,
): EnvelopeDecisionSummary | null {
  const room = stringParam(params, "capsuleId");
  const known = ASSISTANT_NAMES[stringParam(params, "toExecutorKind") ?? ""];
  // The handler admits the external assistant that asked, so plain words are
  // only true when the room goes to that same assistant. Anything else keeps
  // the exact-content card (the same name test as providerToExecutorKind).
  const agent = recommenderAgentId.trim().toLowerCase();
  if (!room || !known || !agent.startsWith("agt-ext-") || !agent.includes(known.match)) return null;
  const assistant = known.name;
  const manifest = objectRecord(params.handoffManifest);
  const nextStep = typeof manifest?.nextAction === "string" && manifest.nextAction.trim() ? manifest.nextAction.trim() : undefined;
  return {
    kind: "handover",
    headline: `Let ${assistant} take over Workroom ${room}?`,
    recommendation: `${assistant} asks to continue the work in Workroom ${room} for you`,
    authorization: `let ${assistant} continue the work in Workroom ${room} for you`,
    recordedIfAuthorized: `${assistant} becomes the assistant working in Workroom ${room}.`,
    authorizeDoes: `${assistant} takes over this room's work for you.`,
    declineDoes: `Nothing changes. ${assistant} cannot work in this room.`,
    ifYouDoNothing: "the window closes and nothing changes.",
    findings: [],
    recommenderLabel: "Your coworker",
    authorizerLabel: "You",
    toolName: input.toolName,
    handover: {
      changes: [
        `${assistant} can work in this one room as a contributor: read it, record evidence, and continue on its branch and worktree.`,
        `${assistant} becomes this room's assistant in place of the one that worked here before, and the room's lease is renewed under your account.`,
      ],
      keeps: [
        "The room's history, branch, worktree and evidence stay as they are.",
        `${assistant} gets no access to other rooms and no new permissions beyond this room.`,
      ],
      ...(nextStep ? { nextStep } : {}),
    },
    ...sharedFacts(input),
  };
}

/**
 * invite_room_participant with raiseClearanceTo admits a coworker to one room
 * AND raises its data access to that room's level (BI-6AE64074). Say both, and
 * that the raise reaches every room it is admitted to, not only this one.
 */
function admissionSummary(input: SummaryContext, params: Record<string, unknown>): EnvelopeDecisionSummary | null {
  const coworker = stringParam(params, "agentId");
  const level = stringParam(params, "raiseClearanceTo");
  if (!coworker || !level || stringParam(params, "userId")) return null;
  const room = input.targetLabel?.trim() || stringParam(params, "caseKey") || "this room";
  return {
    kind: "admission",
    headline: `Let ${coworker} into ${room} and let it read ${level} information?`,
    recommendation: `Your coworker asks to bring ${coworker} into ${room}`,
    authorization: `let ${coworker} join ${room} and read ${level} information`,
    recordedIfAuthorized: `${coworker} joins ${room}, and its data access becomes ${level}.`,
    authorizeDoes: `${coworker} joins this room and can read ${level} information.`,
    declineDoes: `Nothing changes. ${coworker} does not join and its data access stays as it is.`,
    ifYouDoNothing: "the window closes and nothing changes.",
    findings: [],
    recommenderLabel: "Your coworker",
    authorizerLabel: "You",
    toolName: input.toolName,
    admission: {
      changes: [
        `${coworker} joins ${room} as a contributor and can read and post there.`,
        `${coworker}'s data access rises to ${level}: it can read ${level} information in any room it is admitted to.`,
      ],
      keeps: [
        `${coworker} gets no access to rooms it has not been invited to.`,
        "Its tools and permissions stay the same.",
        "You can lower it again under Coworker data access.",
      ],
    },
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
  consequence?: ToolConsequence | null;
  /** The governing reason stored on the envelope. */
  rationale?: string | null;
  targetLabel?: string;
  duplicateLabel?: string;
  /** Co-located registry presentation metadata, validated fail-closed against params & consequence. */
  approvalPresentation?: ToolApprovalPresentation | null;
}): EnvelopeDecisionSummary {
  const fromExecution = originalToolParameters(input.proposedParameters);
  const fromEnvelope = originalToolParameters(input.argsJson);
  // An explicitly empty request is still original content. Prefer available
  // substantive content first; audit-only execution metadata is not a proposal.
  const rawEnvelope = objectRecord(input.argsJson);
  const rawExecution = objectRecord(input.proposedParameters);
  const emptyOriginal = [rawEnvelope, rawExecution].find(record => record && Object.keys(record).length === 0);
  const resolvedParams = fromExecution ?? fromEnvelope;
  const params = resolvedParams ?? {};
  const verifiedPresentation =
    input.approvalPresentation
    && isApprovalPresentationCompatibleWithConsequence(input.approvalPresentation, input.consequence)
    && matchesApprovalPresentationParams(input.approvalPresentation, resolvedParams, !!emptyOriginal)
      ? input.approvalPresentation
      : undefined;
  const context: SummaryContext = {
    toolName: input.toolName.trim(),
    params: resolvedParams,
    hasEmptyOriginal: !!emptyOriginal,
    consequence: input.consequence ?? null,
    rationale: input.rationale ?? null,
    targetLabel: input.targetLabel,
    duplicateLabel: input.duplicateLabel,
    ...(verifiedPresentation ? { approvalPresentation: verifiedPresentation } : {}),
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

  if (toolName === "reassign_workroom_executor" && resolvedParams) {
    const handover = handoverSummary(context, resolvedParams, input.recommenderAgentId);
    if (handover) return handover;
  }
  if (toolName === "invite_room_participant" && resolvedParams) {
    const admission = admissionSummary(context, resolvedParams);
    if (admission) return admission;
  }
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

const INTERNAL_REF_RE = /\b(?:BI|WC|AGT|TR|NPEL|EP|DI|FB|PIR)-[A-Z0-9-]+\b/i;
const RAW_SNAKE_ID_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
const GENERIC_RATIONALE_RE = /^No reason was recorded for asking a person\.?$|^This action is authorized to proceed only after employee approval\.?$/i;

/**
 * Surface a recorded gate/coworker rationale on the primary card only when it
 * is concise owner-safe prose free of internal IDs and raw tool names.
 */
function cleanOwnerWhy(raw: string | undefined, toolName: string): string {
  const text = (raw ?? "").trim();
  if (!text || text.length > 160) return "";
  if (GENERIC_RATIONALE_RE.test(text)) return "";
  if (INTERNAL_REF_RE.test(text)) return "";
  if (toolName && text.includes(toolName)) return "";
  if (RAW_SNAKE_ID_RE.test(text)) return "";
  return text;
}

function consequencePosture(decision: EnvelopeDecisionSummary, fallback: ApprovalPosture): ApprovalPosture {
  if (decision.declaredConsequence === "irreversible" || decision.consequence.includes("Cannot be undone")) {
    return "irreversible";
  }
  if (decision.declaredConsequence === "outward" || decision.consequence.includes("Reaches outside")) {
    return "outward";
  }
  if (decision.declaredConsequence === "authority" || decision.consequence.includes("Changes who may do what")) {
    return "authority";
  }
  return fallback;
}

/** Human presentation only. The original proposal remains the execution binding. */
export function envelopePrimaryDecision(decision: EnvelopeDecisionSummary, locale: string = DEFAULT_LOCALE) {
  let params: Record<string, unknown> = {};
  let hasOriginal = false;
  try {
    const original = objectRecord(JSON.parse(decision.completeProposedContent ?? "null"));
    hasOriginal = original !== null;
    params = original ?? {};
  } catch { /* Older unresolved projection. */ }
  const copy = SOURCE_CATALOG.approvals.card.primary;
  const recordedWhy = cleanOwnerWhy(decision.whyAPerson, decision.toolName);
  const recordsResult = decision.kind !== "unknown"
    && ["record_workroom_evidence", "record_execution_evidence"].includes(decision.toolName)
    && !!stringParam(params, "summary");
  const handover = decision.kind === "handover" ? ASSISTANT_NAMES[stringParam(params, "toExecutorKind") ?? ""] : undefined;
  const research = decision.kind === "known" && decision.gate === "research";
  const admission = decision.kind === "admission";
  const unresolved = !recordsResult && !handover && !research && !admission;
  // A registered operation can be named without establishing its effects.
  // Only a standard self-update request establishes the app as its target.
  const exact = (decision.kind === "exact" || decision.kind === "unknown") && hasOriginal;

  // Registry-driven declarative presentation (BI-CF03AA73): strictly matched
  // against allowedParams and consequence compatibility in summarizeCoworkerEnvelopeDecision.
  if (decision.approvalPresentation && hasOriginal && unresolved) {
    const pres = decision.approvalPresentation;
    return {
      title: pres.question,
      description: pres.what,
      why: pres.whyDefault ?? recordedWhy,
      consequence: pres.impact,
      posture: consequencePosture(decision, pres.reversibility),
      facts: [] as EnvelopeProposedField[],
      unresolved: false,
      target: decision.targetLabel ?? pres.scopeLabel ?? "",
      recommendation: "",
      declineDoes: pres.declineDoes ?? "",
    };
  }

  // Only the captured account toggle has these effects. Other provider actions
  // include credential and quota operations and must keep their own disclosure.
  if (exact && decision.consequence.startsWith("None declared.") && decision.toolName === "manage_provider_account"
    && (params.operation === "disable" || params.operation === "enable")
    && Object.keys(params).every(key => ["operation", "connectionId"].includes(key))
    && typeof params.connectionId === "string" && params.connectionId.trim()) {
    const account = params.connectionId === "provider-default-local" ? "Docker Model Runner"
      : params.connectionId === "provider-default-ollama" ? "Ollama" : params.connectionId;
    const disable = params.operation === "disable";
    return {
      title: formatSource(locale, disable ? copy.providerDisableTitle : copy.providerEnableTitle, { account }),
      description: formatSource(locale, disable ? copy.providerDisableDescription : copy.providerEnableDescription, { account }),
      why: recordedWhy,
      consequence: disable ? copy.providerEnableAgain : copy.providerDisableAgain,
      posture: "reversible" as ApprovalPosture,
      facts: [], unresolved: false, target: "", recommendation: "", declineDoes: "",
    };
  }
  const appUpdate = exact && decision.toolName === "request_self_upgrade"
    && Object.keys(params).every(key => key === "reason")
    && (params.reason === undefined || typeof params.reason === "string");
  const duplicateWork = exact ? duplicateBacklogRequest(decision.toolName, params) : null;
  if (duplicateWork) {
    const merge = duplicateWork.kind === "merge";
    const args = {
      duplicate: decision.duplicateLabel ?? duplicateWork.duplicateId,
      canonical: decision.targetLabel ?? duplicateWork.canonicalId,
    };
    return {
      title: merge ? copy.mergeWorkTitle : copy.retireDuplicateTitle,
      description: formatSource(locale, merge ? copy.mergeWorkDescription : copy.retireDuplicateDescription, args),
      why: "",
      consequence: merge ? copy.mergeWorkConsequence : copy.retireDuplicateConsequence,
      posture: consequencePosture(decision, merge ? "irreversible" : "bounded"),
      recommendation: copy.duplicateWorkRecommendation,
      facts: [], unresolved: false, target: "", declineDoes: "",
    };
  }
  const releaseReservation = exact && decision.toolName === "release_nonprod_environment_lease"
    && !!stringParam(params, "leaseId");
  // Name the requested operation without inferring its effects from unknown arguments.
  const mergeSource = stringParam(params, "duplicateItemId");
  const mergeTarget = stringParam(params, "canonicalItemId");
  const namesUnresolvedMerge = exact && decision.toolName === "merge_backlog_items"
    && mergeSource && mergeTarget && mergeSource !== mergeTarget
    && (params.reconcileOnly === undefined || params.reconcileOnly === false);
  let title = namesUnresolvedMerge ? copy.mergeWorkTitle : copy.unresolvedTitle;
  let description = copy.unresolvedDescription;
  let consequence = decision.consequence.startsWith("None declared.") ? copy.effectUnknown : decision.consequence;
  let recommendation = copy.unresolvedRecommendation;
  let posture: ApprovalPosture = consequencePosture(decision, "unverified");
  if (handover) {
    const args = { assistant: handover.name };
    title = formatSource(locale, copy.handoverTitle, args);
    description = formatSource(locale, copy.handoverDescription, args);
    consequence = copy.handoverConsequence;
    recommendation = formatSource(locale, copy.handoverRecommendation, args);
    posture = consequencePosture(decision, "authority");
  } else if (admission) {
    const args = { coworker: stringParam(params, "agentId") ?? "", level: stringParam(params, "raiseClearanceTo") ?? "" };
    title = formatSource(locale, copy.admissionTitle, args);
    description = formatSource(locale, copy.admissionDescription, args);
    consequence = copy.admissionConsequence;
    recommendation = formatSource(locale, copy.admissionRecommendation, args);
    posture = consequencePosture(decision, "authority");
  } else if (recordsResult) {
    title = copy.recordTitle;
    description = params.outcome === "blocked" ? copy.blockedDescription : copy.recordDescription;
    consequence = params.stageKey && params.outcome === "completed" ? copy.stageConsequence : copy.recordConsequence;
    recommendation = copy.recordRecommendation;
    posture = consequencePosture(decision, "bounded");
  } else if (research) {
    title = copy.reviewTitle;
    description = `${decision.authorization.charAt(0).toUpperCase()}${decision.authorization.slice(1)}.`;
    consequence = copy.reviewConsequence;
    recommendation = decision.recommendation;
    posture = consequencePosture(decision, "bounded");
  } else if (appUpdate) {
    title = copy.appUpdateTitle;
    description = copy.appUpdateDescription;
  } else if (releaseReservation) {
    title = copy.releaseReservationTitle;
  }
  if (!unresolved && !decision.consequence.startsWith("None declared.")) {
    consequence = `${consequence} ${decision.consequence}`;
  }
  const facts: EnvelopeProposedField[] = [];
  // Unknown effects stay unresolved. These recorded facts must not disappear
  // with technical detail, even when they are long, nested, false or missing.
  const materialKey = /amount|currency|recipient|destination|payee|beneficiary|payment|recurr|frequency|permission|grant|canAct|role|access|delet|destroy|irrevers|deadline|expir|scope|sensitivity|endpoint|^url$|^(?:to|cc|bcc)$/i;
  const intentKey = /^(?:coworker|agent(?:Id)?|user(?:Id)?|target(?:Id)?|subject(?:Id)?|account(?:Id)?|resource(?:Id)?|room(?:Id)?|action|operation|path|file(?:Path)?|name)$/i;
  function visit(value: unknown, path: string[], material: boolean) {
    const empty = Array.isArray(value) ? value.length === 0 : objectRecord(value) ? Object.keys(value as object).length === 0 : false;
    if (empty && material) {
      facts.push({ label: materialFactLabel(path), value: copy.notProvided });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, String(index + 1)], material));
    } else if (objectRecord(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      const consequential = material || entries.some(([key]) => materialKey.test(key))
        || (path.length === 0 && !decision.consequence.startsWith("None declared."));
      for (const [key, child] of entries) {
        visit(child, [...path, key], material || materialKey.test(key) || (consequential && intentKey.test(key)));
      }
    } else if (material) {
      facts.push({ label: materialFactLabel(path), value: value === null || value === "" ? copy.notProvided : String(value) });
    }
  }
  if (unresolved) visit(params, [], false);
  return { title, description, why: unresolved || recommendation ? "" : recordedWhy, consequence, posture, facts, unresolved,
    target: appUpdate ? copy.appScope : decision.toolName === "manage_coworker_tool_grant" ? copy.permissionScope : decision.targetLabel ?? "",
    recommendation, declineDoes: "",
  };
}
