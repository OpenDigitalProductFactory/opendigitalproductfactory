import {
  resolveAuthRedirect,
  TABS_HOME,
  VISITOR_HOME,
} from "./authRouting";

describe("resolveAuthRedirect", () => {
  describe("unauthenticated (anonymous walk-up)", () => {
    it("sends a bare cold open (/ → tabs group) to the Nearby front door", () => {
      // expo-router resolves the index of the (tabs) group to ["(tabs)"].
      expect(
        resolveAuthRedirect({ segments: ["(tabs)"], isAuthenticated: false }),
      ).toBe(VISITOR_HOME);
    });

    it("sends the index tab to the Nearby front door", () => {
      expect(
        resolveAuthRedirect({
          segments: ["(tabs)", "index"],
          isAuthenticated: false,
        }),
      ).toBe(VISITOR_HOME);
    });

    it("leaves a visitor already on Nearby in place", () => {
      expect(
        resolveAuthRedirect({
          segments: ["(tabs)", "nearby"],
          isAuthenticated: false,
        }),
      ).toBeNull();
    });

    it("leaves a visitor on a Nearby subroute (menu) in place", () => {
      expect(
        resolveAuthRedirect({
          segments: ["(tabs)", "nearby", "[slug]"],
          isAuthenticated: false,
        }),
      ).toBeNull();
    });

    it("never forces login: the login screen stays reachable", () => {
      expect(
        resolveAuthRedirect({ segments: ["login"], isAuthenticated: false }),
      ).toBeNull();
    });

    it("leaves the connect (join / switcher) route reachable", () => {
      expect(
        resolveAuthRedirect({ segments: ["connect"], isAuthenticated: false }),
      ).toBeNull();
    });

    it("redirects an operator-only tab back to the visitor surface", () => {
      expect(
        resolveAuthRedirect({
          segments: ["(tabs)", "portfolio"],
          isAuthenticated: false,
        }),
      ).toBe(VISITOR_HOME);
    });
  });

  describe("authenticated", () => {
    it("nudges a signed-in user off the login screen into the app", () => {
      expect(
        resolveAuthRedirect({ segments: ["login"], isAuthenticated: true }),
      ).toBe(TABS_HOME);
    });

    it("leaves a signed-in user on their home tab alone", () => {
      expect(
        resolveAuthRedirect({
          segments: ["(tabs)", "index"],
          isAuthenticated: true,
        }),
      ).toBeNull();
    });

    it("leaves a signed-in customer browsing Nearby alone", () => {
      expect(
        resolveAuthRedirect({
          segments: ["(tabs)", "nearby"],
          isAuthenticated: true,
        }),
      ).toBeNull();
    });

    it("leaves the connect route alone for a signed-in user", () => {
      expect(
        resolveAuthRedirect({ segments: ["connect"], isAuthenticated: true }),
      ).toBeNull();
    });
  });
});
