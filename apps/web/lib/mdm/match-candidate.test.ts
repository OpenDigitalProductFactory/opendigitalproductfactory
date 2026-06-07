import { describe, expect, it } from "vitest";

import {
  findMatchCandidates,
  scoreMatchCandidate,
  type MatchSubject,
} from "@/lib/mdm/match-candidate";
import {
  diceCoefficient,
  standardizeDomain,
  standardizeName,
  standardizePhone,
} from "@/lib/mdm/standardize";

describe("standardize", () => {
  it("normalizes company names (case, diacritics, legal suffix, punctuation)", () => {
    expect(standardizeName("Acme, Inc.")).toBe("acme");
    expect(standardizeName("ACME Corporation")).toBe("acme");
    expect(standardizeName("Café Ltd")).toBe("cafe");
    expect(standardizeName("Foo & Bar LLC")).toBe("foo and bar");
  });

  it("reduces URLs to a bare host", () => {
    expect(standardizeDomain("https://www.Acme.com/contact?x=1")).toBe("acme.com");
    expect(standardizeDomain("acme.com")).toBe("acme.com");
  });

  it("normalizes phone numbers to digits with + (00 → +)", () => {
    expect(standardizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(standardizePhone("0044 20 7946 0000")).toBe("+442079460000");
  });

  it("dice coefficient is 1 for equal and lower for typos", () => {
    expect(diceCoefficient("acme", "acme")).toBe(1);
    expect(diceCoefficient("california", "calfornia")).toBeGreaterThan(0.8);
    expect(diceCoefficient("acme", "globex")).toBeLessThan(0.3);
  });
});

describe("scoreMatchCandidate", () => {
  it("flags a likely duplicate when the web domain matches exactly", () => {
    const a: MatchSubject = { id: "1", name: "Acme Inc", website: "https://acme.com" };
    const b: MatchSubject = { id: "2", name: "ACME Corporation", domain: "www.acme.com" };
    const result = scoreMatchCandidate(a, b);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.recommendation).toBe("likely-duplicate");
    expect(result.reasons.map((r) => r.attribute)).toContain("domain");
  });

  it("treats unrelated records as distinct", () => {
    const a: MatchSubject = { id: "1", name: "Acme Inc", website: "acme.com" };
    const b: MatchSubject = { id: "2", name: "Globex LLC", website: "globex.io" };
    const result = scoreMatchCandidate(a, b);
    expect(result.recommendation).toBe("distinct");
    expect(result.score).toBeLessThan(0.5);
  });

  it("surfaces a possible duplicate when normalized names match exactly (legal suffix dropped)", () => {
    const a: MatchSubject = { id: "1", name: "Northwind Trading Company" };
    const b: MatchSubject = { id: "2", name: "Northwind Trading Co." };
    const result = scoreMatchCandidate(a, b);
    // "company" and "co" are legal suffixes → both normalize to "northwind trading"
    expect(result.score).toBeGreaterThanOrEqual(0.45);
    expect(result.recommendation).toBe("possible-duplicate");
  });

  it("surfaces a possible duplicate on a shared email alone", () => {
    const a: MatchSubject = { id: "1", name: "Jane at Acme", email: "Jane@Acme.com" };
    const b: MatchSubject = { id: "2", name: "J. Doe", email: "jane@acme.com" };
    const result = scoreMatchCandidate(a, b);
    expect(result.reasons.map((r) => r.attribute)).toContain("email");
    expect(result.recommendation).not.toBe("distinct");
  });

  it("never returns a score above 1 even when every signal matches", () => {
    const subject: MatchSubject = {
      id: "1",
      name: "Acme",
      website: "acme.com",
      email: "ar@acme.com",
      phone: "+1 415 555 0100",
    };
    const result = scoreMatchCandidate(subject, { ...subject, id: "2" });
    expect(result.score).toBe(1);
    expect(result.recommendation).toBe("likely-duplicate");
  });
});

describe("findMatchCandidates", () => {
  it("excludes self, drops distinct records, and ranks by score", () => {
    const subject: MatchSubject = { id: "1", name: "Acme Inc", website: "acme.com" };
    const pool: MatchSubject[] = [
      subject,
      { id: "2", name: "ACME Corp", domain: "acme.com" }, // likely (domain + name)
      { id: "3", name: "Acme", email: "x@acme.io" }, // weaker (name only)
      { id: "4", name: "Globex", website: "globex.io" }, // distinct
    ];
    const candidates = findMatchCandidates(subject, pool);
    const ids = candidates.map((c) => c.candidate.id);
    expect(ids).not.toContain("1");
    expect(ids).not.toContain("4");
    expect(ids[0]).toBe("2"); // highest score first
    expect(candidates[0].result.score).toBeGreaterThanOrEqual(candidates[candidates.length - 1].result.score);
  });
});
