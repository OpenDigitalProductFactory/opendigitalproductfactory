import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { declareWorkCapsuleIntent } from "./work-capsule-intent-store";
import type { CapsuleDb } from "./work-capsule-store-types";

const db = {
  workroom: { findUnique: vi.fn() },
  workroomActivity: { create: vi.fn() },
} as unknown as CapsuleDb;

describe("work capsule intent store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a work-intent subject that does not match the capsule binding", async () => {
    vi.mocked(db.workroom.findUnique).mockResolvedValueOnce({
      id: "row-1",
      backlogItemId: "BI-ACTUAL",
      epicId: null,
      featureBuildId: null,
      taskRunId: null,
    } as never);

    await expect(declareWorkCapsuleIntent({
      db,
      capsuleId: "WC-BOUND",
      intent: "implementation",
      policyVersion: "initiative-readiness.v1",
      subject: { kind: "backlog-item", id: "BI-SPOOFED" },
      actor: { userId: "user-1", agentId: "agent-1", principalId: "principal-1" },
    })).rejects.toThrow(/does not match/i);
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });
});
