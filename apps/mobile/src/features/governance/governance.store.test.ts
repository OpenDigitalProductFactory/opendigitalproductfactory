import { useGovernanceStore } from "./governance.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockListApprovals = jest.fn();
const mockDecide = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    governance: {
      listApprovals: (...args: unknown[]) => mockListApprovals(...args),
      decide: (...args: unknown[]) => mockDecide(...args),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeApproval = {
  id: "prop-1",
  proposalId: "PROP-001",
  threadId: "thread-1",
  messageId: "msg-1",
  agentId: "ops-coordinator",
  actionType: "create-backlog-item",
  parameters: { title: "New feature", type: "product" },
  status: "proposed",
  proposedAt: "2026-03-19T00:00:00Z",
  decidedAt: null,
  decidedById: null,
  executedAt: null,
  resultEntityId: null,
  resultError: null,
  gitCommitHash: null,
};

const fakeApproval2 = {
  ...fakeApproval,
  id: "prop-2",
  proposalId: "PROP-002",
  actionType: "update-epic",
  parameters: { title: "Updated epic" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useGovernanceStore.setState({
    approvals: [],
    isLoading: false,
    error: null,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("governance.store", () => {
  describe("fetchApprovals", () => {
    it("loads approvals from API", async () => {
      mockListApprovals.mockResolvedValue({
        data: [fakeApproval, fakeApproval2],
        nextCursor: null,
      });

      await useGovernanceStore.getState().fetchApprovals();

      const state = useGovernanceStore.getState();
      expect(state.approvals).toHaveLength(2);
      expect(state.approvals[0].actionType).toBe("create-backlog-item");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockListApprovals.mockRejectedValue(new Error("Server error"));

      await useGovernanceStore.getState().fetchApprovals();

      const state = useGovernanceStore.getState();
      expect(state.approvals).toEqual([]);
      expect(state.error).toBe("Server error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("decide", () => {
    it("optimistically removes approval and calls API", async () => {
      useGovernanceStore.setState({
        approvals: [fakeApproval as any, fakeApproval2 as any],
      });
      mockDecide.mockResolvedValue({ ...fakeApproval, status: "approved" });

      await useGovernanceStore
        .getState()
        .decide("prop-1", "approve", "Looks good");

      expect(mockDecide).toHaveBeenCalledWith("prop-1", {
        decision: "approve",
        rationale: "Looks good",
      });
      const state = useGovernanceStore.getState();
      expect(state.approvals).toHaveLength(1);
      expect(state.approvals[0].id).toBe("prop-2");
      expect(state.error).toBeNull();
    });

    it("sets error and re-fetches on API failure", async () => {
      useGovernanceStore.setState({
        approvals: [fakeApproval as any],
      });
      mockDecide.mockRejectedValue(new Error("Forbidden"));
      mockListApprovals.mockResolvedValue({
        data: [fakeApproval],
        nextCursor: null,
      });

      await useGovernanceStore.getState().decide("prop-1", "reject");

      const state = useGovernanceStore.getState();
      expect(state.error).toBe("Forbidden");
      // Re-fetch should restore the approval
      expect(state.approvals).toHaveLength(1);
    });
  });
});
