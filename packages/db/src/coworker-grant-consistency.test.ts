import { describe, it, expect } from "vitest";
import { HARDCODED_COWORKER_GRANTS } from "./workforce-seed";
import { findGrantDivergences, KNOWN_GRANT_DIVERGENCES } from "./coworker-grant-consistency";
import registry from "../data/agent_registry.json";

const AGENTS = (registry as { agents?: unknown[] }).agents ?? [];

describe("coworker grant-source consistency (EP-E431FC8A Phase 4, BI-17ACD329)", () => {
  const divergences = findGrantDivergences(HARDCODED_COWORKER_GRANTS, AGENTS as never);

  it("has no NEW grant-source divergence beyond the founder-tracked known set", () => {
    // Ratchet: a NEW diverging agent fails here and must be reconciled; fixing an
    // existing one means removing it from KNOWN_GRANT_DIVERGENCES. Either way the
    // DB-seed-vs-JSON drift stays visible and governed, never silently growing.
    const current = divergences.map((d) => d.agentId).sort();
    expect(current).toEqual([...KNOWN_GRANT_DIVERGENCES].sort());
  });

  it("reports concrete per-agent drift (grants unique to each source)", () => {
    // Sanity: each tracked divergence names at least one grant unique to a side,
    // so the record is actionable for founder reconciliation.
    for (const d of divergences) {
      expect(d.onlyInSeed.length + d.onlyInRegistry.length).toBeGreaterThan(0);
    }
  });
});
