import { describe, it } from "vitest";

describe("deploy barrel export", () => {
  // rollback-strategies is tested in rollback-strategies.test.ts (mocks auth)
  // version-tracking is tested via actions/change-management-integration.test.ts
  // Barrel import itself requires next-auth server env, so snapshot test is skipped here.
  it.todo("barrel export snapshot (requires next-auth server env)");
});
