// GPP Phase 2, PR-G — the real permit store's use count under concurrency,
// against PostgreSQL.
//
// consumePermit is one conditional UPDATE guarded by "useCount" < maxUses.
// Many concurrent calls for one single-use permit must report exactly one
// winner and leave useCount at 1. Runs where DATABASE_URL points at a
// reachable, migrated database (CI's web shards); skipped otherwise, on the
// pattern of lib/deliberation/consensus.persistence.test.ts.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-G).
import net from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PermitClaims } from "./permit-claims";
import type { GppPermitStore } from "./permit-store";

const PERMIT_ID = `GPM-pg-concurrency-test-${process.pid}`;

describe.skipIf(!process.env.DATABASE_URL)("GppPermit use count against PostgreSQL", () => {
  let store: GppPermitStore;
  let available = false;
  let cleanup: () => Promise<void> = async () => undefined;

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    if (!available) return;
    const db = await import("@dpf/db");
    const { gppPermitStore } = await import("./permit-store");
    store = gppPermitStore();
    cleanup = async () => { await db.prisma.gppPermit.deleteMany({ where: { gppPermitId: PERMIT_ID } }); };
    await cleanup();
  });

  afterAll(async () => {
    if (available) await cleanup();
  });

  it("exactly one of many concurrent consumePermit calls takes a single-use permit", async (context) => {
    if (!available) context.skip();
    const now = new Date();
    const claims: PermitClaims = {
      permitId: PERMIT_ID, bindingId: "tak-alignment-admit", bindingVersion: 1, shapeRef: null, stageKey: null,
      gateKey: "tak-alignment", authority: "wwwd", gateDecisionId: null, authorityDecisionId: null, envelopeId: null,
      actorGaid: null, actorUserId: "pg-test-user", actorAgentId: null, workroomId: null, subjectScope: null,
      capabilities: [{ tool: "create_portal_pr" }], paramHash: null, enforcement: "shadow", notBefore: now,
      expiresAt: new Date(now.getTime() + 60_000), maxUses: 1, nonce: "pg-test-nonce", parentPermitId: null,
    };
    const row = await store.createPermit(claims, null);

    const outcomes = await Promise.all(Array.from({ length: 12 }, () => store.consumePermit(row)));

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect((await store.findPermitByPermitId(PERMIT_ID))?.useCount).toBe(1);
    expect(await store.consumePermit(row)).toBe(false);
  });
});

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const url = new URL(databaseUrl);
  const port = Number(url.port || 5432);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: url.hostname, port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}
