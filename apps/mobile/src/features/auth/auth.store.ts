import { create } from "zustand";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { MeResponse } from "@dpf/types";
import { api } from "@/src/lib/apiClient";
import { SecureStorage } from "@/src/repositories/SecureStorage";

/**
 * Requests push-notification permissions and registers the device token
 * with the backend.  Failures are silently ignored — push is best-effort.
 */
async function registerForPush() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const token = await Notifications.getExpoPushTokenAsync();
    const platform = Platform.OS === "ios" ? "ios" : "android";
    await api.notifications.registerDevice({ token: token.data, platform });
  } catch {
    // Push registration is best-effort; don't block login on failure
  }
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: MeResponse | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  accessToken: null,

  login: async (email: string, password: string) => {
    const res = await api.auth.login({ email, password });
    await SecureStorage.setAccessToken(res.accessToken);
    await SecureStorage.setRefreshToken(res.refreshToken);

    const user = await api.auth.me();
    set({
      isAuthenticated: true,
      accessToken: res.accessToken,
      user,
    });

    // Register device for push notifications (best-effort, non-blocking)
    registerForPush();
  },

  logout: async () => {
    try {
      const refreshToken = await SecureStorage.getRefreshToken();
      await api.auth.logout(refreshToken ?? undefined);
    } catch {
      // Best-effort server logout; clear local state regardless
    }
    await SecureStorage.clearTokens();
    set({
      isAuthenticated: false,
      accessToken: null,
      user: null,
    });
  },

  refresh: async () => {
    try {
      const refreshToken = await SecureStorage.getRefreshToken();
      if (!refreshToken) return false;

      const res = await api.auth.refresh({ refreshToken });
      await SecureStorage.setAccessToken(res.accessToken);
      await SecureStorage.setRefreshToken(res.refreshToken);
      set({ accessToken: res.accessToken });
      return true;
    } catch {
      return false;
    }
  },

  initialize: async () => {
    set({ isLoading: true });
    try {
      const accessToken = await SecureStorage.getAccessToken();
      if (!accessToken) {
        set({ isLoading: false });
        return;
      }

      // Try fetching user with existing token
      try {
        const user = await api.auth.me();
        set({
          isAuthenticated: true,
          accessToken,
          user,
          isLoading: false,
        });
        return;
      } catch {
        // Token might be expired — try refresh
      }

      const refreshed = await get().refresh();
      if (refreshed) {
        const user = await api.auth.me();
        set({
          isAuthenticated: true,
          user,
          isLoading: false,
        });
      } else {
        await SecureStorage.clearTokens();
        set({ isLoading: false });
      }
    } catch {
      await SecureStorage.clearTokens();
      set({
        isAuthenticated: false,
        accessToken: null,
        user: null,
        isLoading: false,
      });
    }
  },
}));
