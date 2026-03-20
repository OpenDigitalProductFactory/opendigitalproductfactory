import { createApiClient } from "@dpf/api-client";
import { SecureStorage } from "@/src/repositories/SecureStorage";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

let refreshPromise: Promise<string | null> | null = null;

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => SecureStorage.getAccessToken(),
  onTokenExpired: () => {
    // Deduplicate concurrent refresh attempts
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const refreshToken = await SecureStorage.getRefreshToken();
          if (!refreshToken) return null;
          const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) return null;
          const data = await res.json();
          await SecureStorage.setAccessToken(data.accessToken);
          await SecureStorage.setRefreshToken(data.refreshToken);
          return data.accessToken as string;
        } catch {
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }
    return refreshPromise;
  },
});
