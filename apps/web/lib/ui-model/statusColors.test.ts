import { describe, expect, it } from "vitest";

// Import from the prisma-free subpath, NOT the @dpf/db root: the root re-exports
// the prisma client, and a value import of it pulls the server graph into this
// jsdom unit-test shard (which then fails to load). portfolio-sources/types.ts is
// a pure string-enum module with zero imports. The subpath name mirrors the file
// path so the vitest generic alias (@dpf/db/(.+) -> src/$1.ts) resolves it without
// a bespoke alias entry. (BI-5B2F5447)
import { PORTFOLIO_COVERAGE_STATUSES } from "@dpf/db/portfolio-sources/types";

import {
  intentStyle,
  resolveIntent,
  STATUS_INTENT,
  type Intent,
} from "./statusColors";

const ALL_INTENTS: Intent[] = [
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
  "accent",
];

describe("statusColors", () => {
  it("maps every intent to --dpf-* tokens (no raw hex)", () => {
    for (const intent of ALL_INTENTS) {
      const style = intentStyle(intent);
      expect(style.fg).toMatch(/var\(--dpf-/);
      expect(style.border).toMatch(/var\(--dpf-/);
      expect(style.fg).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it("derives soft backgrounds via color-mix for non-neutral intents", () => {
    expect(intentStyle("success").softBg).toContain("color-mix");
    // neutral uses a surface token, not a tint
    expect(intentStyle("neutral").softBg).toBe("var(--dpf-surface-2)");
  });

  it("every registered status resolves to a valid intent", () => {
    for (const [domain, map] of Object.entries(STATUS_INTENT)) {
      for (const status of Object.keys(map)) {
        expect(ALL_INTENTS).toContain(resolveIntent(domain, status));
      }
    }
  });

  it("falls back to neutral for unknown domain or status", () => {
    expect(resolveIntent("nope", "whatever")).toBe("neutral");
    expect(resolveIntent("finance", "not-a-status")).toBe("neutral");
  });

  it("maps known finance + complaint statuses to expected intents", () => {
    expect(resolveIntent("finance", "overdue")).toBe("danger");
    expect(resolveIntent("finance", "paid")).toBe("success");
    expect(resolveIntent("aiFinanceWork", "browser_profile_needed")).toBe("warning");
    expect(resolveIntent("complaintSeverity", "critical")).toBe("danger");
    expect(resolveIntent("complaintStatus", "resolved")).toBe("success");
  });

  it("keeps Edge health and trust as separate shared status domains", () => {
    expect(resolveIntent("edgeHealth", "healthy")).toBe("success");
    expect(resolveIntent("edgeHealth", "offline")).toBe("danger");
    expect(resolveIntent("edgeTrust", "trusted")).toBe("success");
    expect(resolveIntent("edgeTrust", "quarantined")).toBe("danger");
  });

  it("maps owner decision impact tags through the shared intent registry", () => {
    expect(resolveIntent("ownerDecisionImpact", "money")).toBe("warning");
    expect(resolveIntent("ownerDecisionImpact", "public")).toBe("danger");
    expect(resolveIntent("ownerDecisionImpact", "reversible")).toBe("info");
    expect(resolveIntent("ownerDecisionImpact", "deadline")).toBe("warning");
  });

  it("maps marketing lifecycle statuses to operational intents", () => {
    expect(resolveIntent("marketing", "draft")).toBe("neutral");
    expect(resolveIntent("marketing", "pending-review")).toBe("warning");
    expect(resolveIntent("marketing", "approved")).toBe("success");
    expect(resolveIntent("marketing", "rejected")).toBe("danger");
  });

  it("maps self-upgrade run statuses to operational intents", () => {
    expect(resolveIntent("selfUpgradeRun", "queued")).toBe("info");
    expect(resolveIntent("selfUpgradeRun", "running")).toBe("accent");
    expect(resolveIntent("selfUpgradeRun", "succeeded")).toBe("success");
    expect(resolveIntent("selfUpgradeRun", "failed")).toBe("danger");
    expect(resolveIntent("selfUpgradeRun", "skipped")).toBe("neutral");
  });

  it("maps archetype readiness tiers and evidence statuses", () => {
    expect(resolveIntent("archetypeReadinessTier", "template-ready")).toBe("info");
    expect(resolveIntent("archetypeReadinessTier", "sole-platform-ready")).toBe("success");
    expect(resolveIntent("archetypeReadinessEvidence", "required")).toBe("warning");
    expect(resolveIntent("archetypeReadinessEvidence", "merged")).toBe("success");
  });

  it("maps Work Room state, outcome health, and activity through shared domains", () => {
    expect(resolveIntent("workroom", "working")).toBe("accent");
    expect(resolveIntent("workroom", "blocked")).toBe("danger");
    expect(resolveIntent("workroom", "complete")).toBe("success");
    expect(resolveIntent("workCaseState", "waiting-on-person")).toBe("warning");
    expect(resolveIntent("workroomOutcomeHealth", "at-risk")).toBe("warning");
    expect(resolveIntent("workroomActivity", "message")).toBe("neutral");
    expect(resolveIntent("workroomActivity", "decision-resolved")).toBe("success");
  });

  // BI-5B2F5447 (D0): the portfolioCoverage badge map is the render side of the
  // PORTFOLIO_COVERAGE_STATUSES enum in @dpf/db. A coverage status with no explicit
  // intent falls through resolveIntent to "neutral" and reads wrong on the coverage
  // surface. Lock the two sides together so adding a status without a render intent
  // fails CI — the same class of parity guard as the projector's source↔portfolio check.
  it("gives every portfolio coverage status an explicit (non-fallback) badge intent", () => {
    for (const status of PORTFOLIO_COVERAGE_STATUSES) {
      expect(
        STATUS_INTENT.portfolioCoverage[status],
        `coverage status "${status}" has no portfolioCoverage badge intent — it would render neutral`,
      ).toBeDefined();
    }
    // The value this guard was written for.
    expect(resolveIntent("portfolioCoverage", "incumbent")).toBe("warning");
  });
});
