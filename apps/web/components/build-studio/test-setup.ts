// Test setup for build-studio component tests.
// Loads @testing-library/jest-dom matchers (e.g. toBeInTheDocument, toBeDisabled)
// into Vitest's `expect`. Activated per-file via `import "./test-setup"`.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest is configured with `globals: false`, so testing-library's auto-cleanup
// (which hooks into a global `afterEach`) does not fire. Wire it up explicitly.
afterEach(() => {
  cleanup();
});
