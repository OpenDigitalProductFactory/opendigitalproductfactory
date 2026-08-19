import { describe, expect, it } from "vitest";

import { normalizeGitOutput } from "./git-snapshot";

describe("normalizeGitOutput", () => {
  it("trims blank lines and preserves file paths", () => {
    expect(normalizeGitOutput("\n apps/web/lib/a.ts \n\npackages/db/schema.prisma\n")).toEqual([
      "apps/web/lib/a.ts",
      "packages/db/schema.prisma",
    ]);
  });
});
