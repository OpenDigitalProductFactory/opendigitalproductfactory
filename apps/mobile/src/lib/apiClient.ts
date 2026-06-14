import { createApiClient } from "@dpf/api-client";
import { SecureStorage } from "@/src/repositories/SecureStorage";
import { getServerUrl } from "@/src/lib/serverConfig";

let refreshPromise: Promise<string | null> | null = null;

export const api = createApiClient({
  // Resolver, not a static string: the active install can change at runtime
  // once the user connects to their org. See src/lib/serverConfig.ts.
  baseUrl: () => getServerUrl(),
  getToken: () => SecureStorage.getAccessToken(),
  onTokenExpired: () => {
    // Deduplicate concurrent refresh attempts
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const refreshToken = await SecureStorage.getRefreshToken();
          if (!refreshToken) return null;
          const res = await fetch(`${getServerUrl()}/api/v1/auth/refresh`, {
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
