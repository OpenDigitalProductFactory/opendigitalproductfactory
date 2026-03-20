import * as SecureStore from "expo-secure-store";

const KEYS = {
  ACCESS_TOKEN: "dpf_access_token",
  REFRESH_TOKEN: "dpf_refresh_token",
} as const;

export const SecureStorage = {
  getAccessToken: () => SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
  setAccessToken: (token: string) =>
    SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, token),
  getRefreshToken: () => SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
  setRefreshToken: (token: string) =>
    SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, token),
  clearTokens: async () => {
    await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN);
    await SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN);
  },
};
