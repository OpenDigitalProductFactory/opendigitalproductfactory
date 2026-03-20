import { useNotificationsStore } from "./notifications.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockList = jest.fn();
const mockMarkRead = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    notifications: {
      list: (...args: unknown[]) => mockList(...args),
      markRead: (...args: unknown[]) => mockMarkRead(...args),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeNotification = {
  id: "notif-1",
  userId: "user-1",
  type: "approval_request",
  title: "New approval needed",
  body: "Agent wants to create a backlog item",
  deepLink: "/more/approvals",
  read: false,
  createdAt: "2026-03-19T00:00:00Z",
};

const fakeNotification2 = {
  id: "notif-2",
  userId: "user-1",
  type: "compliance_alert",
  title: "Compliance alert",
  body: "Policy violation detected",
  deepLink: "/more/compliance",
  read: true,
  createdAt: "2026-03-19T01:00:00Z",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useNotificationsStore.setState({
    notifications: [],
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

describe("notifications.store", () => {
  describe("fetchNotifications", () => {
    it("loads notifications from API", async () => {
      mockList.mockResolvedValue({
        data: [fakeNotification, fakeNotification2],
        nextCursor: null,
      });

      await useNotificationsStore.getState().fetchNotifications();

      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(2);
      expect(state.notifications[0].title).toBe("New approval needed");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockList.mockRejectedValue(new Error("Network error"));

      await useNotificationsStore.getState().fetchNotifications();

      const state = useNotificationsStore.getState();
      expect(state.notifications).toEqual([]);
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("markAsRead", () => {
    it("optimistically marks notification as read", async () => {
      useNotificationsStore.setState({
        notifications: [fakeNotification as any],
      });
      mockMarkRead.mockResolvedValue({
        ...fakeNotification,
        read: true,
      });

      await useNotificationsStore.getState().markAsRead("notif-1");

      expect(mockMarkRead).toHaveBeenCalledWith("notif-1");
      const state = useNotificationsStore.getState();
      expect(state.notifications[0].read).toBe(true);
      expect(state.error).toBeNull();
    });

    it("reverts read status and sets error on API failure", async () => {
      useNotificationsStore.setState({
        notifications: [fakeNotification as any],
      });
      mockMarkRead.mockRejectedValue(new Error("Forbidden"));

      await useNotificationsStore.getState().markAsRead("notif-1");

      const state = useNotificationsStore.getState();
      expect(state.notifications[0].read).toBe(false);
      expect(state.error).toBe("Forbidden");
    });
  });

  describe("markAllAsRead", () => {
    it("marks all unread notifications as read", async () => {
      useNotificationsStore.setState({
        notifications: [fakeNotification as any, fakeNotification2 as any],
      });
      mockMarkRead.mockResolvedValue({});

      await useNotificationsStore.getState().markAllAsRead();

      // Only unread notification should trigger API call
      expect(mockMarkRead).toHaveBeenCalledTimes(1);
      expect(mockMarkRead).toHaveBeenCalledWith("notif-1");
      const state = useNotificationsStore.getState();
      expect(state.notifications.every((n) => n.read)).toBe(true);
    });

    it("re-fetches on partial failure", async () => {
      useNotificationsStore.setState({
        notifications: [fakeNotification as any],
      });
      mockMarkRead.mockRejectedValue(new Error("Server error"));
      mockList.mockResolvedValue({
        data: [fakeNotification],
        nextCursor: null,
      });

      await useNotificationsStore.getState().markAllAsRead();

      const state = useNotificationsStore.getState();
      expect(state.error).toContain("Failed to mark");
      // Re-fetch should have been called
      expect(mockList).toHaveBeenCalled();
    });
  });
});
