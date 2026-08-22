import { describe, expect, it, vi } from "vitest";

import {
  MAX_PLANNED_FILE_PATHS,
  normalizeFilePaths,
  readChangeImpactPaths,
  resolvePlannedFilePaths,
  resolveShippedFilePaths,
  type PlannedFilePathsClient,
} from "./planned-file-paths";

function client(overrides: {
  workroom?: unknown;
  build?: { buildPlan?: unknown; description?: string | null; diffPatch?: string | null } | null;
}): PlannedFilePathsClient {
  return {
    workroom: {
      findFirst: vi.fn(async () =>
        overrides.workroom === undefined
          ? null
          : ({ verificationState: overrides.workroom } as { verificationState: unknown }),
      ),
    },
    featureBuild: {
      findUnique: vi.fn(async () =>
        overrides.build === undefined || overrides.build === null
          ? null
          : {
              buildPlan: overrides.build.buildPlan ?? null,
              description: overrides.build.description ?? null,
              diffPatch: overrides.build.diffPatch ?? null,
            },
      ),
    },
  };
}

const RESOLVED_CONTRACT = {
  changeImpactContract: {
    status: "resolved",
    paths: [
      "apps/web/lib/attention/owner-decision-copy.ts",
      "apps/web/lib/attention/owner-decision-copy.test.ts",
    ],
  },
};

describe("normalizeFilePaths", () => {
  it("keeps repo-relative source paths and dedupes", () => {
    expect(
      normalizeFilePaths([
        "apps/web/lib/a.ts",
        "apps/web/lib/a.ts",
        "./apps/web/lib/b.ts",
      ]),
    ).toEqual(["apps/web/lib/a.ts", "apps/web/lib/b.ts"]);
  });

  it("rejects absolute paths, parent escapes, bare names and non-strings", () => {
    expect(
      normalizeFilePaths([
        "/etc/passwd",
        "../../secrets/key.pem",
        "apps/../../../outside.ts",
        "README",
        42,
        null,
        undefined,
        "   ",
      ]),
    ).toEqual([]);
  });

  it("caps the list so a large refactor plan cannot make impact derivation unbounded", () => {
    const many = Array.from({ length: MAX_PLANNED_FILE_PATHS + 50 }, (_, i) => `apps/web/lib/f${i}.ts`);
    expect(normalizeFilePaths(many)).toHaveLength(MAX_PLANNED_FILE_PATHS);
  });
});

describe("readChangeImpactPaths", () => {
  it("reads the persisted change-impact contract", () => {
    expect(readChangeImpactPaths(RESOLVED_CONTRACT)).toEqual([
      "apps/web/lib/attention/owner-decision-copy.ts",
      "apps/web/lib/attention/owner-decision-copy.test.ts",
    ]);
  });

  it("returns empty for every malformed shape rather than throwing", () => {
    expect(readChangeImpactPaths(null)).toEqual([]);
    expect(readChangeImpactPaths("nope")).toEqual([]);
    expect(readChangeImpactPaths({})).toEqual([]);
    expect(readChangeImpactPaths({ changeImpactContract: null })).toEqual([]);
    expect(readChangeImpactPaths({ changeImpactContract: { paths: "a,b" } })).toEqual([]);
  });
});

describe("resolvePlannedFilePaths", () => {
  it("prefers the Workroom change-impact contract", async () => {
    const db = client({ workroom: RESOLVED_CONTRACT, build: { description: "apps/web/other.ts" } });
    await expect(
      resolvePlannedFilePaths({ db, buildId: "FB-1", buildRowId: "row-1" }),
    ).resolves.toEqual([
      "apps/web/lib/attention/owner-decision-copy.ts",
      "apps/web/lib/attention/owner-decision-copy.test.ts",
    ]);
    expect(db.featureBuild.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the plan document when no Workroom contract exists", async () => {
    const db = client({
      build: {
        buildPlan: "## File Structure\n- Modify: apps/web/lib/attention/owner-decision-copy.ts\n",
      },
    });
    await expect(
      resolvePlannedFilePaths({ db, buildId: "FB-1", buildRowId: "row-1" }),
    ).resolves.toEqual(["apps/web/lib/attention/owner-decision-copy.ts"]);
  });

  it("skips the Workroom lookup entirely when no row id is known", async () => {
    const db = client({ build: { buildPlan: null, description: null } });
    await resolvePlannedFilePaths({ db, buildId: "FB-1", buildRowId: null });
    expect(db.workroom.findFirst).not.toHaveBeenCalled();
  });

  it("fails open to an empty list so the gate keeps its prior behaviour", async () => {
    const db: PlannedFilePathsClient = {
      workroom: { findFirst: vi.fn(async () => { throw new Error("db down"); }) },
      featureBuild: { findUnique: vi.fn(async () => null) },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      resolvePlannedFilePaths({ db, buildId: "FB-1", buildRowId: "row-1" }),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("resolveShippedFilePaths", () => {
  const DIFF = [
    "diff --git a/apps/web/lib/attention/owner-decision-copy.ts b/apps/web/lib/attention/owner-decision-copy.ts",
    "--- a/apps/web/lib/attention/owner-decision-copy.ts",
    "+++ b/apps/web/lib/attention/owner-decision-copy.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  it("prefers the realized diff over the plan", async () => {
    const db = client({ workroom: RESOLVED_CONTRACT, build: { buildPlan: null } });
    await expect(
      resolveShippedFilePaths({ db, buildId: "FB-1", buildRowId: "row-1", diffPatch: DIFF }),
    ).resolves.toEqual(["apps/web/lib/attention/owner-decision-copy.ts"]);
    expect(db.workroom.findFirst).not.toHaveBeenCalled();
  });

  it("falls back through the build record and then the Workroom contract", async () => {
    const db = client({ workroom: RESOLVED_CONTRACT, build: { buildPlan: null } });
    await expect(
      resolveShippedFilePaths({ db, buildId: "FB-1", buildRowId: "row-1", diffPatch: null }),
    ).resolves.toEqual([
      "apps/web/lib/attention/owner-decision-copy.ts",
      "apps/web/lib/attention/owner-decision-copy.test.ts",
    ]);
  });

  it("fails open to an empty list", async () => {
    const db: PlannedFilePathsClient = {
      workroom: { findFirst: vi.fn(async () => null) },
      featureBuild: { findUnique: vi.fn(async () => { throw new Error("db down"); }) },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      resolveShippedFilePaths({ db, buildId: "FB-1", buildRowId: "row-1" }),
    ).resolves.toEqual([]);
    warn.mockRestore();
  });
});
