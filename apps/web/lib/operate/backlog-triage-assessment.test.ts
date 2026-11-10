import { describe, expect, it, vi } from "vitest";
import { assessmentEligible, assessTriageItem, triageFingerprint } from "./backlog-triage-assessment";

const item = { itemId: "BI-test", title: "A scoped fix", body: "details" };
const now = new Date("2026-10-04T12:00:00Z");
describe("durable triage assessments", () => {
  it("bounds model waiting and ignores a late response after the budget", async () => {
    vi.useFakeTimers();
    try {
      let respond!: (value: string) => void;
      const applyBuild = vi.fn();
      const pending = assessTriageItem(item, { decide: () => new Promise(resolve => { respond = resolve; }), applyBuild, recordDecision: async () => true, callBudgetMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      expect((await pending).outcome).toBe("model-error");
      respond('{"outcome":"build","effortSize":"small","confidence":0.95}');
      await Promise.resolve();
      expect(applyBuild).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("suppresses unchanged review results and invalidates changed input", () => {
    const previous = { fingerprint: triageFingerprint(item), outcome: "needs-review", attempts: 1, retryAt: null };
    expect(assessmentEligible(item, previous, now)).toBe(false);
    expect(assessmentEligible({ ...item, body: "new evidence" }, previous, now)).toBe(true);
    expect(assessmentEligible(item, { ...previous, fingerprint: "old-policy" }, now)).toBe(true);
  });
  it("fails open on malformed assessment metadata and rejects non-finite confidence", async () => {
    expect(assessmentEligible(item, { outcome: "needs-review" }, now)).toBe(true);
    expect(assessmentEligible(item, { fingerprint: triageFingerprint(item), outcome: "invented", attempts: 1 }, now)).toBe(true);
    const applyBuild = vi.fn();
    const result = await assessTriageItem(item, { decide: async () => '{"outcome":"build","effortSize":"small","confidence":1e999}', applyBuild, recordDecision: async () => true });
    expect(result.outcome).toBe("invalid-response");
    expect(applyBuild).not.toHaveBeenCalled();
  });
  it("backs off transient failures and stops after three attempts", () => {
    const previous = { fingerprint: triageFingerprint(item), outcome: "model-error", attempts: 1, retryAt: "2026-10-04T13:00:00Z" };
    expect(assessmentEligible(item, previous, now)).toBe(false);
    expect(assessmentEligible(item, previous, new Date("2026-10-04T13:00:00Z"))).toBe(true);
    expect(assessmentEligible(item, { ...previous, attempts: 3 }, new Date("2026-10-05T13:00:00Z"))).toBe(false);
  });
  it("distinguishes review, malformed responses, model errors and ledger errors", async () => {
    const deps = { decide: async () => '{"outcome":"needs-human","confidence":0.5}', applyBuild: vi.fn(), recordDecision: async () => true };
    expect((await assessTriageItem(item, deps)).outcome).toBe("needs-review");
    expect((await assessTriageItem(item, { ...deps, decide: async () => "garbage" })).outcome).toBe("invalid-response");
    expect((await assessTriageItem(item, { ...deps, decide: async () => { throw new Error("private provider details"); } })).outcome).toBe("model-error");
    expect((await assessTriageItem(item, { ...deps, decide: async () => '{"outcome":"build","effortSize":"small","confidence":0.95}', recordDecision: async () => false })).outcome).toBe("ledger-error");
    expect(deps.applyBuild).not.toHaveBeenCalled();
  });
  it("preserves author size and reports concurrent change without claiming a build", async () => {
    const applyBuild = vi.fn(async () => false);
    const result = await assessTriageItem({ ...item, effortSize: "large" }, { decide: async () => '{"outcome":"build","effortSize":"small","confidence":0.95}', applyBuild, recordDecision: async () => true });
    expect(applyBuild).toHaveBeenCalledWith(item.itemId, "large", expect.any(String));
    expect(result.outcome).toBe("changed");
  });
});
