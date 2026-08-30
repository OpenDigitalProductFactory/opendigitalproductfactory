import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PROFESSION_JURISDICTIONS } from "@dpf/db/wiki-taxonomy";

import {
  EMPLOYMENT_JURISDICTION_BASIS,
  describeUnresolvedEmploymentJurisdiction,
  employmentPolicyKey,
  resolveEmploymentJurisdiction,
  type EmploymentJurisdictionResolution,
  type UnresolvedJurisdictionReason,
} from "./employment-jurisdiction";

const locationNameOf = (id: string) => `location ${id}`;

function unresolved(
  resolution: EmploymentJurisdictionResolution,
): Extract<EmploymentJurisdictionResolution, { resolved: false }> {
  if (resolution.resolved) throw new Error("expected an unresolved resolution");
  return resolution;
}

describe("resolveEmploymentJurisdiction", () => {
  it("resolves a declared location jurisdiction the organisation employs in", () => {
    const resolution = resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-1", jurisdictionSlug: "us" } },
      ["us", "uk"],
    );

    expect(resolution).toEqual({
      resolved: true,
      jurisdiction: "us",
      basis: "employing",
      workLocationId: "loc-1",
    });
  });

  it("does not filter when the organisation has declared no employing jurisdictions", () => {
    // An empty set means undeclared, matching the no-regression rule the
    // regional profile already sets for every other basis.
    const resolution = resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-1", jurisdictionSlug: "eu" } },
      [],
    );

    expect(resolution.resolved).toBe(true);
  });

  describe("fails loudly, naming the reason", () => {
    it("no-work-location", () => {
      expect(unresolved(resolveEmploymentJurisdiction({ workLocation: null }, ["us"]))).toEqual({
        resolved: false,
        reason: "no-work-location",
        workLocationId: null,
        declaredValue: null,
      });
    });

    it("no-work-location when the field is absent entirely", () => {
      expect(unresolved(resolveEmploymentJurisdiction({}, ["us"])).reason).toBe("no-work-location");
    });

    it("location-without-jurisdiction", () => {
      expect(
        unresolved(
          resolveEmploymentJurisdiction(
            { workLocation: { id: "loc-2", jurisdictionSlug: null } },
            ["us"],
          ),
        ),
      ).toEqual({
        resolved: false,
        reason: "location-without-jurisdiction",
        workLocationId: "loc-2",
        declaredValue: null,
      });
    });

    it("jurisdiction-not-recognised for a value outside the closed vocabulary", () => {
      // Reachable because the column is a String rather than a Prisma enum, so
      // it is handled rather than assumed away.
      expect(
        unresolved(
          resolveEmploymentJurisdiction(
            { workLocation: { id: "loc-3", jurisdictionSlug: "canada" } },
            ["us"],
          ),
        ),
      ).toEqual({
        resolved: false,
        reason: "jurisdiction-not-recognised",
        workLocationId: "loc-3",
        declaredValue: "canada",
      });
    });

    it("jurisdiction-not-in-employs-in", () => {
      expect(
        unresolved(
          resolveEmploymentJurisdiction(
            { workLocation: { id: "loc-4", jurisdictionSlug: "eu" } },
            ["us"],
          ),
        ),
      ).toEqual({
        resolved: false,
        reason: "jurisdiction-not-in-employs-in",
        workLocationId: "loc-4",
        declaredValue: "eu",
      });
    });
  });

  it("never silently defaults to global (AC-ELA-003)", () => {
    // `global` is a real member of the vocabulary, so a policy lookup against it
    // would SUCCEED and return the permissive floor. Every unresolvable input
    // must therefore stay unresolved rather than fall through to it.
    const unresolvableInputs = [
      { workLocation: null },
      { workLocation: { id: "l", jurisdictionSlug: null } },
      { workLocation: { id: "l", jurisdictionSlug: "canada" } },
      { workLocation: { id: "l", jurisdictionSlug: "eu" } },
    ];

    for (const input of unresolvableInputs) {
      const resolution = resolveEmploymentJurisdiction(input, ["us"]);
      expect(resolution.resolved).toBe(false);
      expect(JSON.stringify(resolution)).not.toContain("global");
    }
  });

  it("resolves global only when a location actually declares it", () => {
    const resolution = resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-5", jurisdictionSlug: "global" } },
      ["global"],
    );

    expect(resolution).toMatchObject({ resolved: true, jurisdiction: "global" });
  });

  it("accepts every slug in the closed vocabulary and nothing else", () => {
    for (const slug of PROFESSION_JURISDICTIONS) {
      const resolution = resolveEmploymentJurisdiction(
        { workLocation: { id: "loc", jurisdictionSlug: slug } },
        [],
      );
      expect(resolution).toMatchObject({ resolved: true, jurisdiction: slug });
    }

    for (const slug of ["", "US", "us-ca", "canada", "worldwide"]) {
      const resolution = resolveEmploymentJurisdiction(
        { workLocation: { id: "loc", jurisdictionSlug: slug } },
        [],
      );
      expect(resolution.resolved).toBe(false);
    }
  });
});

