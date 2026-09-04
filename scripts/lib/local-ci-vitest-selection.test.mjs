import assert from "node:assert/strict";
import test from "node:test";

import {
  EXHAUSTIVE_ENV,
  exhaustiveTrigger,
  resolveVitestSelection,
} from "./local-ci-vitest-selection.mjs";

const BASE = "origin/main";
const NO_ENV = {};

test("narrows to the affected suite for an ordinary source diff", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["apps/web/lib/nonprod/local-ci-pool-policy.ts"],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "affected");
  assert.equal(selection.stage, "affected-vitest");
  assert.deepEqual(selection.extraArgs, [`--changed=${BASE}`]);
});

test("falls back to exhaustive when the base ref is missing", () => {
  const selection = resolveVitestSelection({
    baseRef: "",
    changedFiles: ["apps/web/lib/foo.ts"],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.stage, "exhaustive-vitest");
  assert.deepEqual(selection.extraArgs, []);
  assert.equal(selection.reason, "no-base-ref");
});

test("an unreadable diff is exhaustive, never empty", () => {
  // changedFilesAgainst returns null when git fails. Reading that as "nothing
  // changed" would run zero tests and report a pass.
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: null,
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.reason, "changed-files-unreadable");
});

test("an empty diff is exhaustive, not a licence to run nothing", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: [],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.reason, "empty-diff");
});

test("a whitespace-only file list is still treated as empty", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["", "   ", null],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.reason, "empty-diff");
});

test("files whose blast radius the module graph cannot see force exhaustive", () => {
  const unbounded = [
    "apps/web/vitest.config.ts",
    "tsconfig.json",
    "apps/web/tsconfig.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "apps/web/next.config.mjs",
    "packages/db/prisma/schema.prisma",
    "packages/db/prisma/migrations/20260829_x/migration.sql",
    "apps/web/test-setup.ts",
    "apps/web/vitest.setup.ts",
    "apps/web/test/helpers.ts",
    ".env.local",
  ];
  for (const file of unbounded) {
    const selection = resolveVitestSelection({
      baseRef: BASE,
      changedFiles: ["apps/web/lib/ordinary.ts", file],
      env: NO_ENV,
    });
    assert.equal(selection.mode, "exhaustive", `${file} should force exhaustive`);
    assert.match(selection.reason, /^blast-radius-unbounded:/);
  }
});

test("windows path separators are normalized before matching", () => {
  assert.equal(
    exhaustiveTrigger(["packages\\db\\prisma\\schema.prisma"]),
    "packages/db/prisma/schema.prisma",
  );
});

test("a lookalike path does not trigger exhaustive", () => {
  // `my-package.json` and `tsconfig-notes.md` must not be read as the real
  // config files; an over-eager trigger silently returns the stage to
  // always-exhaustive and the regression would be invisible.
  assert.equal(
    exhaustiveTrigger([
      "apps/web/lib/my-package.json.ts",
      "docs/tsconfig-notes.md",
      "apps/web/lib/vitest-helpers.ts",
    ]),
    null,
  );
});

test("the opt-out is honoured and records its reason", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["apps/web/lib/foo.ts"],
    env: { [EXHAUSTIVE_ENV]: "verifying a suspected selection miss" },
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(
    selection.reason,
    "opt-out:verifying a suspected selection miss",
  );
});

test("an empty opt-out value does not disable selection", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["apps/web/lib/foo.ts"],
    env: { [EXHAUSTIVE_ENV]: "  " },
  });
  assert.equal(selection.mode, "affected");
});

test("every returned shape carries the four fields callers read", () => {
  for (const input of [
    { baseRef: BASE, changedFiles: ["apps/web/lib/foo.ts"] },
    { baseRef: "", changedFiles: null },
  ]) {
    const selection = resolveVitestSelection({ ...input, env: NO_ENV });
    for (const key of ["mode", "stage", "extraArgs", "reason"]) {
      assert.ok(key in selection, `missing ${key}`);
    }
    assert.ok(Array.isArray(selection.extraArgs));
    assert.ok(selection.reason.length > 0);
  }
});
