import type { ChatMessage } from "@/lib/inference/ai-inference";
import type { DataEffect, DestinationClass } from "@/lib/govern/data/taxonomy";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";

export type InferenceDataClass =
  | "customer-records"
  | "employee-records"
  | "payments-finance"
  | "health-phi"
  | "student-records"
  | "legal-privileged"
  | "security-logs"
  | "criminal-justice"
  | "safety-sensitive"
  | "youth-sensitive"
  | "public-sector-records"
  | "regulated-decisioning"
  | "source-code"
  | "secrets-credentials"
  | "unknown-governed-data";

export type InferencePayloadSensitivity =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export type InferencePayloadMatch = {
  dataClass: InferenceDataClass;
  path: string;
  reason: string;
  confidence: "deterministic" | "inferred" | "governed";
  /** Where the matched message came from. Absent for non-message probes. */
  origin?: MessageOrigin;
};

/**
 * What a message in the payload IS, as a label — never its content.
 *
 * A receipt can already say a match landed at `messages[0].content`, which is
 * useless for deciding what to do about it: index 0 may be a real user turn, or
 * a platform-generated block the coworker path prepended. Those imply opposite
 * fixes, and `rawPayloadStored` is false by design, so the payload cannot be
 * read back to tell them apart (BI-40EF7C44).
 *
 * A label is safe to persist where the content is not. `turn` is the default:
 * anything the caller does not label is treated as a real turn, so an unlabelled
 * path reads exactly as it did before this existed.
 */
export type MessageOrigin =
  | "turn"
  | "thread-checkpoint"
  | "user-briefing";

export type InferencePayloadReceipt = {
  screenId: string;
  inputHash: string;
  detectedClasses: InferenceDataClass[];
  matchCount: number;
  transformation: "none" | "masked" | "tokenized" | "blocked";
  rawPayloadStored: false;
};

export type InferenceDataScreenRouteContext = Pick<
  RequestContract,
  "sensitivity" | "allowedProviders" | "deniedProviders" | "residencyPolicy"
>;

export type InferencePolicyDecisionVersion = {
  decisionId: string;
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
};

export type InferencePolicyVersionSnapshot = {
  assetVersion: string;
  classificationVersion: string;
  authorityVersion: string;
  policyBundleVersion: string;
};

export type InferenceDataScreenReceipt = {
  schemaVersion: "inference-data-screen/v1";
  screenId: string;
  decisionIds: string[];
  /** Safe TOCTOU evidence for each governed PDP decision; never contains payload values. */
  decisionVersions: InferencePolicyDecisionVersion[];
  inputHash: string;
  classifiedDataClasses: InferenceDataClass[];
  policyEffect: DataEffect;
  routeEffect: "allow" | "local-only" | "block";
  destinationClass: DestinationClass;
  transformation: InferencePayloadReceipt["transformation"];
  explanationCodes: string[];
  obligationKinds: string[];
  /** Present for policy-pack-aware screens; absent on pre-pack v1 receipts. */
  policyPackVersions?: string[];
  /**
   * WHY each data class was detected: the probe path, the rule that fired, and
   * its confidence — never the matched value. Without this a receipt records
   * that a payload classified as, say, customer-records but not what tripped it,
   * so a local-only routing decision cannot be diagnosed without re-deriving the
   * payload by hand. Deliberately excludes matched text so `rawPayloadStored`
   * stays false: a path plus a rule name is enough to locate the source, and the
   * value itself is exactly what must not be persisted.
   */
  matchProvenance?: InferenceMatchProvenance[];
  /**
   * What the PAYLOAD measured, before the route's declared label was applied as
   * a floor. Absent on pre-drift v1 receipts.
   */
  measuredSensitivity?: InferencePayloadSensitivity;
  /**
   * Payload index where the exchange under way begins — the last user-role
   * message. Lets a consumer separate "your current question is governed" from
   * "something earlier in this thread is", which imply different remedies
   * (BI-706530B2). An index, never content. Absent on receipts written before
   * this existed, and -1 when the payload carried no user message.
   */
  currentTurnStartIndex?: number;
  /**
   * What the ROUTE declared, independent of the payload — the static
   * `sensitivity` on its route-context entry. Absent when the caller supplied
   * no route context.
   */
  declaredSensitivity?: InferencePayloadSensitivity;
  /**
   * True when the declaration RAISED this turn above what the payload measured,
   * i.e. the routing sensitivity came from the label rather than from the data.
   *
   * Without this the two are indistinguishable in the record, and an over-broad
   * route label reads exactly like a genuine payload finding — while silently
   * collapsing that route's endpoint pool and surfacing to the user as a
   * provider outage.
   */
  sensitivityFloorApplied?: boolean;
  rawPayloadStored: false;
};

