// apps/web/lib/coworker-record/roster-filter.test.ts
// EP-AI-WORKFORCE-001 / EP-COWORKER-RT (HRIS surface) — roster filter predicate guards.

import { describe, it, expect } from "vitest";
import {
  matchesFilters,
  matchesQuery,
  isCoverageGap,
  kindOptions,
  EMPTY_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  needsAttention,
  safeRosterReturnTo,
} from "./roster-filter";
import type { RosterRow } from "./roster";

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    agentId: "AGT-1",
    slugId: "finance-agent",
    name: "Finance",
    displayName: "Finance",
    kind: "specialist",
    tier: 2,
    valueStream: "operate",
    lifecycleStage: "production",
    plainJob: "Keeps the books current and prepares finance work.",
    workSearchText: "Monthly close Vendor reconciliation",
    canStartConversation: true,
    area: {
      key: "foundational",
      label: "Platform and back office",
      order: 4,
    },
    areas: [
      {
        key: "foundational",
        label: "Platform and back office",
        order: 4,
      },
    ],
    interaction: {
      scopes: ["internal-only"],
      labels: ["Internal only"],
    },
    availability: {
      state: "available",
      label: "Available for your business type",
      reason: "This coworker explicitly supports the restaurant business type.",
      matchLevel: "leaf",
      evidence: [],
    },
    authority: {
      state: "resolved",
      scope: { kind: "default-posture" },
      level: "approval-required",
      label: "Acts with approval",
      summary: "This coworker acts after a person approves.",
      ownerReason: "The default human-in-the-loop tier requires approval.",
      ownerAction: "Approve the action before it runs.",
      winner: {
        source: "agent",
        ref: "AGT-1",
        field: "hitlTierDefault",
        role: "selected-base",
        observedValue: "1",
        normalizedLevel: "approval-required",
        detail: "Agent AGT-1 has HITL tier 1",
      },
      evidence: [],
    },
    familyKey: "finance",
    familyLabel: "Finance & Accounting",
    coveragePct: 90,
    jurisdictions: ["us", "global"],
    competencies: ["practitioner"],
    profileBound: true,
    emptyCorpus: false,
    providerHealthy: true,
    openBlockers: 0,
    deferRate: 0,
    unmapped: false,
    lastActiveAt: null,
    ...over,
  };
}

const valueSets = {
  families: ["finance"],
  kinds: ["specialist"],
  valueStreams: ["operate"],
  competencies: ["practitioner"],
  jurisdictions: ["us", "global"],
  lifecycleStages: ["production"],
};

describe("isCoverageGap", () => {
  it("flags unmapped, empty corpus, and sub-80% coverage", () => {
    expect(isCoverageGap(row({ unmapped: true, familyKey: null, coveragePct: null }))).toBe(true);
    expect(isCoverageGap(row({ emptyCorpus: true }))).toBe(true);
    expect(isCoverageGap(row({ coveragePct: 50 }))).toBe(true);
    expect(isCoverageGap(row({ coveragePct: 90 }))).toBe(false);
  });
});

describe("matchesQuery", () => {
  it("matches everything for an empty or whitespace query", () => {
    expect(matchesQuery(row(), "")).toBe(true);
    expect(matchesQuery(row(), "   ")).toBe(true);
  });

  it("matches case-insensitively on displayName", () => {
    expect(matchesQuery(row({ displayName: "Build Lead" }), "build")).toBe(true);
    expect(matchesQuery(row({ displayName: "Build Lead" }), "LEAD")).toBe(true);
    expect(matchesQuery(row({ displayName: "Build Lead" }), "marketing")).toBe(false);
  });

  it("matches on slugId and family label", () => {
    expect(matchesQuery(row({ slugId: "build-lead", displayName: "Build Lead" }), "build-lead")).toBe(true);
    expect(matchesQuery(row({ familyLabel: "Finance & Accounting" }), "accounting")).toBe(true);
  });

  it("matches owner-facing job and area copy", () => {
    expect(matchesQuery(row(), "keeps the books")).toBe(true);
    expect(matchesQuery(row(), "back office")).toBe(true);
    expect(matchesQuery(row(), "vendor reconciliation")).toBe(true);
  });

  it("does not crash on null slug / family", () => {
    expect(matchesQuery(row({ slugId: null, familyLabel: null }), "finance")).toBe(true); // matches name/displayName
    expect(matchesQuery(row({ slugId: null, familyLabel: null }), "zzz")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("passes everything with empty filters", () => {
    expect(matchesFilters(row(), EMPTY_FILTERS)).toBe(true);
  });

  it("filters by family, jurisdiction, competency, lifecycle", () => {
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, family: "finance" })).toBe(true);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, family: "marketing" })).toBe(false);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, jurisdiction: "us" })).toBe(true);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, jurisdiction: "eu" })).toBe(false);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, competency: "expert" })).toBe(false);
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, lifecycle: "retirement" })).toBe(false);
  });

  it("filters by owner area, interaction, availability, and authority", () => {
    expect(
      matchesFilters(row(), {
        ...EMPTY_FILTERS,
        area: "foundational",
        interaction: "internal-only",
        availability: "available",
        authority: "approval-required",
      }),
    ).toBe(true);
    expect(
      matchesFilters(row(), {
        ...EMPTY_FILTERS,
        interaction: "talks-to-customers",
      }),
    ).toBe(false);
  });

  it("matches a secondary service-defined owner area without duplicating the card", () => {
    expect(
      matchesFilters(
        row({
          areas: [
            {
              key: "products_and_services_sold",
              label: "Customers and sales",
              order: 1,
            },
            {
              key: "foundational",
              label: "Platform and back office",
              order: 4,
            },
          ],
        }),
        { ...EMPTY_FILTERS, area: "products_and_services_sold" },
      ),
    ).toBe(true);
  });

  it("filters by kind", () => {
    expect(matchesFilters(row({ kind: "orchestrator" }), { ...EMPTY_FILTERS, kind: "orchestrator" })).toBe(true);
    expect(matchesFilters(row({ kind: "specialist" }), { ...EMPTY_FILTERS, kind: "orchestrator" })).toBe(false);
  });

  it("filters by the free-text query alongside other facets", () => {
    expect(
      matchesFilters(row({ displayName: "Build Lead", kind: "orchestrator" }), {
        ...EMPTY_FILTERS,
        query: "build",
        kind: "orchestrator",
      }),
    ).toBe(true);
    // query miss excludes even when the facet matches (query hits no field:
    // displayName/slug/name/family all lack "zzz")
    expect(
      matchesFilters(row({ displayName: "Build Lead", name: "Build Lead", slugId: "build-lead", familyLabel: "Software Engineering", kind: "orchestrator" }), {
        ...EMPTY_FILTERS,
        query: "zzz",
        kind: "orchestrator",
      }),
    ).toBe(false);
  });

  it("coverageGap filter excludes healthy rows and keeps gaps", () => {
    expect(matchesFilters(row({ coveragePct: 95 }), { ...EMPTY_FILTERS, coverageGap: true })).toBe(false);
    expect(matchesFilters(row({ unmapped: true }), { ...EMPTY_FILTERS, coverageGap: true })).toBe(true);
  });
});

