import { describe, expect, it } from "vitest";
import { createSmallAcceptanceBinding, readSmallAcceptanceBinding } from "./small-acceptance-binding";

const sha = "a".repeat(40);
export const context = {
  itemId: "BI-ONE", closureId: "closure-1", workCapsuleId: "room-1",
  repositoryFullName: "owner/repo", headSha: "b".repeat(40), mergeCommitSha: "c".repeat(40),
  servedSha: sha, deploymentRunId: "SUR-1", deploymentCompletedAt: "2026-10-26T10:00:00.000Z",
  effectiveShape: "small", closureRecordedAt: "2026-10-26T10:01:00.000Z",
};
const input = { startedAt: new Date("2026-10-26T10:02:00Z"), completedAt: new Date("2026-10-26T10:03:00Z"),
  command: "Drive served recovery", result: { observations: ["routing blocked", "unknown stays unknown"] } };
const actor = { principalId: "principal-1", userId: "human-1", agentId: "agent-1" };
const now = new Date("2026-10-26T10:04:00Z");

describe("Small runtime acceptance binding", () => {
  it("binds an ordinary Small check to exact server facts and authenticated actor", () => {
    const bound = createSmallAcceptanceBinding({ context, input, actor, now });
    expect(readSmallAcceptanceBinding(bound)).toEqual(bound);
    expect(bound).toMatchObject({ ...context, actor, schemaVersion: 1 });
  });
  it.each(["medium", "large", "break-fix", "unknown"])("cannot certify %s as Small", effectiveShape => {
    expect(() => createSmallAcceptanceBinding({ context: { ...context, effectiveShape }, input, actor, now })).toThrow(/Small/);
  });
  it("requires actor, complete source and bounded post-deployment observations", () => {
    for (const changed of [
      { ...input, startedAt: new Date("2026-10-26T09:59:00Z") },
      { ...input, completedAt: new Date("2026-10-26T11:00:00Z") },
      { ...input, command: "" }, { ...input, result: {} },
    ]) expect(() => createSmallAcceptanceBinding({ context, input: changed, actor, now })).toThrow();
    expect(() => createSmallAcceptanceBinding({ context, input, actor: {}, now })).toThrow(/actor/);
    expect(() => createSmallAcceptanceBinding({ context: { ...context, servedSha: "unknown" }, input, actor, now })).toThrow();
  });
  it("does not parse old prose, caller assertions or unknown binding versions", () => {
    expect(readSmallAcceptanceBinding({ servedSha: sha, passed: true })).toBeNull();
    expect(readSmallAcceptanceBinding({ ...createSmallAcceptanceBinding({ context, input, actor, now }), schemaVersion: 9 })).toBeNull();
  });
});
