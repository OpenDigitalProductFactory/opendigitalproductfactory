import { normalizeHiveResultIntakeWithDigest, projectHiveResultBundle, planFindingContribution, readEscalationOutcome, assessCommonsEgress, assessCommonsReceipt, planHiveDeliveryAttempt, type CommonsCandidate, type CommonsCurrentFacts, type CommonsReview } from "../kernel/commons/index.js";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function runSmoke(digestHex: (bytes: string) => string) {
  const groups: string[] = [];
  const bundle = { schemaVersion: "dpf.hive-result/1", result: { "2": "two", "10": "ten", label: "café" }, sourceReceipt: "opaque_fixture_42" };
  const normalized = normalizeHiveResultIntakeWithDigest(bundle, digestHex);
  check(normalized.ok, "intake rejected normal result");
  check(normalized.payloadHash === "sha256:eea7a002125395f2830b099bb2295f10ffbce9f008648cb42f1bb3cd0b6474d7", "issued UTF-8/numeric-key bytes changed");
  groups.push("legacy serialization and digest parity");
  const unsafe = { ...bundle, result: { customerId: "private", patch: "synthetic" } };
  check(!normalizeHiveResultIntakeWithDigest(unsafe, digestHex).ok, "private key escaped intake");
  const cycle: Record<string, unknown> = { ...bundle }; cycle.result = cycle;
  let getterReads = 0;
  check(!normalizeHiveResultIntakeWithDigest(cycle, digestHex).ok, "cycle accepted");
  check(!normalizeHiveResultIntakeWithDigest({ ...bundle, get result() { getterReads++; return {}; } }, digestHex).ok && getterReads === 0, "getter invoked");
  check(!normalizeHiveResultIntakeWithDigest({ ...bundle, result: { patch: "x".repeat(50 * 1024) } }, digestHex).ok, "oversized result accepted");
  const proto = projectHiveResultBundle(JSON.parse('{"schemaVersion":"dpf.hive-result/1","result":{"__proto__":{"safe":"synthetic"}},"sourceReceipt":"opaque_fixture_42"}'));
  check(!Object.hasOwn(proto.projected.result as object, "__proto__") && Object.getPrototypeOf(proto.projected.result) === Object.prototype, "legacy prototype-key bytes changed or prototype mutated");
  const legacyProto = normalizeHiveResultIntakeWithDigest(JSON.parse('{"schemaVersion":"dpf.hive-result/1","result":{"patch":"synthetic","__proto__":{"old":"ignored"}},"sourceReceipt":"proto_receipt_42"}'), digestHex);
  check(legacyProto.ok && legacyProto.payloadHash === "sha256:6b3450e8945d5429fdc693ed1345af80e5556b65035f92e5df37cfead279f421", "issued prototype-key payload hash changed");
  for (const malformed of [null, [], 3, "invalid"]) check(projectHiveResultBundle(malformed).violations[0] === "payload:invalid", "direct malformed projection escaped hold");
  groups.push("bounded hostile intake and safe projection");
  const proposal = { proposalId: "IP-synthetic", title: "Synthetic finding", backlogItemId: "BI-local-only", contributionStatus: "local" };
  check(planFindingContribution(proposal, proposal.proposalId).eligible, "existing finding join changed");
  check(!readEscalationOutcome({ status: "failed", error: "synthetic outage" }, proposal).contributed, "fault became contribution");
  check(!planFindingContribution({ ...proposal, contributionStatus: "contributed" }, proposal.proposalId).eligible, "duplicate finding eligible");
  groups.push("real finding plan and refused/failed/duplicate distinctions");
  const candidate: CommonsCandidate = { schemaVersion: "commons-candidate/0.1", id: "private-candidate", revision: "r1", scope: "wwmd", sourceRefs: [{ kind: "workroom", id: "private-workroom", version: "definition-4" }], accountablePrincipalId: "accountable-human", requesterPrincipalId: "requester", authorPrincipalId: "author", payloadHash: normalized.payloadHash, destination: { id: "synthetic-hive", version: "v1" } };
  const review: CommonsReview = { schemaVersion: "commons-review/0.1", id: "synthetic-human-review", candidateId: candidate.id, candidateRevision: candidate.revision, scope: "wwmd", payloadHash: candidate.payloadHash, destination: candidate.destination, reviewerPrincipalId: "independent-reviewer", decision: "approved", policyGeneration: "p1", expiresAt: 2000 };
  const facts: CommonsCurrentFacts = { now: 1000, revision: candidate.revision, payloadHash: candidate.payloadHash, destination: candidate.destination, policyGeneration: "p1", authority: "allowed", review: "current", classification: "shareable", cancelled: false, effect: "not-started" };
  const intent = assessCommonsEgress(candidate, review, facts);
  check(intent.kind === "prepare-egress" && !Object.hasOwn(intent, "sourceRefs"), "review binding failed or private sources exported");
  for (const change of [{ cancelled: true }, { authority: "revoked" as const }, { classification: "mixed" as const }, { review: "revoked" as const }, { now: 2000 }, { destination: { id: "changed", version: "v1" } }, { revision: "r2" }]) check(assessCommonsEgress(candidate, review, { ...facts, ...change }).kind === "hold", "stale or forbidden egress admitted");
  check(assessCommonsEgress(candidate, null, facts).kind === "hold", "missing review admitted");
  groups.push("exact content, independent review, destination and current authority");
  // Synthetic ledger facts only: a real host owns durable reservation/CAS and TAK revalidation.
  // Source refs and this private candidate binding are never the transport body.
  const bindingDigest = `sha256:${digestHex(JSON.stringify(intent))}`;
  const reserved = { bindingDigest, status: "reserved" as const, remoteRef: null };
  const uncertain = { ...reserved, status: "uncertain" as const };
  const delivered = { ...reserved, status: "delivered" as const, remoteRef: "synthetic-remote-42" };
  check(assessCommonsReceipt(reserved, uncertain).kind === "record", "lost ack not recorded");
  check(assessCommonsEgress(candidate, review, { ...facts, effect: "uncertain" }).kind === "hold", "uncertain send retried");
  check(assessCommonsReceipt(uncertain, delivered).kind === "record", "reconciled receipt refused");
  check(assessCommonsReceipt(delivered, delivered).kind === "noop", "duplicate not idempotent");
  check(assessCommonsReceipt(delivered, { ...delivered, remoteRef: "conflicting" }).kind === "hold", "conflict accepted");
  groups.push("reservation, uncertain effects and duplicate/conflicting receipts");
  const accepted = { ...delivered, status: "accepted" as const };
  check(assessCommonsReceipt(reserved, accepted).kind === "hold" && assessCommonsReceipt(delivered, accepted).kind === "record", "acceptance conflated with delivery");
  const retry = planHiveDeliveryAttempt({ ok: false, error: "synthetic known failure", attempts: 1, now: new Date(0) });
  check(retry.nextAttemptAt?.getTime() === 600000, "existing known-failure backoff changed");
  check(!normalizeHiveResultIntakeWithDigest(bundle, () => "invalid").ok, "invalid digest port accepted");
  check(!normalizeHiveResultIntakeWithDigest(bundle, () => { throw new Error("synthetic missing digest port"); }).ok, "unavailable digest port accepted");
  groups.push("accepted receipt ordering, failed digest ports and legacy retry");
  return { passed: groups.length, groups, qualification: "synthetic reference ports only; no production authority, durable effects, tenant isolation or adoption qualification" };
}