describe("attention and URL state", () => {
  it("keeps owner attention separate from technical knowledge coverage", () => {
    const base = row();
    expect(needsAttention(row())).toBe(false);
    expect(
      needsAttention(
        row({
          availability: {
            ...base.availability,
            state: "setup-needed",
            label: "Setup needed",
          },
        }),
      ),
    ).toBe(true);
    expect(needsAttention(row({ providerHealthy: false }))).toBe(true);
    expect(needsAttention(row({ openBlockers: 1 }))).toBe(true);
    expect(needsAttention(row({ coveragePct: 40 }))).toBe(false);
  });

  it("round-trips filters while preserving unrelated query parameters", () => {
    const filters = {
      ...EMPTY_FILTERS,
      query: "customer",
      area: "products_and_services_sold",
      interaction: "talks-to-customers",
      attentionOnly: true,
    };
    const params = filtersToSearchParams(
      filters,
      new URLSearchParams("tab=coworkers"),
    );

    expect(params.get("tab")).toBe("coworkers");
    expect(filtersFromSearchParams(params, valueSets)).toEqual(filters);
  });

  it("normalizes invalid closed-set URL filters and accepts Other", () => {
    const invalid = filtersFromSearchParams(
      new URLSearchParams(
        "area=imaginary&interaction=unknown&availability=ready&authority=owner&kind=wizard&family=legal&valueStream=build&competency=expert&jurisdiction=eu&lifecycle=draft",
      ),
      valueSets,
    );
    expect(invalid).toMatchObject({
      area: "",
      interaction: "",
      availability: "",
      authority: "",
      kind: "",
      family: "",
      valueStream: "",
      competency: "",
      jurisdiction: "",
      lifecycle: "",
    });

    expect(
      filtersFromSearchParams(
        new URLSearchParams("area=other"),
        valueSets,
      ).area,
    ).toBe("other");
  });

  it("accepts advanced URL filters only when the loaded roster exposes them", () => {
    const parsed = filtersFromSearchParams(
      new URLSearchParams(
        "family=finance&kind=specialist&valueStream=operate&competency=practitioner&jurisdiction=us&lifecycle=production",
      ),
      valueSets,
    );

    expect(parsed).toMatchObject({
      family: "finance",
      kind: "specialist",
      valueStream: "operate",
      competency: "practitioner",
      jurisdiction: "us",
      lifecycle: "production",
    });
  });
});

describe("safeRosterReturnTo", () => {
  it("accepts the exact roster route with query or fragment state", () => {
    expect(
      safeRosterReturnTo(
        "/platform/ai/overview?interaction=talks-to-customers#coworkers",
      ),
    ).toBe(
      "/platform/ai/overview?interaction=talks-to-customers#coworkers",
    );
  });

  it("rejects prefix lookalikes, external paths, and control characters", () => {
    for (const candidate of [
      "/platform/ai/overview-evil",
      "/platform/ai/overview/other",
      "//evil.example/platform/ai/overview",
      "/platform/ai/overview\\evil",
      "/platform/ai/overview\nother",
    ]) {
      expect(safeRosterReturnTo(candidate)).toBe("/platform/ai/overview");
    }
  });
});

describe("kindOptions", () => {
  it("returns the sorted distinct kinds present in the rows", () => {
    const rows = [
      row({ kind: "specialist" }),
      row({ kind: "orchestrator" }),
      row({ kind: "specialist" }),
      row({ kind: "advisor" }),
    ];
    expect(kindOptions(rows)).toEqual(["advisor", "orchestrator", "specialist"]);
  });

  it("returns an empty array for no rows", () => {
    expect(kindOptions([])).toEqual([]);
  });
});
