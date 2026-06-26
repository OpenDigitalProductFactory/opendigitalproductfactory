import { describe, expect, it } from "vitest";

import {
  agreementRate,
  DEFAULT_RISK_CEILINGS,
  recommendTrustChange,
} from "./trust-graduation";

describe("agreementRate", () => {
  it("returns null when there is nothing to judge", () => {
    expect(agreementRate({ samples: 0, agreements: 0 })).toBeNull();
  });
  it("computes the ratio and clamps to [0,1]", () => {
    expect(agreementRate({ samples: 10, agreements: 5 })).toBe(0.5);
    expect(agreementRate({ samples: 10, agreements: 12 })).toBe(1); // clamp
  });
});

describe("recommendTrustChange", () => {
  it("holds at shadow until enough samples accrue", () => {
    const r = recommendTrustChange({ level: "shadow", risk: "internal-reversible", window: { samples: 5, agreements: 5 } });
    expect(r.action).toBe("hold");
    expect(r.reason).toMatch(/samples/);
  });

  it("promotes shadow -> propose on a high agreement rate over enough samples", () => {
    const r = recommendTrustChange({ level: "shadow", risk: "internal-reversible", window: { samples: 20, agreements: 19 } });
    expect(r).toMatchObject({ action: "promote", from: "shadow", to: "propose" });
  });

  it("holds (does not promote) when the rate is below the gate", () => {
    const r = recommendTrustChange({ level: "propose", risk: "internal-reversible", window: { samples: 40, agreements: 32 } }); // 80%
    expect(r.action).toBe("hold");
  });

  it("demotes a level when the rate falls below the demotion floor", () => {
    const r = recommendTrustChange({ level: "supervised", risk: "internal-reversible", window: { samples: 20, agreements: 10 } }); // 50%
    expect(r).toMatchObject({ action: "demote", from: "supervised", to: "propose" });
  });

  it("cannot demote below shadow (holds instead)", () => {
    const r = recommendTrustChange({ level: "shadow", risk: "internal-reversible", window: { samples: 15, agreements: 5 } }); // 33%
    expect(r.action).toBe("hold");
    expect(r.reason).toMatch(/already at shadow/);
  });

  it("caps kernel-floor (outbound) risk at propose even with perfect agreement", () => {
    const r = recommendTrustChange({ level: "propose", risk: "outbound-or-floor", window: { samples: 100, agreements: 100 } });
    expect(r.action).toBe("hold");
    expect(r.reason).toMatch(/floor|propose/);
  });

  it("holds at the top once a class reaches its ceiling", () => {
    const r = recommendTrustChange({ level: "autopilot", risk: "read-only", window: { samples: 100, agreements: 100 } });
    expect(r.action).toBe("hold");
  });

  it("by default lets internal-irreversible climb to autopilot", () => {
    const r = recommendTrustChange({ level: "supervised", risk: "internal-irreversible", window: { samples: 30, agreements: 29 } }); // ~96.7%
    expect(r).toMatchObject({ action: "promote", from: "supervised", to: "autopilot" });
  });

  it("respects a ceiling override (the open founder question: cap internal-irreversible at supervised)", () => {
    const r = recommendTrustChange({
      level: "supervised",
      risk: "internal-irreversible",
      window: { samples: 30, agreements: 30 },
      ceilings: { ...DEFAULT_RISK_CEILINGS, "internal-irreversible": "supervised" },
    });
    expect(r.action).toBe("hold");
  });
});
