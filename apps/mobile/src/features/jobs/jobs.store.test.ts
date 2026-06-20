import { useJobsStore } from "./jobs.store";
import type { WorkItemSummary, WorkItemDetail } from "@dpf/types";

const mockList = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    workItems: {
      list: (...a: unknown[]) => mockList(...a),
      get: (...a: unknown[]) => mockGet(...a),
      updateStatus: (...a: unknown[]) => mockUpdate(...a),
    },
  },
}));

const job: WorkItemSummary = {
  itemId: "WI-1",
  title: "Replace compressor",
  status: "claimed",
  urgency: "urgent",
  effortClass: "medium",
  dueAt: null,
  queueId: "q",
  teamId: null,
  createdAt: "2026-06-14T00:00:00.000Z",
};

const detail: WorkItemDetail = {
  ...job,
  status: "in-progress",
  description: "Unit down",
  sourceType: "service-request",
  sourceId: "SR-1",
  assignedToUserId: "u1",
  claimedAt: "2026-06-14T01:00:00.000Z",
  completedAt: null,
  account: null,
};

function reset() {
  useJobsStore.setState({
    jobs: [],
    detail: null,
    isLoading: false,
    isUpdating: false,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  reset();
});

describe("jobs.store", () => {
  it("fetchJobs loads the assigned jobs", async () => {
    mockList.mockResolvedValue({ data: [job], nextCursor: null });
    await useJobsStore.getState().fetchJobs("claimed");
    expect(mockList).toHaveBeenCalledWith({ status: "claimed", limit: 100 });
    expect(useJobsStore.getState().jobs).toEqual([job]);
    expect(useJobsStore.getState().isLoading).toBe(false);
  });

  it("fetchJobs surfaces errors", async () => {
    mockList.mockRejectedValue(new Error("offline"));
    await useJobsStore.getState().fetchJobs();
    expect(useJobsStore.getState().error).toBe("offline");
    expect(useJobsStore.getState().jobs).toEqual([]);
  });

  it("fetchDetail loads one job", async () => {
    mockGet.mockResolvedValue(detail);
    await useJobsStore.getState().fetchDetail("WI-1");
    expect(mockGet).toHaveBeenCalledWith("WI-1");
    expect(useJobsStore.getState().detail).toEqual(detail);
  });

  it("updateStatus checks in and reflects the new status in the list", async () => {
    useJobsStore.setState({ jobs: [job] });
    mockUpdate.mockResolvedValue(detail);
    await useJobsStore.getState().updateStatus("WI-1", "in-progress");
    expect(mockUpdate).toHaveBeenCalledWith("WI-1", { status: "in-progress" });
    expect(useJobsStore.getState().detail?.status).toBe("in-progress");
    expect(useJobsStore.getState().jobs[0]?.status).toBe("in-progress");
  });
});
