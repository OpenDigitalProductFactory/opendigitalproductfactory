// Test setup for report-kit component tests that need a real DOM.
//
// Most of this folder's tests assert on renderToStaticMarkup output and need
// nothing; the interactive primitives (SearchableSelect) need jest-dom matchers
// and Testing Library cleanup. Mirrors components/build-studio/test-setup.ts.
//
// Activated per-file via `import "./test-setup"` alongside
// `// @vitest-environment jsdom`.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest is configured with `globals: false`, so testing-library's auto-cleanup
// (which hooks into a global `afterEach`) does not fire. Wire it up explicitly —
// without this, each render stacks in the same document and `getByRole` throws
// "found multiple elements".
afterEach(() => {
  cleanup();
});
