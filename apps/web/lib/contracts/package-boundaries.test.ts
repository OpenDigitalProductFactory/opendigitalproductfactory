import { describe, expect, it } from "vitest";

// Enforces docs/architecture/package-boundaries.md: the portable contract /
// client packages (consumed by the mobile app) must never depend on `@dpf/db`
// or Prisma. Reuses the same checker the standalone CI script runs so the rule
// has a single implementation.
import {
  PORTABLE_PACKAGES,
  checkPackageBoundaries,
} from "../../../../scripts/check-package-boundaries.mjs";

describe("portable package boundaries", () => {
  it("keeps portable packages free of @dpf/db / Prisma", () => {
    const violations = checkPackageBoundaries();
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });

  it("guards the contract and client packages", () => {
    expect(PORTABLE_PACKAGES).toEqual([
      "packages/types",
      "packages/validators",
      "packages/api-client",
    ]);
  });
});
