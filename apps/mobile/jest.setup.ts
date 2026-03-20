// Conditionally load RNTL matchers — skipped when react-test-renderer
// version is incompatible with the installed React (e.g. RTR 19 + React 18).
try {
  require("@testing-library/react-native/extend-expect");
} catch {
  // extend-expect unavailable; tests that don't render components still run.
}

// MSW server lifecycle — import in individual test files if needed:
//   import { server } from "@/src/mocks/server";
//   beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
//   afterEach(() => server.resetHandlers());
//   afterAll(() => server.close());
