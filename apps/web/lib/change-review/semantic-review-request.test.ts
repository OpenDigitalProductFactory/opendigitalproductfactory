import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSemanticReviewRequest, parseSemanticReviewRequest } from "./semantic-review-request";
import type { SemanticChangeReviewOperationInput } from "./semantic-change-review-operation";

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
    expect(parseSemanticReviewRequest({ ...packet, schemaVersion: 2 })).toBeNull();
    expect(parseSemanticReviewRequest({ ...packet, actor: { ...actor, userId: "other-user" } })).toBeNull();
  });

  it("rejects a mismatched diff digest and bounds persisted bytes", () => {
    expect(() => createSemanticReviewRequest({ ...input, artifact: artifact.trim() }, actor, now)).toThrow(/digest/i);
    const huge = "x".repeat(2 * 1024 * 1024);
    expect(() => createSemanticReviewRequest({ ...input, artifact: huge,
      identity: { ...input.identity, diffDigest: createHash("sha256").update(huge).digest("hex") } }, actor, now)).toThrow(/size/i);
  });
});
