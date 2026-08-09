import { describe, expect, it } from "vitest";

import {
  fromAssuranceFinding,
  fromLintFinding,
  fromReviewFinding,
  fromSecurityCase,
  rollupFindings,
  sortFindingsBySeverity,
  type GovernanceFinding,
} from "./finding-contract";

describe("GovernanceFinding adapters (EP-8DC217EB BET-12)", () => {
  it("fromLintFinding keys by page+kind and folds severity", () => {
    const f = fromLintFinding({
      pageId: "p1",
      findingKind: "principle-unsourced",
      severity: "error",
      detail: { line: 3 },
    });
    expect(f).toMatchObject({
      source: "wiki-lint",
      key: "p1:principle-unsourced",
      severity: "high",
      status: "open",
      title: "principle-unsourced",
      count: 1,
    });
    expect(f.detail).toContain("line");
  });

  it("fromReviewFinding maps class→severity and preserves a complete action contract", () => {
    const conflict = fromReviewFinding({
      id: "rf-1",
      findingClass: "conflict",
      title: "Two stances disagree",
      detail: "…",
      count: 2,
      detailHref: "/coworker-decisions/decisions/d1",
      action: {
        kind: "navigate",
        label: "Review",
        href: "/coworker-decisions/decisions/d1",
        outcome: "Understand the conflict and continue in the owning workflow.",
      },
    });
    expect(conflict).toMatchObject({
      source: "decision-review",
      key: "rf-1",
      severity: "high",
      status: "conflict",
      count: 2,
      detailHref: "/coworker-decisions/decisions/d1",
      action: expect.objectContaining({ label: "Review" }),
    });
    expect(
      fromReviewFinding({
        id: "rf-2",
        findingClass: "gap",
        title: "t",
        detail: "d",
        count: 1,
        detailHref: null,
      }).severity,
    ).toBe("low");
    expect(
      fromReviewFinding({
        id: "rf-3",
        findingClass: "staleness",
        title: "t",
        detail: "d",
        count: 1,
        detailHref: null,
      }).severity,
    ).toBe("medium");
  });

  it("fails closed when an action lacks a label, destination, or promised outcome", () => {
    const finding = fromReviewFinding({
      id: "rf-incomplete",
      findingClass: "conflict",
      title: "Blocked decision",
      detail: "Missing context",
      count: 1,
      detailHref: "/coworker-decisions/decisions/DI-1",
      action: {
        kind: "navigate",
        label: "Review",
        href: "/coworker-decisions/decisions/DI-1",
        outcome: "   ",
      },
    });
    expect(finding.action).toBeNull();
  });

  it("fromAssuranceFinding passes the already-canonical policySeverity", () => {
    const f = fromAssuranceFinding({
      findingKey: "npm-audit:CVE-1",
      title: "vuln in left-pad",
      description: "high sev advisory",
      policySeverity: "critical",
      status: "open",
    });
    expect(f).toMatchObject({
      source: "assurance",
      key: "npm-audit:CVE-1",
      severity: "critical",
      status: "open",
      count: 1,
    });
  });

  it("fromSecurityCase folds case severity and carries the detection count", () => {
    const f = fromSecurityCase({
      caseKey: "case-abc",
      title: "Brute force burst",
      severity: "high",
      status: "new",
      detectionCount: 12,
      href: "/ops/security",
    });
    expect(f).toMatchObject({
      source: "security",
      key: "case-abc",
      severity: "high",
      status: "new",
      count: 12,
      detailHref: "/ops/security",
    });
  });

  it("an unknown case severity defaults to info (never throws)", () => {
    expect(fromSecurityCase({ caseKey: "c", title: "t", severity: "weird", status: "new" }).severity).toBe(
      "info",
    );
  });
});

describe("mixed-stream sort + rollup", () => {
  const findings: GovernanceFinding[] = [
    fromLintFinding({ pageId: "p", findingKind: "k", severity: "info", detail: {} }),
    fromAssuranceFinding({ findingKey: "a", title: "a", policySeverity: "critical", status: "open" }),
    fromSecurityCase({ caseKey: "c", title: "c", severity: "medium", status: "new" }),
  ];

  it("sortFindingsBySeverity orders most-severe-first across streams", () => {
    const sorted = sortFindingsBySeverity(findings);
    expect(sorted.map((f) => f.severity)).toEqual(["critical", "medium", "info"]);
  });

  it("rollupFindings counts by severity + source and finds the worst", () => {
    const r = rollupFindings(findings);
    expect(r.total).toBe(3);
    expect(r.worst).toBe("critical");
    expect(r.bySeverity.critical).toBe(1);
    expect(r.bySeverity.medium).toBe(1);
    expect(r.bySeverity.info).toBe(1);
    expect(r.bySource.assurance).toBe(1);
    expect(r.bySource["wiki-lint"]).toBe(1);
    expect(r.bySource.security).toBe(1);
  });
});
