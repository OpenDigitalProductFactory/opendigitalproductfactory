import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  LOCAL_CI_BASE_FRESHNESS,
  classifyBaseResilience,
  refreshAcceptedBase,
  resolveBaseFreshnessPolicy,
} from "./local-ci-base-freshness.mjs";

function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "DPF Test",
      GIT_AUTHOR_EMAIL: "dpf-test@example.invalid",
      GIT_COMMITTER_NAME: "DPF Test",
      GIT_COMMITTER_EMAIL: "dpf-test@example.invalid",
      ...env,
    },
  }).trim();
}

test("freshness policy defaults online and makes offline acceptance explicit", () => {
  assert.deepEqual(resolveBaseFreshnessPolicy(), {
    mode: "remote-required",
    fetchRequired: true,
  });
  assert.deepEqual(
    resolveBaseFreshnessPolicy({ argv: ["--offline-accepted-base"] }),
    { mode: "offline-accepted", fetchRequired: false },
  );
  assert.throws(
    () => resolveBaseFreshnessPolicy({
      argv: ["--offline-accepted-base", "--fetch-base"],
    }),
    /conflicts/,
  );
});

test("online admission refresh uses origin/main that advanced after clone", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-base-freshness-"));
  try {
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const work = join(root, "work");
    git(root, ["init", "--bare", remote]);
    git(root, ["clone", remote, seed]);
    writeFileSync(join(seed, "value.txt"), "one\n");
    git(seed, ["add", "value.txt"]);
    git(seed, ["commit", "-m", "initial"]);
    git(seed, ["branch", "-M", "main"]);
    git(seed, ["push", "-u", "origin", "main"]);
    git(root, ["clone", "--branch", "main", remote, work]);
    const initial = git(work, ["rev-parse", "origin/main"]);

    writeFileSync(join(seed, "value.txt"), "two\n");
    git(seed, ["add", "value.txt"]);
    git(seed, ["commit", "-m", "advance"]);
    git(seed, ["push", "origin", "main"]);
    const advanced = git(seed, ["rev-parse", "HEAD"]);
    assert.notEqual(initial, advanced);

    const result = refreshAcceptedBase({
      policy: { mode: "remote-required", fetchRequired: true },
      baseRef: "origin/main",
      cwd: work,
      runGit: (args, cwd) => git(cwd, args),
      now: () => new Date("2026-07-31T02:00:00.000Z"),
    });

    assert.equal(result.status, LOCAL_CI_BASE_FRESHNESS.remoteCurrent);
    assert.equal(result.baseSha, advanced);
    assert.equal(git(work, ["rev-parse", "origin/main"]), advanced);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fetch failures are explicit evidence, not offline acceptance", () => {
  const result = refreshAcceptedBase({
    policy: { mode: "remote-required", fetchRequired: true },
    baseRef: "origin/main",
    cwd: "ignored",
    runGit: () => {
      throw new Error("network unavailable");
    },
    now: () => new Date("2026-07-31T02:00:00.000Z"),
  });

  assert.deepEqual(result, {
    status: LOCAL_CI_BASE_FRESHNESS.fetchFailed,
    baseSha: null,
    resolvedAt: "2026-07-31T02:00:00.000Z",
    fetchMode: null,
    error: "network unavailable",
  });
});

test("resilience evidence preserves explicit states and legacy readers", () => {
  assert.deepEqual(
    classifyBaseResilience({
      schemaVersion: 2,
      fetchBase: true,
      baseFreshness: { status: "remote-current" },
    }),
    {
      publicationMode: "deferred",
      acceptedBaseMode: "remote-current",
      networkTolerance: "network-required",
    },
  );
  assert.deepEqual(
    classifyBaseResilience({
      schemaVersion: 2,
      fetchBase: false,
      baseFreshness: { status: "offline-accepted" },
    }),
    {
      publicationMode: "deferred",
      acceptedBaseMode: "offline-accepted",
      networkTolerance: "explicit-offline",
    },
  );
  assert.deepEqual(
    classifyBaseResilience({ schemaVersion: 1, fetchBase: false }),
    {
      publicationMode: "deferred",
      acceptedBaseMode: "local-ref",
      networkTolerance: "offline-capable",
    },
  );
  assert.deepEqual(classifyBaseResilience(null), {
    publicationMode: "deferred",
    acceptedBaseMode: "unknown",
    networkTolerance: "network-required",
  });
});
