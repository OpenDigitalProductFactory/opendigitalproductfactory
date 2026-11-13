import type { DecisionScope } from "../decision-scopes.ts";
import { DECISION_SCOPES } from "../decision-scopes.ts";
import { isBoundedTrustedJson } from "../bounded-trusted-json.ts";

/** References remain private host material. The projected result is the only outbound payload. */
export interface CommonsCandidate {
  schemaVersion: "commons-candidate/0.1";
  id: string;
  revision: string;
  scope: DecisionScope;
  sourceRefs: Array<{ kind: "workroom" | "finding" | "result"; id: string; version: string }>;
  accountablePrincipalId: string;
  requesterPrincipalId: string;
  authorPrincipalId: string;
  payloadHash: string;
  destination: { id: string; version: string };
}
/** Only a trusted review adapter may supply this receipt; inbound bundle.review is not one. */
export interface CommonsReview {
  schemaVersion: "commons-review/0.1";
  id: string;
  candidateId: string;
  candidateRevision: string;
  scope: DecisionScope;
  payloadHash: string;
  destination: { id: string; version: string };
  reviewerPrincipalId: string;
  decision: "approved" | "rejected";
  policyGeneration: string;
  expiresAt: number;
}
export interface CommonsCurrentFacts {
  now: number;
  revision: string;
  payloadHash: string;
  destination: { id: string; version: string };
  policyGeneration: string;
  authority: "allowed" | "denied" | "revoked" | "unknown";
  review: "current" | "revoked" | "missing";
  classification: "shareable" | "private" | "mixed" | "unknown";
  cancelled: boolean;
  effect: "not-started" | "reserved" | "uncertain" | "delivered";
}
export type CommonsEgressAssessment =
  | { kind: "hold"; reasons: string[] }
  | { kind: "prepare-egress"; candidateId: string; revision: string; payloadHash: string; destination: { id: string; version: string }; scope: DecisionScope; reviewId: string };

