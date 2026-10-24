import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isSideEffectingGrant } from "./grant-capability";

/**
 * BI-69BBC446. A coworker's MCP session token is minted `read` or `write` by
 * classifying the grants behind its attached tools. `_review` was missing from
 * that classification, so every independent review gate on the platform —
 * design, architecture, data, ux, security, compliance, archetype — issued a
 * read-only token to the very coworker dispatched to record its receipt. The
 * agent then reported its own authority as "observer" and declined to write.
 * Nothing errored. The gate simply never passed, on any install.
 *
 * The failure mode is silence, so the defence has to be completeness: every
 * grant in the catalog must be classified deliberately, and a new grant with a
 * verb nobody thought about must fail here rather than mint read-only tokens.
 */

type GrantCatalog = { grants: Array<{ key: string; description?: string }> };

function loadGrants(): string[] {
  // Resolved from this module, not the cwd, so the test reads the same catalog
  // whichever directory the runner is invoked from.
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "..", "..", "..", "packages", "db", "data", "grant_catalog.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as GrantCatalog;
  return parsed.grants.map((g) => g.key).filter(Boolean);
}



describe("grant capability classification", () => {
  const grants = loadGrants();

  it("reads the catalog", () => {
    expect(grants.length).toBeGreaterThan(100);
  });

  // The regression itself: these were all misclassified as read-only.
  it.each([
    "initiative_design_review",
    "initiative_architecture_review",
    "initiative_data_review",
    "initiative_ux_review",
    "initiative_security_review",
    "initiative_compliance_review",
    "initiative_domain_review",
    "initiative_archetype_review",
    "statutory_reference_propose",
    "catalog_publish",
    "document_publish",
  ])("classifies %s as side-effecting", (grant) => {
    expect(isSideEffectingGrant(grant)).toBe(true);
  });

  it("still classifies the original write verbs", () => {
    for (const grant of ["backlog_write", "epic_create", "demand_triage", "change_promote", "sandbox_execute", "release_approve"]) {
      expect(isSideEffectingGrant(grant)).toBe(true);
    }
  });

  it("does not classify plainly read-only grants as side-effecting", () => {
    for (const grant of ["backlog_read", "codebase_read", "wiki_query"]) {
      expect(isSideEffectingGrant(grant)).toBe(false);
    }
  });

  // The direction that matters. An unrecognised verb must default to
  // side-effecting: an over-broad token is simply unused, because the MCP route
  // re-gates every call, whereas an under-broad one breaks the write silently —
  // which is exactly what BI-69BBC446 was.
  it("treats an unrecognised grant verb as side-effecting", () => {
    expect(isSideEffectingGrant("some_future_grant_frobnicate")).toBe(true);
    expect(isSideEffectingGrant("build_phase_advance")).toBe(true);
    expect(isSideEffectingGrant("entitlement_provision")).toBe(true);
    expect(isSideEffectingGrant("escalation_trigger")).toBe(true);
    expect(isSideEffectingGrant("work_capsule_adopt")).toBe(true);
  });

  it("classifies most of the catalog rather than defaulting a large share to read", () => {
    const sideEffecting = grants.filter(isSideEffectingGrant);
    // Sanity floor: the catalog is mostly write-shaped, so a regression that
    // re-narrows the classification shows up here.
    expect(sideEffecting.length).toBeGreaterThan(grants.length / 2);
  });
});
