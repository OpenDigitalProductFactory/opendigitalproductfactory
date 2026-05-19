import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the heavy I/O dependency so tests don't hit the bind-mounted filesystem.
// Each call returns synchronously-resolved empty results; per-test overrides
// (delays, throws) install fresh implementations.
vi.mock("./codebase-tools", () => ({
  searchProjectFiles: vi.fn(async () => ({ results: [] })),
}));

import { dispatchScoutResearch, _resetScoutMutexForTests } from "./scout-dispatch";
import { searchProjectFiles } from "./codebase-tools";

const mockSearch = vi.mocked(searchProjectFiles);

afterEach(() => {
  _resetScoutMutexForTests();
  mockSearch.mockReset();
  mockSearch.mockImplementation(async () => ({ results: [] }));
});

describe("dispatchScoutResearch single-flight mutex (BI-6588414f slice 2)", () => {
  it("collapses concurrent calls with the same buildId into one underlying dispatch", async () => {
    // Slow inner so both callers overlap at the mutex layer.
    mockSearch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { results: [] };
    });

    const params = {
      buildId: "FB-CONCURRENT",
      featureTitle: "concurrent dispatch keyword material",
      featureDescription: "",
    };

    const [a, b] = await Promise.all([
      dispatchScoutResearch(params),
      dispatchScoutResearch(params),
    ]);
    const callsAfterTwo = mockSearch.mock.calls.length;

    // Run a third dispatch sequentially as the baseline for "one full pass".
    _resetScoutMutexForTests();
    mockSearch.mockClear();
    await dispatchScoutResearch(params);
    const callsForOnePass = mockSearch.mock.calls.length;

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    // Both callers observe the SAME result object — the second awaited the
    // first's in-flight promise instead of starting its own dispatch.
    expect(b.result).toBe(a.result);
    // And the two concurrent callers together produced exactly one pass'
    // worth of searchProjectFiles calls — not two.
    expect(callsAfterTwo).toBe(callsForOnePass);
  });

  it("runs distinct buildIds in parallel", async () => {
    let inflight = 0;
    let maxConcurrent = 0;
    mockSearch.mockImplementation(async () => {
      inflight += 1;
      maxConcurrent = Math.max(maxConcurrent, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return { results: [] };
    });

    await Promise.all([
      dispatchScoutResearch({ buildId: "FB-A", featureTitle: "alpha distinct keyword content", featureDescription: "" }),
      dispatchScoutResearch({ buildId: "FB-B", featureTitle: "beta different keyword content", featureDescription: "" }),
    ]);

    // Different keys → no mutex contention → at least two concurrent inner
    // calls expected.
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });

  it("clears the mutex after a successful dispatch so subsequent calls re-execute", async () => {
    const params = { buildId: "FB-SEQ", featureTitle: "sequential keyword content here", featureDescription: "" };

    const first = await dispatchScoutResearch(params);
    const callsAfterFirst = mockSearch.mock.calls.length;

    const second = await dispatchScoutResearch(params);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    // Second call genuinely re-executed — not a stale cached promise.
    expect(mockSearch.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    // And the two result objects are different identities (fresh dispatch).
    expect(second.result).not.toBe(first.result);
  });

  it("clears the mutex after a thrown dispatch so subsequent calls re-execute", async () => {
    // First call throws.
    mockSearch.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const params = { buildId: "FB-THROW", featureTitle: "throwing keyword content here", featureDescription: "" };
    const first = await dispatchScoutResearch(params);

    // dispatchScoutResearch catches internally and returns success:true with
    // partial results — but the important invariant is the mutex is cleared,
    // proven by a subsequent call running a new inner pass.
    const callsAfterFirst = mockSearch.mock.calls.length;

    mockSearch.mockImplementation(async () => ({ results: [] }));
    const second = await dispatchScoutResearch(params);

    expect(second.success).toBe(true);
    expect(mockSearch.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    // Confirm no contamination from the throw.
    expect(first).toBeDefined();
  });
});
