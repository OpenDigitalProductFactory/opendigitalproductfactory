import { create } from "zustand";
import type { Notification } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

export interface NotificationsState {
  notifications: Notification[];
  isLoading: boolean;
  error: string | null;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  isLoading: false,
  error: null,

  fetchNotifications: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.notifications.list({ limit: 100 });
      set({ notifications: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to load notifications",
      });
    }
  },

  markAsRead: async (id: string) => {
    // Optimistically update read status
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));

    try {
      await api.notifications.markRead(id);
    } catch (err) {
      // Revert on failure and set error
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: false } : n,
        ),
        error:
          err instanceof Error
            ? err.message
            : "Failed to mark notification as read",
      }));
    }
  },

  markAllAsRead: async () => {
    const { notifications } = get();
    const unread = notifications.filter((n) => !n.read);

    // Optimistically mark all as read
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }));

    // Fire all mark-read calls concurrently
    const results = await Promise.allSettled(
      unread.map((n) => api.notifications.markRead(n.id)),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      // Re-fetch to get accurate state
      try {
        const res = await api.notifications.list({ limit: 100 });
        set({ notifications: res.data });
      } catch {
        // If re-fetch also fails, error is already apparent
      }
      set({
        error: `Failed to mark ${failures.length} notification(s) as read`,
      });
    }
  },
}));
