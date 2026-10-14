import { describe, expect, it } from "vitest";
import { bodyCriteriaVersion, sameBodyCriteriaVersion } from "./body-baseline-version";

describe("immutable body criteria version", () => {
  it("versions the product-linked reproduction with its exact criteria and anchors", () => {
    const version = bodyCriteriaVersion("## Acceptance\n- AC-1: Canonical routes share authority.\n- AC-2: Revocations survive provisioning.");
    expect(version?.acceptanceStatements.map((entry) => entry.acceptanceId)).toEqual(["AC-BODY-001", "AC-BODY-002"]);
    expect(version?.acceptanceStatements.map((entry) => entry.artifactAnchor)).toEqual(["line:2", "line:3"]);
    expect(version?.criteria).toEqual(["Canonical routes share authority.", "Revocations survive provisioning."]);
  });
  it("retains one immutable version for identical retries", () => {
    const body = "## Acceptance\n- Verify canonical grants.";
    expect(sameBodyCriteriaVersion(bodyCriteriaVersion(body), body)).toBe(true);
  });
  it("invalidates changed criteria and changed line anchors", () => {
    const version = bodyCriteriaVersion("## Acceptance\n- Verify canonical grants.");
    expect(sameBodyCriteriaVersion(version, "## Acceptance\n- Verify unrelated grants.")).toBe(false);
    expect(sameBodyCriteriaVersion(version, "Intro\n## Acceptance\n- Verify canonical grants.")).toBe(false);
  });
  it("does not silently turn prose into criteria or retain removed criteria", () => {
    expect(bodyCriteriaVersion("Acceptance is important.")).toBeNull();
    expect(sameBodyCriteriaVersion(bodyCriteriaVersion("## Acceptance\n- Verify grants."), "No criteria")).toBe(false);
  });
  it("keeps the body bytes digest distinct from the criteria version", () => {
    const first = bodyCriteriaVersion("## Acceptance\n- Verify grants.\n\nNotes: one");
    const second = bodyCriteriaVersion("## Acceptance\n- Verify grants.\n\nNotes: two");
    expect(first?.bodyDigest).not.toBe(second?.bodyDigest);
    expect(first?.criteriaDigest).toBe(second?.criteriaDigest);
  });
});
