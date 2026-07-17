// apps/web/lib/crm/crm-core.test.ts
//
// Unit tests for the pure CRM domain helpers extracted from lib/actions/crm.ts
// (BI-OPT-FAT-ACTIONS, CRM slice). These functions are now side-effect-free
// (no prisma / auth / Next.js), so they are exercised directly here.
import { describe, it, expect } from "vitest";
import {
  trimOrNull,
  toDateOrNull,
  readLifecycleEvidenceField,
  deriveLifecycleConfidence,
  buildCustomerConfigurationItemLifecycleState,
  requiredTrimmed,
  calcLineTotal,
} from "./crm-core";

describe("trimOrNull", () => {
  it("returns null for non-string input", () => {
    expect(trimOrNull(undefined)).toBeNull();
    expect(trimOrNull(null)).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(trimOrNull("   ")).toBeNull();
  });

  it("trims and returns non-empty content", () => {
    expect(trimOrNull("  hello  ")).toBe("hello");
  });
});

describe("toDateOrNull", () => {
  it("returns null for empty / nullish input", () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
    expect(toDateOrNull("")).toBeNull();
  });

  it("passes a Date instance through", () => {
    const d = new Date("2026-06-01T00:00:00.000Z");
    expect(toDateOrNull(d)).toBe(d);
  });

  it("parses an ISO string into a Date", () => {
    const parsed = toDateOrNull("2026-06-01");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("returns null for an unparseable string", () => {
    expect(toDateOrNull("not-a-date")).toBeNull();
  });
});

describe("readLifecycleEvidenceField", () => {
  it("returns undefined for non-object / array values", () => {
    expect(readLifecycleEvidenceField(null, "source")).toBeUndefined();
    expect(readLifecycleEvidenceField("x", "source")).toBeUndefined();
    expect(readLifecycleEvidenceField(["a"], "notes")).toBeUndefined();
  });

  it("reads a string field by key", () => {
    const evidence = { source: "vendor calendar", notes: "verified" };
    expect(readLifecycleEvidenceField(evidence, "source")).toBe("vendor calendar");
    expect(readLifecycleEvidenceField(evidence, "notes")).toBe("verified");
  });

  it("returns undefined when the field is not a string", () => {
    expect(readLifecycleEvidenceField({ source: 42 }, "source")).toBeUndefined();
  });
});

describe("deriveLifecycleConfidence", () => {
  const base = {
    supportModel: null,
    normalizedVersion: null,
    observedVersion: null,
    renewalDate: null,
    endOfSupportAt: null,
    endOfLifeAt: null,
    warrantyEndAt: null,
    evidenceSource: null,
    evidenceNotes: null,
  };

  it("returns the 0.35 floor when no signals are present", () => {
    expect(deriveLifecycleConfidence(base)).toBe(0.35);
  });

  it("adds weighted increments per signal", () => {
    expect(
      deriveLifecycleConfidence({
        ...base,
        supportModel: "lts",
        normalizedVersion: "22.04",
        renewalDate: new Date("2026-06-01"),
      }),
    ).toBe(0.85); // 0.35 + 0.15 + 0.15 + 0.2
  });

  it("caps confidence at 0.95 even when every signal is present", () => {
    expect(
      deriveLifecycleConfidence({
        supportModel: "vendor_contract",
        normalizedVersion: "1.0",
        observedVersion: "1.0",
        renewalDate: new Date(),
        endOfSupportAt: new Date(),
        endOfLifeAt: new Date(),
        warrantyEndAt: new Date(),
        evidenceSource: "src",
        evidenceNotes: "notes",
      }),
    ).toBe(0.95);
  });
});

describe("requiredTrimmed", () => {
  it("trims and returns present values", () => {
    expect(requiredTrimmed("  Acme  ", "Name")).toBe("Acme");
  });

  it("throws a labelled error for empty / whitespace / nullish values", () => {
    expect(() => requiredTrimmed("   ", "Engagement title")).toThrow(
      "Engagement title is required",
    );
    expect(() => requiredTrimmed(null, "Contact id")).toThrow("Contact id is required");
    expect(() => requiredTrimmed(undefined, "Signal source")).toThrow(
      "Signal source is required",
    );
  });
});

describe("calcLineTotal", () => {
  it("multiplies unit price by quantity with no discount", () => {
    expect(calcLineTotal(100, 2, 0)).toBe(200);
  });

  it("applies a percentage discount", () => {
    expect(calcLineTotal(100, 2, 10)).toBe(180);
  });
});

describe("buildCustomerConfigurationItemLifecycleState", () => {
  it("trims string fields, coerces dates, and assembles the lifecycle evidence", () => {
    const state = buildCustomerConfigurationItemLifecycleState({
      name: "SentinelOne Complete",
      ciType: "endpoint-security-license",
      technologySourceType: "commercial",
      supportModel: "  subscription  ",
      normalizedVersion: "  24.1  ",
      billingCadence: "  annual  ",
      renewalDate: "2026-06-01",
      evidenceSource: "  vendor calendar  ",
      evidenceNotes: "  verified  ",
      reviewCadenceDays: 30,
    });

    expect(state.supportModel).toBe("subscription");
    expect(state.normalizedVersion).toBe("24.1");
    expect(state.billingCadence).toBe("annual");
    expect(state.renewalDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(state.lifecycleEvidence.source).toBe("vendor calendar");
    expect(state.lifecycleEvidence.notes).toBe("verified");
    expect(state.lifecycleEvidence.seededReviewCadenceDays).toBe(30);
    expect(state.lastLifecycleReviewAt).toBeInstanceOf(Date);
    expect(state.lifecycleConfidence).toBeGreaterThanOrEqual(0.35);
    expect(state.lifecycleConfidence).toBeLessThanOrEqual(0.95);
  });

  it("falls back to a reviewCadenceDays-derived next review when the lifecycle supplies none", () => {
    const before = Date.now();
    const state = buildCustomerConfigurationItemLifecycleState({
      name: "Ubuntu Server",
      ciType: "linux-server",
      technologySourceType: "open_source",
      reviewCadenceDays: 45,
    });

    // With no dates supplied, evaluateTechnologyLifecycle yields no nextReviewAt,
    // so the cadence-derived fallback (~45 days out) is used.
    expect(state.nextLifecycleReviewAt).toBeInstanceOf(Date);
    const deltaDays =
      (state.nextLifecycleReviewAt!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBeGreaterThan(44);
    expect(deltaDays).toBeLessThan(46);
  });
});
