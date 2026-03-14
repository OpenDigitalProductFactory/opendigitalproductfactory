import { describe, expect, it } from "vitest";

import {
  buildNormalizationRuleCandidate,
  normalizeSoftwareEvidence,
  type SoftwareIdentityCandidate,
  type SoftwareNormalizationRuleInput,
} from "./software-normalization";

const postgresIdentity: SoftwareIdentityCandidate = {
  id: "identity-postgres",
  normalizedVendor: "PostgreSQL Global Development Group",
  normalizedProductName: "PostgreSQL",
  aliases: ["postgres", "postgresql"],
};

const dockerDesktopIdentity: SoftwareIdentityCandidate = {
  id: "identity-docker-desktop",
  normalizedVendor: "Docker",
  normalizedProductName: "Docker Desktop",
  normalizedEdition: "Community",
  aliases: ["docker desktop", "docker community"],
};

const identities: SoftwareIdentityCandidate[] = [
  postgresIdentity,
  {
    ...dockerDesktopIdentity,
  },
];

const rules: SoftwareNormalizationRuleInput[] = [
  {
    ruleKey: "package:postgresql",
    matchType: "package_name",
    rawSignature: "postgresql",
    source: "bootstrap_registry",
    softwareIdentity: postgresIdentity,
  },
];

describe("normalizeSoftwareEvidence", () => {
  it("uses deterministic rules when a package alias is known", () => {
    const result = normalizeSoftwareEvidence(
      {
        evidenceKey: "host:pkg:postgresql-16",
        evidenceSource: "host_packages",
        rawPackageName: "postgresql-16",
        rawVersion: "16.3-1",
      },
      identities,
      rules,
    );

    expect(result.normalizationStatus).toBe("normalized");
    expect(result.method).toBe("rule");
    expect(result.identity?.normalizedProductName).toBe("PostgreSQL");
    expect(result.identity?.canonicalVersion).toBe("16.3");
    expect(result.confidence).toBeGreaterThan(0.95);
  });

  it("uses heuristic matching for noisy software names", () => {
    const result = normalizeSoftwareEvidence(
      {
        evidenceKey: "host:app:docker-desktop",
        evidenceSource: "installed_software",
        rawProductName: "Docker Desktop Community Edition",
        rawVersion: "4.38.0 (181591)",
      },
      identities,
      rules,
    );

    expect(result.normalizationStatus).toBe("normalized");
    expect(result.method).toBe("heuristic");
    expect(result.identity?.normalizedProductName).toBe("Docker Desktop");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("keeps unresolved software evidence reviewable", () => {
    const result = normalizeSoftwareEvidence(
      {
        evidenceKey: "host:pkg:mystery-engine",
        evidenceSource: "host_packages",
        rawPackageName: "mystery-engine-build-123",
        rawVersion: "2026.03",
      },
      identities,
      rules,
    );

    expect(result.normalizationStatus).toBe("needs_review");
    expect(result.identity).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});

describe("buildNormalizationRuleCandidate", () => {
  it("synthesizes a deterministic rule candidate from an approved heuristic match", () => {
    const result = normalizeSoftwareEvidence(
      {
        evidenceKey: "host:app:docker-desktop",
        evidenceSource: "installed_software",
        rawProductName: "Docker Desktop Community Edition",
        rawVersion: "4.38.0 (181591)",
      },
      identities,
      rules,
    );

    const ruleCandidate = buildNormalizationRuleCandidate(
      {
        rawProductName: "Docker Desktop Community Edition",
        rawPackageName: null,
      },
      result,
      "local_llm",
    );

    expect(ruleCandidate).toMatchObject({
      matchType: "product_name",
      rawSignature: "docker desktop community edition",
      source: "local_llm",
    });
    expect(ruleCandidate.ruleKey).toContain("docker-desktop-community-edition");
  });
});
