import { describe, expect, it } from "vitest";
import {
  validateBusinessAnalysisPlan,
  type BusinessAnalysisPlan,
} from "./business-analysis-plan";
import { PERFORMANCE_METRIC_DEFINITIONS } from "./performance-metric-catalog";

const acceptedPlan = (): BusinessAnalysisPlan => ({
  schemaVersion: 1,
  question: "How did sales and demand change last month?",
  intent: "change",
  metrics: [{ key: "sales" }, { key: "demand" }],
  dimensions: [{ key: "organization" }],
  filters: [],
  period: {
    start: "2026-07-01",
    end: "2026-07-31",
    timezone: "America/Chicago",
    grain: "day",
  },
  comparison: { basis: "prior-period" },
  sources: [
    { owner: "orders", maximumAge: "P1D" },
    { owner: "work-intake", maximumAge: "PT1H" },
  ],
  checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
});

describe("validateBusinessAnalysisPlan", () => {
  it("accepts a complete plan resolved through canonical metric definitions", () => {
    const result = validateBusinessAnalysisPlan(acceptedPlan());

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    expect(result.plan.metrics.map(({ key }) => key)).toEqual(["demand", "sales"]);
    expect(result.plan.sensitivity).toEqual(["business", "financial"]);
    expect(result.plan.definitionVersion).toBeTruthy();
    expect(result.fingerprint).toMatch(/^bap1_[0-9a-f]{16}$/);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.metrics)).toBe(true);
  });

  it("requests clarification when change intent has no comparison basis", () => {
    const plan: BusinessAnalysisPlan = {
      ...acceptedPlan(),
      comparison: { basis: "none" },
    };

    const result = validateBusinessAnalysisPlan(plan);

    expect(result.status).toBe("clarification-required");
    if (result.status !== "clarification-required") return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "comparison-required",
      path: "comparison.basis",
    }));
  });

  it("refuses unknown metrics and unsupported dimensions", () => {
    const plan: BusinessAnalysisPlan = {
      ...acceptedPlan(),
      metrics: [{ key: "invented-margin" }],
      dimensions: [{ key: "private-column" as "organization" }],
    };

    const result = validateBusinessAnalysisPlan(plan);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "unknown-metric",
      "unsupported-dimension",
    ]));
  });

  it("refuses filter operators outside the closed contract", () => {
    const plan: unknown = {
      ...acceptedPlan(),
      filters: [{ dimension: "organization", operator: "contains-sql", values: ["x"] }],
    };

    const result = validateBusinessAnalysisPlan(plan);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "invalid-filter-operator",
      path: "filters[0].operator",
    }));
  });

  it("refuses multiple values for scalar filter operators", () => {
    for (const operator of ["equals", "not-equals"] as const) {
      const result = validateBusinessAnalysisPlan({
        ...acceptedPlan(),
        filters: [{ dimension: "organization", operator, values: ["north", "south"] }],
      });

      expect(result.status).toBe("refused");
      if (result.status !== "refused") continue;
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "invalid-filter",
        path: "filters[0].values",
      }));
    }
  });

  it("normalizes set-like input into a stable reusable identity", () => {
    const left = validateBusinessAnalysisPlan(acceptedPlan());
    const original = acceptedPlan();
    const reordered: BusinessAnalysisPlan = {
      ...original,
      metrics: [...original.metrics].reverse(),
      sources: [...original.sources].reverse(),
      checks: [...original.checks].reverse(),
    };
    const right = validateBusinessAnalysisPlan(reordered);

    expect(left.status).toBe("accepted");
    expect(right.status).toBe("accepted");
    if (left.status !== "accepted" || right.status !== "accepted") return;

    expect(right.plan).toEqual(left.plan);
    expect(right.fingerprint).toBe(left.fingerprint);
  });

  it("refuses calendar, timezone, and duration values that only look valid", () => {
    const invalidCalendar = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      period: { ...acceptedPlan().period, start: "2026-02-30" },
    });
    const invalidTimezone = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      period: { ...acceptedPlan().period, timezone: "Central-ish" },
    });
    const emptyDuration = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      sources: acceptedPlan().sources.map((source) => ({ ...source, maximumAge: "PT" })),
    });

    expect(invalidCalendar.status).toBe("refused");
    expect(invalidTimezone.status).toBe("refused");
    expect(emptyDuration.status).toBe("refused");
  });

  it("normalizes equivalent IANA timezone aliases into one semantic identity", () => {
    const canonical = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      period: { ...acceptedPlan().period, timezone: "America/New_York" },
    });
    const alias = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      period: { ...acceptedPlan().period, timezone: "US/Eastern" },
    });

    expect(canonical.status).toBe("accepted");
    expect(alias.status).toBe("accepted");
    if (canonical.status !== "accepted" || alias.status !== "accepted") return;
    expect(alias.plan.period.timezone).toBe("America/New_York");
    expect(alias.plan).toEqual(canonical.plan);
    expect(alias.fingerprint).toBe(canonical.fingerprint);
  });

  it("canonicalizes mixed JSON scalar filters without order-dependent fingerprints", () => {
    const first = acceptedPlan();
    const second = acceptedPlan();
    const left = validateBusinessAnalysisPlan({
      ...first,
      filters: [{ dimension: "organization", operator: "in", values: ["1", 1, false, 0] }],
    });
    const right = validateBusinessAnalysisPlan({
      ...second,
      filters: [{ dimension: "organization", operator: "in", values: [1, "1", 0, false] }],
    });

    expect(left.status).toBe("accepted");
    expect(right.status).toBe("accepted");
    if (left.status !== "accepted" || right.status !== "accepted") return;
    expect(right.plan).toEqual(left.plan);
    expect(right.fingerprint).toBe(left.fingerprint);
  });

  it("removes duplicate set-like filter values and identical filters from identity", () => {
    const left = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      filters: [
        { dimension: "organization", operator: "in", values: ["north", "north", 1, 1] },
        { dimension: "organization", operator: "in", values: ["north", 1] },
      ],
    });
    const right = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      filters: [{ dimension: "organization", operator: "in", values: [1, "north"] }],
    });

    expect(left.status).toBe("accepted");
    expect(right.status).toBe("accepted");
    if (left.status !== "accepted" || right.status !== "accepted") return;
    expect(left.plan.filters).toHaveLength(1);
    expect(left.plan).toEqual(right.plan);
    expect(left.fingerprint).toBe(right.fingerprint);
  });

  it("normalizes equivalent freshness durations into one semantic identity", () => {
    const left = validateBusinessAnalysisPlan(acceptedPlan());
    const right = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      sources: [
        { owner: "orders", maximumAge: "PT24H" },
        { owner: "work-intake", maximumAge: "PT60M" },
      ],
    });

    expect(left.status).toBe("accepted");
    expect(right.status).toBe("accepted");
    if (left.status !== "accepted" || right.status !== "accepted") return;
    expect(right.plan.sources).toEqual(left.plan.sources);
    expect(right.fingerprint).toBe(left.fingerprint);
  });

  it("refuses non-JSON numbers and duplicate source requirements", () => {
    const invalidNumber = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      filters: [{ dimension: "organization", operator: "equals", values: [Number.NaN] }],
    });
    const duplicateSource = validateBusinessAnalysisPlan({
      ...acceptedPlan(),
      sources: [...acceptedPlan().sources, { owner: "orders", maximumAge: "PT2H" }],
    });

    expect(invalidNumber.status).toBe("refused");
    expect(duplicateSource.status).toBe("refused");
    if (duplicateSource.status !== "refused") return;
    expect(duplicateSource.issues).toContainEqual(expect.objectContaining({
      code: "duplicate-source-requirement",
    }));
  });

  it("keeps every canonical metric on the typed calculation contract", () => {
    for (const [mapKey, definition] of PERFORMANCE_METRIC_DEFINITIONS) {
      expect(definition.key).toBe(mapKey);
      expect(definition.definition.length).toBeGreaterThan(4);
      expect(definition.calculation.kind).toBeTruthy();
      expect(definition.calculation.inputs.length).toBeGreaterThan(0);
      expect(definition.allowedDimensions).toContain("organization");
      expect(definition.supportedComparisons).toContain("none");
      expect(definition.supportedComparisons).toContain(definition.comparison);
    }
  });
});
