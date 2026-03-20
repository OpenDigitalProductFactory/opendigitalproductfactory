import { useAuthStore } from "./auth.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockLogin = jest.fn();
const mockRefresh = jest.fn();
const mockLogout = jest.fn();
const mockMe = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => mockLogin(...args),
      refresh: (...args: unknown[]) => mockRefresh(...args),
      logout: (...args: unknown[]) => mockLogout(...args),
      me: (...args: unknown[]) => mockMe(...args),
    },
  },
}));

const mockSecureStorage = {
  getAccessToken: jest.fn(),
  setAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearTokens: jest.fn(),
};

jest.mock("@/src/repositories/SecureStorage", () => ({
  SecureStorage: {
    getAccessToken: (...args: unknown[]) =>
      mockSecureStorage.getAccessToken(...args),
    setAccessToken: (...args: unknown[]) =>
      mockSecureStorage.setAccessToken(...args),
    getRefreshToken: (...args: unknown[]) =>
      mockSecureStorage.getRefreshToken(...args),
    setRefreshToken: (...args: unknown[]) =>
      mockSecureStorage.setRefreshToken(...args),
    clearTokens: (...args: unknown[]) =>
      mockSecureStorage.clearTokens(...args),
  },
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fakeUser = {
  id: "u1",
  email: "test@example.com",
  platformRole: "admin",
  isSuperuser: false,
  capabilities: ["read"],
};

function resetStore() {
  useAuthStore.setState({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    accessToken: null,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("auth.store", () => {
  describe("login", () => {
    it("stores tokens, fetches user, and sets authenticated", async () => {
      mockLogin.mockResolvedValue({
        accessToken: "at1",
        refreshToken: "rt1",
        expiresIn: 3600,
      });
      mockMe.mockResolvedValue(fakeUser);

      await useAuthStore.getState().login("test@example.com", "password123");

      expect(mockLogin).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "password123",
      });
      expect(mockSecureStorage.setAccessToken).toHaveBeenCalledWith("at1");
      expect(mockSecureStorage.setRefreshToken).toHaveBeenCalledWith("rt1");
      expect(mockMe).toHaveBeenCalled();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.accessToken).toBe("at1");
      expect(state.user).toEqual(fakeUser);
    });

    it("propagates login errors", async () => {
      mockLogin.mockRejectedValue(new Error("Invalid credentials"));

      await expect(
        useAuthStore.getState().login("bad@example.com", "wrong"),
      ).rejects.toThrow("Invalid credentials");

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe("logout", () => {
    it("clears tokens, state, and calls server logout", async () => {
      // Set up authenticated state
      useAuthStore.setState({
        isAuthenticated: true,
        accessToken: "at1",
        user: fakeUser,
      });
      mockSecureStorage.getRefreshToken.mockResolvedValue("rt1");
      mockLogout.mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(mockLogout).toHaveBeenCalledWith("rt1");
      expect(mockSecureStorage.clearTokens).toHaveBeenCalled();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.accessToken).toBeNull();
      expect(state.user).toBeNull();
    });

    it("clears local state even if server logout fails", async () => {
      useAuthStore.setState({ isAuthenticated: true, accessToken: "at1" });
      mockSecureStorage.getRefreshToken.mockResolvedValue("rt1");
      mockLogout.mockRejectedValue(new Error("Network error"));

      await useAuthStore.getState().logout();

      expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe("refresh", () => {
    it("updates tokens on success and returns true", async () => {
      mockSecureStorage.getRefreshToken.mockResolvedValue("rt1");
      mockRefresh.mockResolvedValue({
        accessToken: "at2",
        refreshToken: "rt2",
        expiresIn: 3600,
      });

      const result = await useAuthStore.getState().refresh();

      expect(result).toBe(true);
      expect(mockRefresh).toHaveBeenCalledWith({ refreshToken: "rt1" });
      expect(mockSecureStorage.setAccessToken).toHaveBeenCalledWith("at2");
      expect(mockSecureStorage.setRefreshToken).toHaveBeenCalledWith("rt2");
      expect(useAuthStore.getState().accessToken).toBe("at2");
    });

    it("returns false when no refresh token stored", async () => {
      mockSecureStorage.getRefreshToken.mockResolvedValue(null);

      const result = await useAuthStore.getState().refresh();

      expect(result).toBe(false);
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("returns false on refresh failure", async () => {
      mockSecureStorage.getRefreshToken.mockResolvedValue("rt1");
      mockRefresh.mockRejectedValue(new Error("Token expired"));

      const result = await useAuthStore.getState().refresh();

      expect(result).toBe(false);
    });
  });

  describe("initialize", () => {
    it("sets authenticated when stored token is valid", async () => {
      mockSecureStorage.getAccessToken.mockResolvedValue("at1");
      mockMe.mockResolvedValue(fakeUser);

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(fakeUser);
      expect(state.isLoading).toBe(false);
    });

    it("refreshes token when /me fails and refresh succeeds", async () => {
      mockSecureStorage.getAccessToken.mockResolvedValue("at_expired");
      mockMe
        .mockRejectedValueOnce(new Error("Unauthorized"))
        .mockResolvedValueOnce(fakeUser);
      mockSecureStorage.getRefreshToken.mockResolvedValue("rt1");
      mockRefresh.mockResolvedValue({
        accessToken: "at_new",
        refreshToken: "rt_new",
        expiresIn: 3600,
      });

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(fakeUser);
      expect(state.isLoading).toBe(false);
    });

    it("clears state when no stored token", async () => {
      mockSecureStorage.getAccessToken.mockResolvedValue(null);

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("clears state when refresh also fails", async () => {
      mockSecureStorage.getAccessToken.mockResolvedValue("at_expired");
      mockMe.mockRejectedValue(new Error("Unauthorized"));
      mockSecureStorage.getRefreshToken.mockResolvedValue("rt_expired");
      mockRefresh.mockRejectedValue(new Error("Refresh failed"));

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
    });
  });
});
