import { describe, expect, it } from "vitest";
import { warrantForBacklogItem } from "./warrant-for-item";

describe("warrantForBacklogItem — corpus-free promote-time warrant", () => {
  it("a small doc gets a low-rigor warrant (collapsed gate, no escalation)", () => {
    const { warrant, opts } = warrantForBacklogItem({
      effortSize: "small",
      workType: "doc",
      text: "Update the getting-started guide wording",
    });
    expect(warrant.altitude).toBe("WSID");
    expect(opts.qualityFirst).toBe(false);
    expect(opts.sensitivity).toBe("low");
  });

  it("a high-sensitivity item (auth/security keyword) escalates rigor via blast radius", () => {
    const { opts } = warrantForBacklogItem({
      effortSize: "small",
      workType: "feature",
      text: "Add password reset and session token rotation to authentication",
    });
    // Even though it's 'small', the security blast-radius signal escalates the gate.
    expect(opts.sensitivity).toBe("high");
    expect(opts.qualityFirst).toBe(true);
  });

  it("an xlarge feature lands high-altitude regardless of keyword sensitivity", () => {
    const { warrant } = warrantForBacklogItem({
      effortSize: "xlarge",
      workType: "feature",
      text: "Cross-channel performance report with campaign KPI rollups",
    });
    expect(warrant.altitude).toBe("WWMD");
  });

  it("rigor is monotonic in sensitivity: high ≥ elevated ≥ low", () => {
    const rank = { low: 0, elevated: 1, high: 2 } as const;
    const low = warrantForBacklogItem({ effortSize: "small", workType: "doc", text: "tweak copy" }).opts;
    const elevated = warrantForBacklogItem({ effortSize: "medium", workType: "feature", text: "add a database migration for orders" }).opts;
    const high = warrantForBacklogItem({ effortSize: "small", workType: "feature", text: "encrypt cardholder billing data (PCI)" }).opts;
    expect(rank[elevated.sensitivity ?? "low"]).toBeGreaterThanOrEqual(rank[low.sensitivity ?? "low"]);
    expect(rank[high.sensitivity ?? "low"]).toBeGreaterThanOrEqual(rank[elevated.sensitivity ?? "low"]);
  });

  it("unknown effortSize is tolerated (falls back to altitude defaults, no throw)", () => {
    expect(() => warrantForBacklogItem({ effortSize: "gigantic", workType: null, text: null })).not.toThrow();
  });
});
