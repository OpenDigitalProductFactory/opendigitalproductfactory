// packages/db/src/coworker-agent-upsert.test.ts
//
// Regression test for BI-3073F13B: the coworker-agent seed upsert keys on
// agentId but writes the @unique slugId in its create branch, so a new agentId
// re-using an existing slugId throws P2002 and (outside a transaction) aborts
// the whole coworker seed. upsertCoworkerAgentTolerant must:
//   (a) pass through a normal upsert unchanged,
//   (b) on a slugId P2002, re-resolve the canonical row by slugId and update it,
//   (c) NOT swallow non-P2002 errors,
//   (d) re-throw a P2002 that resolves to no slug owner (a different constraint).

import { describe, it, expect } from "vitest";
import { upsertCoworkerAgentTolerant } from "./coworker-agent-upsert";
import type { PrismaClient, Prisma } from "../generated/client/client";

type UpsertFn = (args: Prisma.AgentUpsertArgs) => Promise<{ id: string; agentId: string }>;
type FindFirstFn = (args: {
  where: { slugId: string };
  select: { id: true; agentId: true };
}) => Promise<{ id: string; agentId: string } | null>;
type UpdateFn = (args: {
  where: { id: string };
  data: unknown;
}) => Promise<{ id: string; agentId: string }>;

function buildClient(opts: {
  upsert: UpsertFn;
  findFirst?: FindFirstFn;
  update?: UpdateFn;
}): PrismaClient {
  return {
    agent: {
      upsert: opts.upsert,
      findFirst: opts.findFirst ?? (async () => null),
      update: opts.update ?? (async () => ({ id: "unused", agentId: "unused" })),
    },
  } as unknown as PrismaClient;
}

const p2002 = () =>
  Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: ["slugId"] },
  });

const args = (agentId: string, slugId: string): Prisma.AgentUpsertArgs =>
  ({
    where: { agentId },
    create: { agentId, slugId, kind: "specialist" },
    update: { slugId, name: `${agentId}-name` },
  }) as unknown as Prisma.AgentUpsertArgs;

describe("upsertCoworkerAgentTolerant", () => {
  it("passes a normal upsert through unchanged (outcome=upserted)", async () => {
    let upsertCalls = 0;
    const client = buildClient({
      upsert: async () => {
        upsertCalls++;
        return { id: "agent-1", agentId: "AGT-NEW" };
      },
    });

    const result = await upsertCoworkerAgentTolerant(client, "coo", args("AGT-NEW", "coo"));

    expect(result).toEqual({ id: "agent-1", agentId: "AGT-NEW", outcome: "upserted" });
    expect(upsertCalls).toBe(1);
  });

  it("re-resolves by slugId and updates the canonical row on a slugId P2002 (BI-3073F13B)", async () => {
    // AGT-NEW re-uses slugId "coo" already held by AGT-OLD (id agent-old).
    let findFirstArgs: Parameters<FindFirstFn>[0] | null = null;
    let updateArgs: Parameters<UpdateFn>[0] | null = null;
    const client = buildClient({
      upsert: async () => {
        throw p2002();
      },
      findFirst: async (a) => {
        findFirstArgs = a;
        return { id: "agent-old", agentId: "AGT-OLD" };
      },
      update: async (a) => {
        updateArgs = a;
        return { id: "agent-old", agentId: "AGT-OLD" };
      },
    });

    const result = await upsertCoworkerAgentTolerant(client, "coo", args("AGT-NEW", "coo"));

    expect(result).toEqual({
      id: "agent-old",
      agentId: "AGT-OLD",
      outcome: "reresolved_slug_collision",
    });
    // Resolved the winner by the colliding slug, and applied the new coworker's
    // update fields to that canonical row (no duplicate, no crash).
    expect(findFirstArgs!.where).toEqual({ slugId: "coo" });
    expect(updateArgs!.where).toEqual({ id: "agent-old" });
    expect(updateArgs!.data).toMatchObject({ slugId: "coo", name: "AGT-NEW-name" });
  });

  it("re-throws non-P2002 errors so genuine failures surface", async () => {
    const client = buildClient({
      upsert: async () => {
        throw Object.assign(new Error("connection lost"), { code: "P1001" });
      },
    });

    await expect(
      upsertCoworkerAgentTolerant(client, "coo", args("AGT-NEW", "coo")),
    ).rejects.toThrow(/connection lost/);
  });

  it("re-throws a P2002 that resolves to no slug owner (a different unique)", async () => {
    let findFirstCalls = 0;
    const client = buildClient({
      upsert: async () => {
        throw p2002();
      },
      findFirst: async () => {
        findFirstCalls++;
        return null; // no agent holds this slug -> not the slug collision -> surface it
      },
    });

    await expect(
      upsertCoworkerAgentTolerant(client, "ghost", args("AGT-NEW", "ghost")),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(findFirstCalls).toBe(1);
  });
});
