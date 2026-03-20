import { useOpsStore } from "./ops.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockListEpics = jest.fn();
const mockListBacklog = jest.fn();
const mockCreateBacklogItem = jest.fn();
const mockUpdateBacklogItem = jest.fn();
const mockDeleteBacklogItem = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    ops: {
      listEpics: (...args: unknown[]) => mockListEpics(...args),
      listBacklog: (...args: unknown[]) => mockListBacklog(...args),
      createBacklogItem: (...args: unknown[]) =>
        mockCreateBacklogItem(...args),
      updateBacklogItem: (...args: unknown[]) =>
        mockUpdateBacklogItem(...args),
      deleteBacklogItem: (...args: unknown[]) =>
        mockDeleteBacklogItem(...args),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeEpic = {
  id: "epic-1",
  title: "Onboarding Flow",
  status: "open",
  description: "Build onboarding",
  items: [{ id: "item-1" }, { id: "item-2" }],
  portfolios: [],
  createdAt: "2026-03-19T00:00:00Z",
  updatedAt: "2026-03-19T00:00:00Z",
};

const fakeBacklogItem = {
  id: "item-1",
  title: "Design wireframes",
  status: "open",
  type: "product",
  priority: 100,
  body: null,
  epicId: "epic-1",
  epic: { id: "epic-1", title: "Onboarding Flow" },
  digitalProduct: null,
  taxonomyNode: null,
  createdAt: "2026-03-19T00:00:00Z",
  updatedAt: "2026-03-19T00:00:00Z",
};

const fakeBacklogItem2 = {
  ...fakeBacklogItem,
  id: "item-2",
  title: "Implement login",
  priority: 200,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useOpsStore.setState({
    epics: [],
    selectedEpic: null,
    backlogItems: [],
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

describe("ops.store", () => {
  describe("fetchEpics", () => {
    it("loads epics from API", async () => {
      mockListEpics.mockResolvedValue({
        data: [fakeEpic],
        nextCursor: null,
      });

      await useOpsStore.getState().fetchEpics();

      const state = useOpsStore.getState();
      expect(state.epics).toEqual([fakeEpic]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockListEpics.mockRejectedValue(new Error("Server error"));

      await useOpsStore.getState().fetchEpics();

      const state = useOpsStore.getState();
      expect(state.epics).toEqual([]);
      expect(state.error).toBe("Server error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("fetchEpicDetail", () => {
    it("loads backlog items for a specific epic", async () => {
      // Pre-populate epics so the detail lookup finds it
      useOpsStore.setState({ epics: [fakeEpic as any] });
      mockListBacklog.mockResolvedValue({
        data: [fakeBacklogItem, fakeBacklogItem2],
        nextCursor: null,
      });

      await useOpsStore.getState().fetchEpicDetail("epic-1");

      const state = useOpsStore.getState();
      expect(state.selectedEpic).toEqual(fakeEpic);
      expect(state.backlogItems).toHaveLength(2);
      expect(state.isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockListBacklog.mockRejectedValue(new Error("Not found"));

      await useOpsStore.getState().fetchEpicDetail("epic-999");

      const state = useOpsStore.getState();
      expect(state.error).toBe("Not found");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("fetchBacklog", () => {
    it("loads backlog items with filters", async () => {
      mockListBacklog.mockResolvedValue({
        data: [fakeBacklogItem],
        nextCursor: null,
      });

      await useOpsStore.getState().fetchBacklog({ status: "open" });

      const state = useOpsStore.getState();
      expect(state.backlogItems).toEqual([fakeBacklogItem]);
      expect(mockListBacklog).toHaveBeenCalledWith(
        expect.objectContaining({ status: "open" }),
      );
    });
  });

  describe("createItem", () => {
    it("validates and creates a backlog item", async () => {
      const newItem = {
        ...fakeBacklogItem,
        id: "item-new",
        title: "New task",
      };
      mockCreateBacklogItem.mockResolvedValue(newItem);

      await useOpsStore.getState().createItem({
        title: "New task",
        type: "product",
        epicId: "epic-1",
      });

      const state = useOpsStore.getState();
      expect(state.backlogItems).toContainEqual(newItem);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it("sets error on validation failure", async () => {
      await useOpsStore.getState().createItem({
        title: "", // empty title fails validation
        type: "product",
      });

      const state = useOpsStore.getState();
      expect(mockCreateBacklogItem).not.toHaveBeenCalled();
      expect(state.error).toBeTruthy();
    });

    it("sets error on API failure", async () => {
      mockCreateBacklogItem.mockRejectedValue(new Error("Server error"));

      await useOpsStore.getState().createItem({
        title: "Valid title",
        type: "product",
      });

      const state = useOpsStore.getState();
      expect(state.error).toBe("Server error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("updateItem", () => {
    it("validates and updates a backlog item", async () => {
      useOpsStore.setState({ backlogItems: [fakeBacklogItem as any] });
      const updated = { ...fakeBacklogItem, title: "Updated title" };
      mockUpdateBacklogItem.mockResolvedValue(updated);

      await useOpsStore.getState().updateItem("item-1", {
        title: "Updated title",
      });

      const state = useOpsStore.getState();
      expect(state.backlogItems[0].title).toBe("Updated title");
      expect(state.error).toBeNull();
    });

    it("sets error on validation failure for update", async () => {
      await useOpsStore.getState().updateItem("item-1", {
        title: "", // empty title fails
      });

      expect(mockUpdateBacklogItem).not.toHaveBeenCalled();
      expect(useOpsStore.getState().error).toBeTruthy();
    });

    it("sets error on API failure for update", async () => {
      useOpsStore.setState({ backlogItems: [fakeBacklogItem as any] });
      mockUpdateBacklogItem.mockRejectedValue(new Error("Conflict"));

      await useOpsStore.getState().updateItem("item-1", {
        title: "Valid",
      });

      expect(useOpsStore.getState().error).toBe("Conflict");
    });
  });

  describe("deleteItem", () => {
    it("deletes a backlog item from state", async () => {
      useOpsStore.setState({
        backlogItems: [fakeBacklogItem as any, fakeBacklogItem2 as any],
      });
      mockDeleteBacklogItem.mockResolvedValue({ deleted: true });

      await useOpsStore.getState().deleteItem("item-1");

      const state = useOpsStore.getState();
      expect(state.backlogItems).toHaveLength(1);
      expect(state.backlogItems[0].id).toBe("item-2");
      expect(state.error).toBeNull();
    });

    it("sets error on API failure for delete", async () => {
      useOpsStore.setState({ backlogItems: [fakeBacklogItem as any] });
      mockDeleteBacklogItem.mockRejectedValue(new Error("Forbidden"));

      await useOpsStore.getState().deleteItem("item-1");

      const state = useOpsStore.getState();
      // Item should remain since delete failed
      expect(state.backlogItems).toHaveLength(1);
      expect(state.error).toBe("Forbidden");
    });
  });
});
