// BI-05AFEB9A (BI-729D9B27 slice 2): a Build Studio Workroom stores its item's
// row id, not the BI id, and records no immutable base. FB-2F2D46D5 merged and
// went live on 2026-11-13, yet its item's acceptance stayed unroutable
// ("workroom-not-found") because the live-room lookup matched the BI id only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findItem: vi.fn(),
  inventory: vi.fn(),
  findRooms: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findUnique: mocks.findItem },
    workroom: { findMany: mocks.findRooms },
  },
}));
vi.mock("@/lib/work-capsules/liveness-inventory", () => ({ loadCapsuleLivenessInventory: mocks.inventory }));

import { DEFAULT_TERMINAL_RECOVERY_PORTS } from "./terminal-recovery";

const buildStudioRoom = {
  capsuleId: "WC-8B8A9D6F",
  backlogItemId: "cmuysh67n09sh01s3dmmq51b2",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha: null,
  headBranch: "build/FB-2F2D46D5",
  headSha: "d38a3c56ecbff59bcaae05edc7cde7ec7b67e54e",
};

beforeEach(() => {
  mocks.findItem.mockReset().mockResolvedValue({ id: "cmuysh67n09sh01s3dmmq51b2", itemId: "BI-86289091" });
  mocks.inventory.mockReset().mockResolvedValue({ capsulesAll: [{ capsuleId: "WC-8B8A9D6F", isLive: true }] });
  mocks.findRooms.mockReset().mockResolvedValue([buildStudioRoom]);
});

describe("DEFAULT_TERMINAL_RECOVERY_PORTS.loadLiveRooms", () => {
  it("finds a live room bound by the item's row id, as Build Studio binds it", async () => {
    const rooms = await DEFAULT_TERMINAL_RECOVERY_PORTS.loadLiveRooms({ itemId: "BI-86289091", refusedWorkroomId: null });

    const where = mocks.inventory.mock.calls[0]?.[1]?.where;
    expect(where.backlogItemId).toEqual({ in: ["BI-86289091", "cmuysh67n09sh01s3dmmq51b2"] });
    expect(rooms).toEqual([{ ...buildStudioRoom, isLive: true }]);
  });

  it("still matches the BI id when the item row cannot be read", async () => {
    mocks.findItem.mockResolvedValue(null);
    await DEFAULT_TERMINAL_RECOVERY_PORTS.loadLiveRooms({ itemId: "BI-86289091", refusedWorkroomId: null });

    expect(mocks.inventory.mock.calls[0]?.[1]?.where.backlogItemId).toEqual({ in: ["BI-86289091"] });
  });
});