/** Provenance for one classifier match. Carries no payload values. */
export type InferenceMatchProvenance = {
  dataClass: InferenceDataClass;
  /** Probe path, e.g. "systemPrompt" or "messages[3].content". Never the value. */
  path: string;
  /** The rule that fired, e.g. "contact-detail" or "employee-record-text". */
  reason: string;
  confidence: InferencePayloadMatch["confidence"];
  /** What the matched message was, when the match came from one. A label, never a value. */
  origin?: MessageOrigin;
};

export type InferenceDataScreenResult = {
  routeContext: InferenceDataScreenRouteContext;
  receipt: InferenceDataScreenReceipt;
  /** Ephemeral classifier evidence used only by the enforcing transform seam. */
  classification: InferencePayloadClassification;
  /** Ephemeral PDP decisions; persisted evidence remains the bounded receipt. */
  decisions: DataPolicyDecision[];
};

export type GovernedPayloadHint = {
  assetId?: string;
  fieldIds?: string[];
  classificationKnown: boolean;
  sensitivity?: InferencePayloadSensitivity;
  dataClasses?: InferenceDataClass[];
  purpose?: string;
};

export type InferencePayloadClassificationInput = {
  messages: ChatMessage[];
  systemPrompt: string;
  /**
   * Exact text spans of the system prompt that are platform-authored
   * INSTRUCTION rather than the turn's data (BI-463BE12A / BI-9C14CB5D).
   *
   * Supplied by whoever knows the provenance — the prompt assembler for its own
   * static blocks, the calling surface for the coworker persona. Everything not
   * named here is classified as data, so an assembly path that supplies nothing
   * behaves exactly as it did before this existed, and text appended after
   * assembly is data by default. Fail-closed by construction.
   */
  systemPromptInstructionSpans?: string[];
  /**
   * What each entry of `messages` is, positionally (BI-40EF7C44).
   *
   * Labels only — this never carries content and never changes classification.
   * It exists so a receipt can say WHICH message a match came from when the
   * payload itself cannot be stored. Short or absent arrays are fine: any index
   * without a label is `turn`.
   */
  messageOrigins?: readonly MessageOrigin[];
  tools?: Array<Record<string, unknown>>;
  taskType?: string;
  governedData?: GovernedPayloadHint[];
};

export type InferencePayloadClassification = {
  overallSensitivity: InferencePayloadSensitivity;
  dataClasses: InferenceDataClass[];
  /**
   * The subset of `dataClasses` evidenced somewhere OTHER than platform-authored
   * instruction — the turn's messages, tool-call arguments, tool results, or an
   * explicit governed hint (BI-463BE12A).
   *
   * `dataClasses` stays complete so the receipt reports everything detected and
   * the classification remains auditable. The PDP evaluates THIS set, because an
   * export decision should turn on what is being sent, not on a job description
   * that happens to name the domain.
   */
  dataEvidencedClasses: InferenceDataClass[];
  matches: InferencePayloadMatch[];
  receipt: InferencePayloadReceipt;
};
