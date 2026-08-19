import { describe, it, expect } from "vitest";
import {
  parseRepoCoords,
  classifyEgress,
  CANONICAL_UPSTREAM_OWNER,
  CANONICAL_UPSTREAM_REPO,
  HIVE_RESULT_BUNDLE_SCHEMA_VERSION,
  projectHiveResultBundle,
} from "./contribution-egress";

describe("parseRepoCoords", () => {
  it("parses HTTPS and SSH GitHub URLs", () => {
    expect(parseRepoCoords("https://github.com/acme/portal.git")).toEqual({ owner: "acme", repo: "portal" });
    expect(parseRepoCoords("git@github.com:acme/portal.git")).toEqual({ owner: "acme", repo: "portal" });
  });
  it("returns null for non-GitHub or empty input", () => {
    expect(parseRepoCoords("https://gitlab.com/acme/portal")).toBeNull();
    expect(parseRepoCoords(null)).toBeNull();
    expect(parseRepoCoords(undefined)).toBeNull();
  });
});

describe("classifyEgress", () => {
  const upstream = "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";

  it("classifies the configured upstream as public-hive", () => {
    expect(classifyEgress({ owner: "acme", repo: "dpf-fork" }, "https://github.com/acme/dpf-fork.git"))
      .toBe("public-hive");
  });

  it("classifies the canonical DPF upstream as public-hive even when upstream is customized", () => {
    expect(classifyEgress({ owner: CANONICAL_UPSTREAM_OWNER, repo: CANONICAL_UPSTREAM_REPO }, "https://github.com/acme/private.git"))
      .toBe("public-hive");
  });

  it("classifies the canonical DPF upstream as public-hive when upstream is unset", () => {
    expect(classifyEgress({ owner: CANONICAL_UPSTREAM_OWNER, repo: CANONICAL_UPSTREAM_REPO }, null))
      .toBe("public-hive");
  });

  it("classifies a customer's own repo as own-repo (unfiltered home)", () => {
    expect(classifyEgress({ owner: "acme", repo: "our-private-portal" }, upstream)).toBe("own-repo");
  });

  it("is case-insensitive on owner/repo", () => {
    expect(classifyEgress({ owner: "opendigitalproductfactory", repo: "OpenDigitalProductFactory" }, null))
      .toBe("public-hive");
  });
});

describe("projectHiveResultBundle", () => {
  it("keeps reviewable results, evidence, provenance, attribution, and an opaque receipt", () => {
    const result = projectHiveResultBundle({
      schemaVersion: HIVE_RESULT_BUNDLE_SCHEMA_VERSION,
      result: { commit: { sha: "abc123" }, pullRequest: { url: "https://github.com/acme/repo/pull/1" } },
      evidence: { tests: [{ name: "unit", status: "passed" }], verification: [{ digest: "sha256:ok" }] },
      provenance: { dcoSignoffs: ["Developer <dev@example.test>"], licenseRefs: ["Apache-2.0"] },
      attribution: { mode: "organization", contributorRef: "org_opaque" },
      review: { questions: ["Does this preserve compatibility?"] },
      disposition: { status: "submitted" },
      sourceReceipt: "receipt_opaque_random",
    });

    expect(result.violations).toEqual([]);
    expect(result.projected).toMatchObject({
      schemaVersion: "dpf.hive-result/1",
      result: { commit: { sha: "abc123" } },
      sourceReceipt: "receipt_opaque_random",
    });
  });

  it("removes and reports local backlog, work-capsule, planning, and customer context at any depth", () => {
    const result = projectHiveResultBundle({
      schemaVersion: HIVE_RESULT_BUNDLE_SCHEMA_VERSION,
      result: {
        commit: { sha: "abc123", backlogItemId: "BI-PRIVATE" },
        workCapsule: { id: "WC-PRIVATE" },
      },
      evidence: {
        tests: [{ name: "unit", status: "passed", customerContext: "Private Customer" }],
        buildPlan: "private plan",
      },
      provenance: { dcoSignoffs: [] },
      priority: "urgent",
      estimate: 13,
      discussion: "private rationale",
      roadmap: ["unsubmitted"],
    });

    const serialized = JSON.stringify(result.projected);
    expect(serialized).toContain("abc123");
    expect(serialized).not.toContain("BI-PRIVATE");
    expect(serialized).not.toContain("WC-PRIVATE");
    expect(serialized).not.toContain("Private Customer");
    expect(serialized).not.toContain("private plan");
    expect(result.violations).toEqual(expect.arrayContaining([
      "forbidden-field:result.commit.backlogItemId",
      "forbidden-field:result.workCapsule",
      "forbidden-field:evidence.tests[0].customerContext",
      "forbidden-field:evidence.buildPlan",
      "non-allowed-field:priority",
      "non-allowed-field:estimate",
      "non-allowed-field:discussion",
      "non-allowed-field:roadmap",
    ]));
  });
});
