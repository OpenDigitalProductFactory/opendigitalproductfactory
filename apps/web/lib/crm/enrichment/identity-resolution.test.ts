import { describe, expect, it } from "vitest";

import {
  IDENTITY_MATCH_THRESHOLD,
  assessIdentity,
  normalizeDomain,
  resolveRecordAnchor,
  resolveResearchedAnchor,
  scoreIdentityMatch,
} from "./identity-resolution";
import type { EnrichmentFinding } from "./types";

describe("identity-resolution gate (BI-E2449835)", () => {
  it("normalizes domains (scheme/www/path/port stripped)", () => {
    expect(normalizeDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(normalizeDomain("acme.com:8080")).toBe("acme.com");
    expect(normalizeDomain("not a url")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });

  it("REGRESSION: a DOMAIN CONFLICT hard-blocks (same-named different company)", () => {
    const record = { name: "Acme IT", website: "https://acme-it.com" };
    const findings: EnrichmentFinding[] = [
      { field: "website", value: "https://acme-industrial.com", source: "web-search", sourceRef: "serp:1" },
      { field: "industry", value: "Manufacturing", source: "website", sourceRef: "https://acme-industrial.com" },
    ];
    const { match } = assessIdentity(record, findings);
    expect(match.verdict).toBe("conflict");
    expect(match.conflicts).toContain("domain");
    expect(match.score).toBe(0);
  });

  it("a matching domain is a strong agreement", () => {
    const record = { name: "Acme IT", website: "https://acme-it.com" };
    const findings: EnrichmentFinding[] = [
      { field: "website", value: "http://www.acme-it.com/contact", source: "website", sourceRef: "x" },
      { field: "industry", value: "IT Services", source: "website", sourceRef: "x" },
    ];
    const { match } = assessIdentity(record, findings);
    expect(match.verdict).toBe("agree");
    expect(match.agreements).toContain("domain");
    expect(match.score).toBeGreaterThanOrEqual(IDENTITY_MATCH_THRESHOLD);
  });

  it("name + location corroboration reaches 'agree' without a domain", () => {
    const record = { name: "TeamLogic IT of Round Rock", location: "Round Rock, TX" };
    const match = scoreIdentityMatch(resolveRecordAnchor(record), {
      domain: null,
      name: "TeamLogic IT of Round Rock",
      location: "Round Rock, Texas",
    });
    expect(match.agreements).toContain("name");
    expect(match.agreements).toContain("location");
    expect(match.verdict).toBe("agree");
  });

  it("a thin name-only record with only a name echo stays 'weak' (needs confirmation)", () => {
    const record = { name: "Northgate Systems" };
    const findings: EnrichmentFinding[] = [
      { field: "industry", value: "Consulting", source: "web-search", sourceRef: "serp:1" },
    ];
    const { match } = assessIdentity(record, findings);
    expect(match.verdict).toBe("weak");
    expect(match.score).toBeLessThan(IDENTITY_MATCH_THRESHOLD);
  });

  it("normalizes company suffixes when comparing names", () => {
    const match = scoreIdentityMatch({ domain: null, name: "Acme, Inc.", location: null }, { domain: null, name: "Acme Corporation", location: null });
    expect(match.agreements).toContain("name");
  });

  it("an explicit anchor overrides finding-derived domain", () => {
    const findings: EnrichmentFinding[] = [
      { field: "industry", value: "IT", source: "web-search", sourceRef: "x" },
    ];
    const anchor = resolveResearchedAnchor(findings, { domain: "acme.com", name: null, location: null });
    expect(anchor.domain).toBe("acme.com");
  });
});