describe("the column the resolver reads", () => {
  const workforceSchema = readFileSync(
    fileURLToPath(new URL("../../../../packages/db/prisma/schema/workforce.prisma", import.meta.url)),
    "utf8",
  );

  // Scoped to the WorkLocation block on purpose. WorkerClassificationDetermination
  // carries a jurisdictionSlug of its own (BI-C61CEEA9), so a whole-file match
  // would pass with this change reverted.
  const workLocationBlock = (() => {
    const match = /^model WorkLocation \{$[\s\S]*?^\}$/m.exec(workforceSchema);
    if (!match) throw new Error("model WorkLocation not found in workforce.prisma");
    return match[0];
  })();

  it("declares WorkLocation.jurisdictionSlug as a nullable String", () => {
    // Nullable is the whole posture: an undeclared jurisdiction must be an
    // honest unresolved state, not a value the schema forces someone to invent.
    expect(workLocationBlock).toMatch(/jurisdictionSlug\s+String\?/);
  });

  it("keeps the column a String rather than a Prisma enum (AC-ELA-004)", () => {
    // An enum would be a THIRD representation of a vocabulary that already lives
    // as a String on Organization.employsIn and RegulatoryAutonomyPolicy
    // .jurisdiction, and it would need casting at every policy lookup — the
    // translation layer this acceptance criterion forbids.
    expect(workLocationBlock).not.toMatch(/jurisdictionSlug\s+ProfessionJurisdiction/);
    expect(workforceSchema).not.toMatch(/enum\s+ProfessionJurisdiction\b/);
  });

  it("indexes the column, because the control looks workers up by jurisdiction", () => {
    expect(workLocationBlock).toContain("@@index([jurisdictionSlug])");
  });
});

describe("employmentPolicyKey — AC-ELA-004, no translation layer", () => {
  it("presents the resolved slug verbatim as the policy jurisdiction key", () => {
    const resolution = resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-1", jurisdictionSlug: "uk" } },
      ["uk"],
    );
    if (!resolution.resolved) throw new Error("expected resolved");

    // The key IS the slug. Not mapped, not normalised, not looked up.
    expect(employmentPolicyKey(resolution)).toEqual({
      jurisdiction: "uk",
      jurisdictionBasis: "employing",
    });
    expect(employmentPolicyKey(resolution).jurisdiction).toBe(resolution.jurisdiction);
  });

  it("resolves under the employing basis, not operating or selling", () => {
    // Employment law keys off where the work is DONE. Reading this answer under
    // any other basis silently asks a different question.
    expect(EMPLOYMENT_JURISDICTION_BASIS).toBe("employing");
  });

  it("produces a key a RegulatoryAutonomyPolicy row can be matched on directly", () => {
    // The policy spine stores jurisdiction and jurisdictionBasis as plain
    // strings on the SAME vocabulary. A row seeded for the resolved worker
    // matches on equality with no adapter between the two.
    const resolution = resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-1", jurisdictionSlug: "us" } },
      ["us"],
    );
    if (!resolution.resolved) throw new Error("expected resolved");

    const policyRow = {
      jurisdiction: "us",
      jurisdictionBasis: "employing",
      activityClass: "worker-direction",
    };
    const key = employmentPolicyKey(resolution);

    expect(policyRow.jurisdiction).toBe(key.jurisdiction);
    expect(policyRow.jurisdictionBasis).toBe(key.jurisdictionBasis);
  });
});

describe("describeUnresolvedEmploymentJurisdiction", () => {
  const CASES: Record<UnresolvedJurisdictionReason, EmploymentJurisdictionResolution> = {
    "no-work-location": resolveEmploymentJurisdiction({ workLocation: null }, ["us"]),
    "location-without-jurisdiction": resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-2", jurisdictionSlug: null } },
      ["us"],
    ),
    "jurisdiction-not-recognised": resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-3", jurisdictionSlug: "canada" } },
      ["us"],
    ),
    "jurisdiction-not-in-employs-in": resolveEmploymentJurisdiction(
      { workLocation: { id: "loc-4", jurisdictionSlug: "eu" } },
      ["us"],
    ),
  };

  it("names an operator action for every unresolved reason", () => {
    for (const reason of Object.keys(CASES) as UnresolvedJurisdictionReason[]) {
      const message = describeUnresolvedEmploymentJurisdiction(
        unresolved(CASES[reason]),
        "Dana Okafor",
        locationNameOf,
      );

      expect(message.length).toBeGreaterThan(0);
      // Every message must tell the operator what to DO, not just what is wrong.
      expect(message).toMatch(/\b(Set|add|move|Either)\b/);
    }
  });

  it("names the worker when the problem is the worker's own record", () => {
    expect(
      describeUnresolvedEmploymentJurisdiction(
        unresolved(CASES["no-work-location"]),
        "Dana Okafor",
        locationNameOf,
      ),
    ).toContain("Dana Okafor");
  });

  it("names the offending value so the operator can correct it", () => {
    expect(
      describeUnresolvedEmploymentJurisdiction(
        unresolved(CASES["jurisdiction-not-recognised"]),
        "Dana Okafor",
        locationNameOf,
      ),
    ).toContain("canada");
  });
});
