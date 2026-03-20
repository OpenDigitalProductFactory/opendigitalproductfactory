// Conditionally load RNTL matchers — skipped when react-test-renderer
// version is incompatible with the installed React (e.g. RTR 19 + React 18).
try {
  require("@testing-library/react-native/extend-expect");
} catch {
  // extend-expect unavailable; tests that don't render components still run.
}
