// Seed-integrity guard (BI-6A1BFE77): no dual-seed alias may render beside its
// AGT-* twin. The collapse map (COWORKER_SLUG_TO_CANONICAL_AGENT_ID) is
// belt-and-suspenders that must be MANUALLY maintained — a new coworker seeded
// in both its AGT-* form and its slug form whose slug was never added to the map
// renders TWICE in the roster (exactly what UX Design Critic did:
// AGT-906 + ux-design-critic, both "UX Design Critic", until the map entry
// landed). This guard runs the pure detector against the SEEDED workforce, so a
// future uncovered pair fails the build instead of silently duplicating.
//
// Runs where the workforce is seeded (the CI Unit Tests job migrates + seeds the
// DB). Skips cleanly when no seeded workforce is reachable (a source-only or
// empty local DB) so it never fails for the wrong reason.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { uncoveredDualSeedDisplayNames } from "./selectable-coworker";

const DATABASE_URL = process.env.DATABASE_URL;

type AgentRow = {
  agentId: string;
  displayName: string;
  status: string;
  lifecycleStage: string;
};

let client: pg.Client | undefined;
let agents: AgentRow[] = [];
let seeded = false;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query(
      `SELECT "agentId", "displayName", "status", "lifecycleStage" FROM "Agent"`,
    );
    agents = res.rows as AgentRow[];
    // "Seeded" = the workforce is present. A handful of dual-seed twins is the
    // whole point; an empty table means nothing to guard (skip).
    seeded = agents.length > 0;
  } catch {
    seeded = false;
  }
});

afterAll(async () => {
  await client?.end().catch(() => {});
});

describe("dual-seed alias coverage against the seeded workforce (BI-6A1BFE77)", () => {
  it("no active/production coworker renders as a visible duplicate of its twin", (ctx) => {
    if (!seeded) ctx.skip();
    const uncovered = uncoveredDualSeedDisplayNames(agents);
    expect(
      uncovered,
      uncovered.length
        ? `Uncovered dual-seed pair(s) will render twice in the roster: ${uncovered.join(", ")}. ` +
            `Add the alias slug → canonical AGT-* mapping to ` +
            `COWORKER_SLUG_TO_CANONICAL_AGENT_ID in packages/db/src/agent-identity.ts.`
        : undefined,
    ).toEqual([]);
  });
});
