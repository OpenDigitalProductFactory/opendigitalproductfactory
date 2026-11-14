import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-30EDDB7F: the home records a peer's claim through the real store path.
// Only the database is faked; claimBacklogItemWorkspace runs as it does live.

const db = vi.hoisted(() => {
  const state = { item: null as Record<string, unknown> | null, liveRooms: [] as unknown[] };
  const fake = {
    state,
    workroom: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "row-peer", capsuleId: "WC-PEER01", ...args.data })),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    workroomActivity: { create: vi.fn() },
    backlogItem: { findFirst: vi.fn(async () => state.item), update: vi.fn(async () => ({ id: "bi-row-1" })) },
    $queryRaw: vi.fn(async () => state.liveRooms),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(fake)),
  };
  return fake;
});

vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { claimForPeer } from "./work-claim-exchange.server";

const DEV = "inst_00000000000000000000000000000002";
const input = {
  itemId: "BI-HOME",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "feat/x",
  worktreePath: `federation://${DEV}/WC-DEV`,
  executorRef: `federation:${DEV}:WC-DEV`,
  linkId: "link_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.state.item = { id: "bi-row-1", itemId: "BI-HOME", epicId: "EP-1", title: "Home item", outcome: "One claim.", claimStatus: null, claimedById: null, claimedByAgentId: null, claimedAt: null };
  db.state.liveRooms = [];
});

describe("claimForPeer — the home's real claim path", () => {
  it("records a Workroom whose executor is the requesting installation, and no item claim fields", async () => {
    const outcome = await claimForPeer(input);
    expect(outcome).toMatchObject({ claimed: true, capsuleId: expect.stringMatching(/^WC-/) });
    expect(db.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        backlogItemId: "BI-HOME",
        executorKind: "federated-peer",
        executorRef: `federation:${DEV}:WC-DEV`,
        worktreePath: `federation://${DEV}/WC-DEV`,
      }),
    }));
    // The claim is the Workroom: it lapses and releases with that Workroom's
    // lease, so the item is never left published as claimed after a release.
    expect(db.backlogItem.update).not.toHaveBeenCalled();
  });

  it("answers any other rejection of the claim path as a refusal, never a thrown error", async () => {
    db.state.item = null;
    const outcome = await claimForPeer(input);
    expect(outcome).toMatchObject({ claimed: false });
    expect(outcome).toHaveProperty("refusedReason");
  });
});
