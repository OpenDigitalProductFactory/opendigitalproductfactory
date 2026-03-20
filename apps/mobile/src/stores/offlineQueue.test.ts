import { useOfflineQueueStore } from "./offlineQueue";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

jest.mock("@/src/repositories/SecureStorage", () => ({
  SecureStorage: {
    getAccessToken: jest.fn().mockResolvedValue("test-token"),
  },
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useOfflineQueueStore.setState({ queue: [] });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("offlineQueue", () => {
  describe("enqueue", () => {
    it("adds a mutation to the queue", () => {
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items", "POST", { name: "Test" });

      const { queue } = useOfflineQueueStore.getState();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        endpoint: "/api/v1/items",
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
        status: "pending",
        retries: 0,
      });
      expect(queue[0].id).toBeTruthy();
      expect(queue[0].createdAt).toBeGreaterThan(0);
    });

    it("appends multiple mutations in order", () => {
      const store = useOfflineQueueStore.getState();
      store.enqueue("/api/v1/a", "POST", { a: 1 });
      store.enqueue("/api/v1/b", "PATCH", { b: 2 });

      const { queue } = useOfflineQueueStore.getState();
      expect(queue).toHaveLength(2);
      expect(queue[0].endpoint).toBe("/api/v1/a");
      expect(queue[1].endpoint).toBe("/api/v1/b");
    });
  });

  describe("dequeue", () => {
    it("removes a mutation by id", () => {
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items", "POST", { x: 1 });
      const { queue } = useOfflineQueueStore.getState();
      const id = queue[0].id;

      useOfflineQueueStore.getState().dequeue(id);

      expect(useOfflineQueueStore.getState().queue).toHaveLength(0);
    });

    it("does nothing for unknown id", () => {
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items", "POST", { x: 1 });

      useOfflineQueueStore.getState().dequeue("unknown");

      expect(useOfflineQueueStore.getState().queue).toHaveLength(1);
    });
  });

  describe("processQueue", () => {
    it("sends pending mutations and removes them on success", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items", "POST", { name: "Test" });

      await useOfflineQueueStore.getState().processQueue();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/items"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Test" }),
        }),
      );
      expect(useOfflineQueueStore.getState().queue).toHaveLength(0);
    });

    it("increments retries on failure and keeps as pending", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items", "POST", { name: "Test" });

      await useOfflineQueueStore.getState().processQueue();

      const { queue } = useOfflineQueueStore.getState();
      expect(queue).toHaveLength(1);
      expect(queue[0].retries).toBe(1);
      expect(queue[0].status).toBe("pending");
    });

    it("marks mutation as failed after max retries", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items", "POST", { name: "Test" });

      // Simulate 3 failed attempts
      await useOfflineQueueStore.getState().processQueue();
      await useOfflineQueueStore.getState().processQueue();
      await useOfflineQueueStore.getState().processQueue();

      const { queue } = useOfflineQueueStore.getState();
      expect(queue).toHaveLength(1);
      expect(queue[0].retries).toBe(3);
      expect(queue[0].status).toBe("failed");
    });

    it("skips failed mutations", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      // Manually set a failed mutation
      useOfflineQueueStore.setState({
        queue: [
          {
            id: "failed-1",
            endpoint: "/api/v1/items",
            method: "POST" as const,
            body: "{}",
            status: "failed" as const,
            retries: 3,
            createdAt: Date.now(),
          },
        ],
      });

      await useOfflineQueueStore.getState().processQueue();

      // fetch should not have been called since the only mutation is failed
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useOfflineQueueStore.getState().queue).toHaveLength(1);
    });

    it("does not send body for DELETE mutations", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      useOfflineQueueStore
        .getState()
        .enqueue("/api/v1/items/1", "DELETE", null);

      await useOfflineQueueStore.getState().processQueue();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/items/1"),
        expect.objectContaining({
          method: "DELETE",
          body: undefined,
        }),
      );
    });
  });
});
