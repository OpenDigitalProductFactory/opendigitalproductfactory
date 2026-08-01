import { describe, expect, it, vi } from "vitest";
import { assessGapsViaAi, parseAiVerdict, type CoverageProposer } from "./coverage-ai";

// D3 stage 3 (AI) tests. The proposer + db are injected/mocked, so this runs in
// the source-only worktree; values import via the client-free @dpf/db/incumbent-
// coverage subpath.

describe("parseAiVerdict", () => {
  it("parses a valid closed-enum verdict", () => {
    expect(parseAiVerdict('{"verdict":"provider_led","reason":"vertical OS"}')).toEqual({
      verdict: "provider_led",
      reason: "vertical OS",
    });
  });
  it("tolerates a fenced/prose wrapper around the JSON", () => {
    expect(parseAiVerdict('Here:\n```json\n{"verdict":"gap","reason":"unknown"}\n```')).toEqual({
      verdict: "gap",
      reason: "unknown",
    });
  });
  it("rejects an out-of-enum verdict and non-JSON", () => {
    expect(parseAiVerdict('{"verdict":"totally_native","reason":"x"}')).toBeNull();
    expect(parseAiVerdict("no json here")).toBeNull();
  });
});

function gapDb(opts: { gaps: { assessmentId: string; digitalProductId: string }[]; dp?: { name: string; observationConfig: unknown } | null }) {
  const update = vi.fn().mockResolvedValue({});
  const db = {
    incumbentCoverageAssessment: {
      findMany: vi.fn().mockResolvedValue(opts.gaps),
      update,
    },
    digitalProduct: {
      findUnique: vi.fn().mockResolvedValue(opts.dp === undefined ? { name: "Acme", observationConfig: { vendor: "Acme Corp" } } : opts.dp),
    },
  };
  return { db, update };
}

describe("assessGapsViaAi", () => {
  const gap = { assessmentId: "assess-dp-acme", digitalProductId: "DP-incumbent-acme" };

  it("writes an AI proposal (assessedVia=ai, always proposed)", async () => {
    const { db, update } = gapDb({ gaps: [gap] });
    const propose: CoverageProposer = vi.fn().mockResolvedValue({ verdict: "generic_connector", reason: "has an API" });
    const result = await assessGapsViaAi(db as never, propose);
    expect(result.proposed).toBe(1);
    const data = update.mock.calls[0]![0].data;
    expect(data.verdict).toBe("generic_connector");
    expect(data.assessedVia).toBe("ai");
    expect(data.status).toBe("proposed");
  });

  it("skips when the proposer returns null", async () => {
    const { db, update } = gapDb({ gaps: [gap] });
    const propose: CoverageProposer = vi.fn().mockResolvedValue(null);
    const result = await assessGapsViaAi(db as never, propose);
    expect(result.skipped).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("isolates a proposer error (not fatal)", async () => {
    const { db, update } = gapDb({ gaps: [gap] });
    const propose: CoverageProposer = vi.fn().mockRejectedValue(new Error("model down"));
    const result = await assessGapsViaAi(db as never, propose);
    expect(result.skipped).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("is correct over an empty set (no gaps → no calls)", async () => {
    const { db } = gapDb({ gaps: [] });
    const propose: CoverageProposer = vi.fn();
    const result = await assessGapsViaAi(db as never, propose);
    expect(result).toEqual({ proposed: 0, skipped: 0 });
    expect(propose).not.toHaveBeenCalled();
  });
});
