// Test setup for golden-triangle component tests.
// Loads @testing-library/jest-dom matchers into Vitest's `expect`.
// Activated per-file via `import "./test-setup"`.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs with `globals: false`, so testing-library's auto-cleanup does not
// fire on its own — wire it up explicitly.
afterEach(() => {
  cleanup();
});
