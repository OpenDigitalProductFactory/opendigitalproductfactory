import { describe, expect, it } from "vitest";

import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";

import { INITIATIVE_READINESS_LANES } from "./initiative-readiness-tool-grants";

// BI-38678404: record_initiative_evidence demanded initiative_evidence_write,
// agent_registry.json granted it to AGT-WS-BUILD and AGT-WS-PORTFOLIO, and
// HARDCODED_COWORKER_GRANTS — the durable source that re-seeds the database on
// every boot — carried it for nobody. The grant reverted at each restart, so an
// author could never record its own research receipt and delivered, merged,
// released work could not leave awaiting-acceptance on any install.
describe("author-reachable readiness lanes are provisioned to someone", () => {
  it("every non-independent lane grant is held by at least one coworker role", () => {
    const roleGrants = new Set(Object.values(HARDCODED_COWORKER_GRANTS).flatMap((grants) => [...grants]));
    const unprovisioned = Object.entries(INITIATIVE_READINESS_LANES)
      .filter(([, lane]) => !lane.independent)
      .map(([tool, lane]) => ({ tool, grant: lane.grant }))
      .filter(({ grant }) => !roleGrants.has(grant));

    // An independent lane is reviewer-only on purpose and is NOT asserted here:
    // a reviewer may legitimately be provisioned per install. A lane the AUTHOR
    // must reach has no such escape — if nobody holds it, the gate it guards is
    // unsatisfiable by construction.
    expect(unprovisioned).toEqual([]);
  });
});
