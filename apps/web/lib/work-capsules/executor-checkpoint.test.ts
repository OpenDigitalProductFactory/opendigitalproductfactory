import { describe, expect, it } from "vitest";
import { parseExecutorCheckpoint } from "./executor-checkpoint";

// BI-11EF5A8C: the latest checkpoint an executor sends with its heartbeat.

const valid = {
  nextAction: "Merge current main, re-run the exact-head gate, then push.",
  addressing: ["Typecheck", "Unit Tests (packages)"],
  uncommittedPaths: ["apps/web/lib/mcp/contributor-readiness.ts"],
  headSha: "535e7c8c91eac8c146012770f0bcc9a9e56921fb",
  pushed: true,
  openRisks: ["Clone memory test unverified in CI workers"],
};

describe("parseExecutorCheckpoint", () => {
  it("accepts a complete checkpoint and returns only known fields", () => {
    const result = parseExecutorCheckpoint({ ...valid, extra: "dropped" });
    expect(result).toEqual({ ok: true, data: valid });
  });

  it("accepts a checkpoint with only a next action", () => {
    expect(parseExecutorCheckpoint({ nextAction: "Resume CI repair." })).toEqual({ ok: true, data: { nextAction: "Resume CI repair." } });
  });

  it.each([
    ["a non-object", "text"],
    ["an empty object", {}],
    ["a malformed sha", { ...valid, headSha: "not-a-sha" }],
    ["too many paths", { ...valid, uncommittedPaths: Array.from({ length: 51 }, (_, i) => `f${i}`) }],
    ["a non-string list entry", { ...valid, addressing: [42] }],
    ["a non-boolean pushed", { ...valid, pushed: "yes" }],
    ["an oversize payload", { ...valid, nextAction: "x".repeat(4100) }],
  ])("refuses %s", (_label, input) => {
    expect(parseExecutorCheckpoint(input)).toMatchObject({ ok: false });
  });
});
