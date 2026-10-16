import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSemanticReviewRequest, isSemanticReviewRequestRoleBinding, parseSemanticReviewRequest } from "./semantic-review-request";
import type { SemanticChangeReviewOperationInput } from "./semantic-change-review-operation";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

const now = new Date("2026-09-07T04:00:00Z");
const artifact = "diff --git a/a.ts b/a.ts\n+exact content\n";
const input: SemanticChangeReviewOperationInput = {
  surface: "external", authorSurface: "codex-desktop", artifactType: "code-change",
  title: "Review change", artifact, verificationEvidence: "Focused tests pass",
  changedFiles: ["apps/web/lib/a.ts"],
  identity: { capsuleId: "WC-TEST", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40),
    diffDigest: createHash("sha256").update(artifact).digest("hex"), specialistIds: [] },
};
const actor = { userId: "user-1", agentId: null, apiTokenId: "token-1", authSource: "pat" };

describe("durable semantic review request", () => {
  it.each([
    [1, "code-change", undefined, true], [2, "code-change", "code-change", true],
    [3, "code-change", "code-change", false], ["2", "code-change", "code-change", false],
    [2, "code-change", undefined, false], [2, "code-change", "spec", false],
    [1, "code-change", "code-change", false], [1, "code-change", null, false],
    [2, "unsupported", "unsupported", false],
  ])("shares version %s and role %s binding with bounded readers", (version, role, identityRole, expected) => {
    expect(isSemanticReviewRequestRoleBinding(version, role, identityRole)).toBe(expected);
  });
  it("writes an explicit role-bound contract by default", () => {
    const packet = createSemanticReviewRequest(input, actor, now);
    expect(packet.schemaVersion).toBe(2);
    expect(packet.input.identity.artifactType).toBe("code-change");
    expect(packet.input.identity.reviewerVersion).toBe("change-reviewer.v2");
  });

  it("retains the original identity and deadline of legacy packets", () => {
    const packet = createSemanticReviewRequest(input, actor, now, 1);
    expect(packet.schemaVersion).toBe(1);
    expect(packet.input.identity.artifactType).toBeUndefined();
    expect(packet.input.identity.reviewerVersion).toBe("change-reviewer.v1");
    expect(parseSemanticReviewRequest(packet)).toEqual(packet);
    expect(packet.deadlineAt).toBe("2026-09-07T04:30:00.000Z");
  });

  it("reads role-bound packets and separates same-content roles without changing deadlines", () => {
    const spec = createSemanticReviewRequest({ ...input, artifactType: "spec", risk: "high" }, actor, now, 2);
    const plan = createSemanticReviewRequest({ ...input, artifactType: "plan", risk: "high" }, actor, now, 2);
    expect(spec.schemaVersion).toBe(2);
    expect(spec.input.identity.artifactType).toBe("spec");
    expect(plan.gateKey).not.toBe(spec.gateKey);
    expect(plan.deadlineAt).toBe(spec.deadlineAt);
    expect(parseSemanticReviewRequest(spec)).toEqual(spec);
  });

  it("rejects a correctly rehashed packet with conflicting role or a downgraded envelope", () => {
    const packet = createSemanticReviewRequest(input, actor, now, 2);
    const rehash = (value: typeof packet) => {
      const { digest: _digest, ...body } = value;
      return { ...body, digest: createHash("sha256").update(canonicalJson(body)).digest("hex") };
    };
    expect(parseSemanticReviewRequest(rehash({ ...packet, input: { ...packet.input, artifactType: "spec" } }))).toBeNull();
    expect(parseSemanticReviewRequest(rehash({ ...packet, schemaVersion: 1 }))).toBeNull();
  });

  it("round-trips the exact artifact, identity and actor with a fixed deadline", () => {
    const packet = createSemanticReviewRequest(input, actor, now);
    expect(packet.input.artifact).toBe(artifact);
    expect(packet.deadlineAt).toBe("2026-09-07T04:30:00.000Z");
    expect(parseSemanticReviewRequest(JSON.parse(JSON.stringify(packet)))).toEqual(packet);
    expect(packet.actor).toEqual(actor);
  });

  it("isolates persisted identity from later caller mutation", () => {
    const changedFiles = [...input.changedFiles];
    const caller = { ...actor };
    const packet = createSemanticReviewRequest({ ...input, changedFiles }, caller, now);
    changedFiles.push("other.ts");
    caller.userId = "other-user";
    expect(packet.input.changedFiles).toEqual(input.changedFiles);
    expect(packet.actor.userId).toBe("user-1");
    expect(parseSemanticReviewRequest(packet)).toEqual(packet);
  });

  it("refuses modified payloads and unsupported versions without dispatch", () => {
    const packet = createSemanticReviewRequest(input, actor, now);
    expect(parseSemanticReviewRequest({ ...packet, input: { ...packet.input, artifact: "changed" } })).toBeNull();
    expect(parseSemanticReviewRequest({ ...packet, schemaVersion: 99 })).toBeNull();
    expect(parseSemanticReviewRequest({ ...packet, actor: { ...actor, userId: "other-user" } })).toBeNull();
  });

  it("rejects a mismatched diff digest and bounds persisted bytes", () => {
    expect(() => createSemanticReviewRequest({ ...input, artifact: artifact.trim() }, actor, now)).toThrow(/digest/i);
    const huge = "x".repeat(2 * 1024 * 1024);
    expect(() => createSemanticReviewRequest({ ...input, artifact: huge,
      identity: { ...input.identity, diffDigest: createHash("sha256").update(huge).digest("hex") } }, actor, now)).toThrow(/size/i);
  });
});


it("pins profession selection to its actor and room while retaining legacy packet readability", () => {
  const selection = { schemaVersion: 1 as const, userId: actor.userId, capsuleId: input.identity.capsuleId, registryVersion: "1.0.0", authorAgentIds: [], requiredProfessions: ["finance"], specialists: [{ professionKey: "finance", agentId: "review-finance", displayName: "Finance" }], unavailableProfessions: [] };
  const packet = createSemanticReviewRequest({ ...input, specialistSelection: selection }, actor, now);
  expect(parseSemanticReviewRequest(packet)).toEqual(packet);
  expect(packet.input.identity.reviewerVersion).toBe("change-reviewer.v3-professions");
  expect(() => createSemanticReviewRequest({ ...input, specialistSelection: { ...selection, userId: "different-user" } }, actor, now)).toThrow(/selection.*actor|actor.*selection/i);
  expect(() => createSemanticReviewRequest({ ...input, specialistSelection: { ...selection, capsuleId: "WC-OTHER" } }, actor, now)).toThrow(/selection.*room|room.*selection/i);
});


it("does not reuse the same gate when required profession provenance changes", () => {
  const selection = { schemaVersion: 1 as const, userId: actor.userId, capsuleId: input.identity.capsuleId, registryVersion: "1.0.0", authorAgentIds: [], requiredProfessions: ["finance"], specialists: [{ professionKey: "finance", agentId: "review-finance", displayName: "Finance" }], unavailableProfessions: [] };
  const first = createSemanticReviewRequest({ ...input, specialistSelection: selection }, actor, now);
  const next = createSemanticReviewRequest({ ...input, specialistSelection: { ...selection, authorAgentIds: ["additional-author"] } }, actor, now);
  expect(next.gateKey).not.toBe(first.gateKey);
});
