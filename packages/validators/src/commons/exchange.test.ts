import { describe, expect, it } from "vitest";
import { assessCommonsEgress, assessCommonsReceipt, type CommonsCandidate, type CommonsCurrentFacts, type CommonsReview } from "./exchange.js";
const hash = `sha256:${"a".repeat(64)}`;
const candidate: CommonsCandidate = { schemaVersion: "commons-candidate/0.1", id: "candidate-1", revision: "r1", scope: "wwmd", sourceRefs: [{ kind: "workroom", id: "private-workroom", version: "definition-4" }], accountablePrincipalId: "human-owner", requesterPrincipalId: "requester", authorPrincipalId: "author", payloadHash: hash, destination: { id: "approved-hive", version: "v2" } };
const review: CommonsReview = { schemaVersion: "commons-review/0.1", id: "human-review", candidateId: candidate.id, candidateRevision: "r1", scope: "wwmd", payloadHash: hash, destination: candidate.destination, reviewerPrincipalId: "independent-human", decision: "approved", policyGeneration: "p1", expiresAt: 2000 };
const facts: CommonsCurrentFacts = { now: 1000, revision: "r1", payloadHash: hash, destination: candidate.destination, policyGeneration: "p1", authority: "allowed", review: "current", classification: "shareable", cancelled: false, effect: "not-started" };
describe("exact-content Commons egress intent", () => {
  it("binds independent review to the exact payload, destination, version and scope without exporting source refs", () => {
    expect(assessCommonsEgress(candidate, review, facts)).toEqual({ kind: "prepare-egress", candidateId: candidate.id, revision: "r1", payloadHash: hash, destination: candidate.destination, scope: "wwmd", reviewId: review.id });
  });
  it.each([
    ["revoked authority", { authority: "revoked" }], ["missing authority", { authority: "unknown" }],
    ["cancelled", { cancelled: true }], ["expired", { now: 2000 }], ["revoked review", { review: "revoked" }],
    ["new revision", { revision: "r2" }], ["changed bytes", { payloadHash: `sha256:${"b".repeat(64)}` }],
    ["changed target", { destination: { id: "other", version: "v2" } }], ["changed target version", { destination: { id: "approved-hive", version: "v3" } }],
    ["new policy", { policyGeneration: "p2" }], ["private", { classification: "private" }], ["mixed", { classification: "mixed" }],
    ["unknown privacy", { classification: "unknown" }], ["reserved", { effect: "reserved" }], ["lost acknowledgement", { effect: "uncertain" }], ["already delivered", { effect: "delivered" }],
  ])("holds %s", (_label, change) => expect(assessCommonsEgress(candidate, review, { ...facts, ...change } as CommonsCurrentFacts).kind).toBe("hold"));
  it("requires an actual independent human review with matching scope, payload and reference", () => {
    for (const r of [null, { ...review, reviewerPrincipalId: candidate.authorPrincipalId }, { ...review, reviewerPrincipalId: candidate.requesterPrincipalId }, { ...review, decision: "rejected" as const }, { ...review, scope: "wwwd" as const }, { ...review, candidateId: "another" }, { ...review, payloadHash: `sha256:${"c".repeat(64)}` }]) {
      expect(assessCommonsEgress(candidate, r, facts).kind).toBe("hold");
    }
  });
  it("holds malformed or oversized runtime input without invoking accessors", () => {
    let reads = 0; const bad = { ...candidate, get payloadHash() { reads++; return hash; } };
    for (const c of [bad, { ...candidate, scope: "unknown" }, { ...candidate, sourceRefs: [] }, { ...candidate, id: "x".repeat(513) }]) expect(assessCommonsEgress(c as CommonsCandidate, review, facts).kind).toBe("hold");
    expect(reads).toBe(0);
  });
});
describe("Commons receipt classification", () => {
  const reserved = { bindingDigest: hash, status: "reserved" as const, remoteRef: null };
  const delivered = { ...reserved, status: "delivered" as const, remoteRef: "remote-42" };
  it("records transport receipt, idempotent duplicates, then independently accepted result", () => {
    expect(assessCommonsReceipt(reserved, delivered)).toEqual({ kind: "record", observation: delivered });
    expect(assessCommonsReceipt(delivered, delivered)).toEqual({ kind: "noop" });
    const accepted = { ...delivered, status: "accepted" as const };
    expect(assessCommonsReceipt(delivered, accepted)).toEqual({ kind: "record", observation: accepted });
  });
  it("holds conflicting, unbound, premature acceptance or cancellation after delivery", () => {
    for (const [current, receipt] of [[delivered, { ...delivered, remoteRef: "remote-other" }], [reserved, { ...delivered, bindingDigest: `sha256:${"b".repeat(64)}` }], [reserved, { ...delivered, status: "accepted" as const }], [delivered, { ...delivered, status: "cancelled" as const }]]) expect(assessCommonsReceipt(current, receipt).kind).toBe("hold");
  });
  it("records uncertain effects without authorizing a new send", () => {
    const uncertain = { ...reserved, status: "uncertain" as const };
    expect(assessCommonsReceipt(reserved, uncertain)).toEqual({ kind: "record", observation: uncertain });
    expect(assessCommonsReceipt(uncertain, reserved).kind).toBe("hold");
    expect(assessCommonsReceipt(uncertain, delivered)).toEqual({ kind: "record", observation: delivered });
  });
});
