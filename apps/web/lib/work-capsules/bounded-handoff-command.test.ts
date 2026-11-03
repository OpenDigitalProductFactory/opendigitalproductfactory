import { describe, expect, it } from "vitest";
import { parseBoundedHandoffCommand, handoffDigest } from "./bounded-handoff-command";
const request = { phase: "request", commandId: " c1 ", capsuleId: "WC-1", expectedLeaseHolderPrincipalId: "human", expectedExecutorKind: "claude-desktop", expectedExecutorRef: "source", targetAgentId: "AGT-EXT-CODEX", toExecutorKind: "codex-desktop", toExecutorRef: "destination", handoffManifest: { nextAction: "Continue", risks: ["race"] } };
describe("bound handoff command normalization", () => {
  it("preserves legacy omission and refuses explicit unsupported phases", () => {
    expect(parseBoundedHandoffCommand({ capsuleId: "WC-1" })).toBeNull();
    for (const phase of [null, undefined, "accept", ""]) expect(() => parseBoundedHandoffCommand({ ...request, phase })).toThrow();
  });
  it("requires identity and complete source and destination bindings", () => {
    for (const key of ["commandId", "capsuleId", "expectedLeaseHolderPrincipalId", "expectedExecutorKind", "expectedExecutorRef", "targetAgentId", "toExecutorKind", "toExecutorRef", "handoffManifest"]) {
      const partial: Record<string, unknown> = { ...request }; delete partial[key]; expect(() => parseBoundedHandoffCommand(partial)).toThrow();
    }
  });
  it("rejects unknown effects and acknowledgement destination overrides", () => {
    expect(() => parseBoundedHandoffCommand({ ...request, force: true })).toThrow();
    expect(() => parseBoundedHandoffCommand({ phase: "acknowledge", commandId: "a", capsuleId: "WC-1", requestId: "r", toExecutorRef: "another" })).toThrow();
  });
  it("normalizes command identity, keeps manifest bytes and binds optional reason", () => {
    const normalized = parseBoundedHandoffCommand(request);
    expect(normalized?.commandId).toBe("c1");
    expect(handoffDigest(normalized)).not.toBe(handoffDigest(parseBoundedHandoffCommand({ ...request, reason: "different reason" })));
    expect(handoffDigest({ a: 1, b: 2 })).toBe(handoffDigest({ b: 2, a: 1 }));
  });
  it("refuses non-JSON or missing next-action manifests", () => {
    for (const handoffManifest of [{}, { nextAction: " " }, { nextAction: "Continue", omitted: undefined }, { nextAction: "Continue", date: new Date() }]) expect(() => parseBoundedHandoffCommand({ ...request, handoffManifest })).toThrow();
  });
});
