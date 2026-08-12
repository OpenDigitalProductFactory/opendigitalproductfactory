import { describe, expect, it } from "vitest";

import {
  CONTRIBUTOR_PREVIEW_ADMIN_EMAIL,
  provisionContributorPreviewAdmin,
  requireContributorPreviewPassword,
} from "./contributor-preview-auth";

describe("Contributor preview administrator", () => {
  it("requires a separate development-only password with a minimum length", () => {
    expect(() => requireContributorPreviewPassword(undefined)).toThrow(
      "CONTRIBUTOR_PREVIEW_PASSWORD",
    );
    expect(() => requireContributorPreviewPassword("too-short")).toThrow(
      "at least 12 characters",
    );
    expect(requireContributorPreviewPassword("preview-password-only")).toBe(
      "preview-password-only",
    );
  });

  it("provisions only the sanitized superuser with the separate development credential", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      $queryRawUnsafe: async () => [{ id: "user-super" }],
      $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
        statements.push({ sql, values });
        return 1;
      },
    };

    await provisionContributorPreviewAdmin(
      client,
      "preview-password-only",
      async (password) => `hashed:${password}`,
    );

    expect(statements).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE "User"'),
        values: [CONTRIBUTOR_PREVIEW_ADMIN_EMAIL, "hashed:preview-password-only", "user-super"],
      }),
    ]);
  });

  it("fails closed when the sanitized clone has no active superuser", async () => {
    const client = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async () => 1,
    };

    await expect(provisionContributorPreviewAdmin(
      client,
      "preview-password-only",
      async () => "unused",
    )).rejects.toThrow("active superuser");
  });
});
