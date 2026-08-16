import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activityCount: vi.fn(),
  epicFind: vi.fn(),
  pinCount: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItemActivity: { count: mocks.activityCount },
    epic: { findUnique: mocks.epicFind },
    initiativeArtifactRetentionPin: { count: mocks.pinCount },
  },
}));

import {
  assertBacklogItemGovernanceDeletable,
  assertEpicGovernanceDeletable,
  assertFeatureBuildGovernanceDeletable,
} from "./initiative-governance-deletion";

describe("initiative governance deletion guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activityCount.mockResolvedValue(0);
    mocks.epicFind.mockResolvedValue({ epicId: "EP-TEST" });
    mocks.pinCount.mockResolvedValue(0);
  });

  it("preserves ordinary backlog deletion when no governance activity exists", async () => {
    await expect(assertBacklogItemGovernanceDeletable("bi-row")).resolves.toBeUndefined();
  });

  it("denies deletion of backlog, epic, and build subjects with permanent evidence", async () => {
    mocks.activityCount.mockResolvedValue(1);
    mocks.pinCount.mockResolvedValue(1);
    await expect(assertBacklogItemGovernanceDeletable("bi-row")).rejects.toMatchObject({ code: "INITIATIVE_GOVERNANCE_RETENTION" });
    await expect(assertEpicGovernanceDeletable("epic-row")).rejects.toMatchObject({ code: "INITIATIVE_GOVERNANCE_RETENTION" });
    await expect(assertFeatureBuildGovernanceDeletable("FB-TEST")).rejects.toMatchObject({ code: "INITIATIVE_GOVERNANCE_RETENTION" });
  });
});