/** Returns a proposal to the existing trusted command owner, never an execution grant. */
export function assessCommonsEgress(candidate: CommonsCandidate, review: CommonsReview | null, facts: CommonsCurrentFacts): CommonsEgressAssessment {
  if (!isBoundedTrustedJson([candidate, review, facts]) || !validCandidate(candidate) || !validFacts(facts) || (review !== null && !validReview(review))) return { kind: "hold", reasons: ["input:invalid"] };
  if (!review) return { kind: "hold", reasons: ["review:missing"] };
  const reasons: string[] = [];
  if (review.decision !== "approved" || facts.review !== "current") reasons.push("review:not-current-approved");
  if (review.reviewerPrincipalId === candidate.authorPrincipalId || review.reviewerPrincipalId === candidate.requesterPrincipalId) reasons.push("review:not-independent");
  if (review.candidateId !== candidate.id || review.candidateRevision !== candidate.revision || facts.revision !== candidate.revision) reasons.push("candidate:stale");
  if (review.scope !== candidate.scope) reasons.push("scope:mismatch");
  if (review.payloadHash !== candidate.payloadHash || facts.payloadHash !== candidate.payloadHash) reasons.push("payload:changed");
  if (!sameDestination(candidate.destination, review.destination) || !sameDestination(candidate.destination, facts.destination)) reasons.push("destination:changed");
  if (review.policyGeneration !== facts.policyGeneration) reasons.push("policy:stale");
  if (review.expiresAt <= facts.now) reasons.push("review:expired");
  if (facts.authority !== "allowed") reasons.push("authority:not-current");
  if (facts.classification !== "shareable") reasons.push("classification:not-shareable");
  if (facts.cancelled) reasons.push("candidate:cancelled");
  if (facts.effect !== "not-started") reasons.push(`effect:${facts.effect}`);
  if (reasons.length) return { kind: "hold", reasons };
  return { kind: "prepare-egress", candidateId: candidate.id, revision: candidate.revision, payloadHash: candidate.payloadHash, destination: { ...candidate.destination }, scope: candidate.scope, reviewId: review.id };
}

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;
const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: object, keys: string[]) => Object.keys(v).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(v, k));
const scope = (v: unknown): v is DecisionScope => DECISION_SCOPES.some(s => s === v);
const digest = (v: unknown): v is string => typeof v === "string" && hashPattern.test(v);
function destination(v: unknown): v is { id: string; version: string } { return row(v) && only(v, ["id", "version"]) && text(v.id) && text(v.version); }
function sameDestination(a: { id: string; version: string }, b: { id: string; version: string }) { return a.id === b.id && a.version === b.version; }
function validCandidate(v: unknown): v is CommonsCandidate {
  return row(v) && only(v, ["schemaVersion", "id", "revision", "scope", "sourceRefs", "accountablePrincipalId", "requesterPrincipalId", "authorPrincipalId", "payloadHash", "destination"]) && v.schemaVersion === "commons-candidate/0.1" && text(v.id) && text(v.revision) && scope(v.scope) && text(v.accountablePrincipalId) && text(v.requesterPrincipalId) && text(v.authorPrincipalId) && digest(v.payloadHash) && destination(v.destination) && Array.isArray(v.sourceRefs) && v.sourceRefs.length > 0 && v.sourceRefs.length <= 128 && v.sourceRefs.every(ref => row(ref) && only(ref, ["kind", "id", "version"]) && ["workroom", "finding", "result"].includes(String(ref.kind)) && text(ref.id) && text(ref.version));
}
function validReview(v: unknown): v is CommonsReview {
  return row(v) && only(v, ["schemaVersion", "id", "candidateId", "candidateRevision", "scope", "payloadHash", "destination", "reviewerPrincipalId", "decision", "policyGeneration", "expiresAt"]) && v.schemaVersion === "commons-review/0.1" && text(v.id) && text(v.candidateId) && text(v.candidateRevision) && scope(v.scope) && digest(v.payloadHash) && destination(v.destination) && text(v.reviewerPrincipalId) && ["approved", "rejected"].includes(String(v.decision)) && text(v.policyGeneration) && Number.isSafeInteger(v.expiresAt) && (v.expiresAt as number) >= 0;
}
function validFacts(v: unknown): v is CommonsCurrentFacts {
  return row(v) && only(v, ["now", "revision", "payloadHash", "destination", "policyGeneration", "authority", "review", "classification", "cancelled", "effect"]) && Number.isSafeInteger(v.now) && (v.now as number) >= 0 && text(v.revision) && digest(v.payloadHash) && destination(v.destination) && text(v.policyGeneration) && ["allowed", "denied", "revoked", "unknown"].includes(String(v.authority)) && ["current", "revoked", "missing"].includes(String(v.review)) && ["shareable", "private", "mixed", "unknown"].includes(String(v.classification)) && typeof v.cancelled === "boolean" && ["not-started", "reserved", "uncertain", "delivered"].includes(String(v.effect));
}

export interface CommonsDeliveryObservation {
  bindingDigest: string;
  status: "reserved" | "uncertain" | "delivered" | "accepted" | "cancelled";
  remoteRef: string | null;
}
export type CommonsReceiptAssessment =
  | { kind: "hold"; reason: string }
  | { kind: "noop" }
  | { kind: "record"; observation: CommonsDeliveryObservation };

/** A host must compare-and-swap its current ledger revision when recording the returned fact. */
export function assessCommonsReceipt(current: CommonsDeliveryObservation, receipt: CommonsDeliveryObservation): CommonsReceiptAssessment {
  if (!isBoundedTrustedJson([current, receipt]) || !validObservation(current) || !validObservation(receipt)) return { kind: "hold", reason: "receipt:invalid" };
  if (current.bindingDigest !== receipt.bindingDigest) return { kind: "hold", reason: "binding:mismatch" };
  if (current.status === receipt.status && current.remoteRef === receipt.remoteRef) return { kind: "noop" };
  if (current.remoteRef !== null && current.remoteRef !== receipt.remoteRef) return { kind: "hold", reason: "receipt:conflict" };
  const permitted = ((current.status === "reserved" || current.status === "uncertain") && (receipt.status === "delivered" || receipt.status === "uncertain")) || (current.status === "delivered" && receipt.status === "accepted");
  return permitted ? { kind: "record", observation: { ...receipt } } : { kind: "hold", reason: "receipt:out-of-order" };
}
function validObservation(v: unknown): v is CommonsDeliveryObservation {
  return row(v) && only(v, ["bindingDigest", "status", "remoteRef"]) && digest(v.bindingDigest) && ["reserved", "uncertain", "delivered", "accepted", "cancelled"].includes(String(v.status)) && (["delivered", "accepted"].includes(String(v.status)) ? text(v.remoteRef) : v.remoteRef === null);
}
