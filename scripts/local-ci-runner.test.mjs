import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { planPostgresOwnership } from "./local-ci-runner.mjs";

const cli = fileURLToPath(new URL("./local-ci-runner.mjs", import.meta.url));

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function dryRun(slotKey, extraArgs = [], env = {}) {
  const candidate = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const result = spawnSync(
    process.execPath,
    [cli, "--candidate", candidate, "--slot-key", slotKey, "--dry-run", ...extraArgs],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    result.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

test("dry-run resolves all runner identities from the admitted slot", () => {
  const slot0 = dryRun("slot-0");
  const slot1 = dryRun("slot-1");

  assert.equal(slot0.manifestVersion, "1");
  assert.equal(slot1.manifestVersion, "1");
  for (const key of [
    "workspace",
    "composeProject",
    "portalUrl",
    "postgresContainer",
    "postgresDatabase",
    "metadataFile",
  ]) {
    assert.notEqual(slot0[key], slot1[key], `${key} must be slot-scoped`);
  }
  assert.match(slot0.plan, /--slot-key slot-0/);
  assert.match(slot1.plan, /--slot-key slot-1/);
});

test("online current-main refresh is the default and is resolved before the child plan", () => {
  const run = dryRun("slot-0");

  assert.equal(run.baseFreshnessPolicy, "remote-required");
  assert.equal(run.baseFreshnessStatus, "pending-admission-refresh");
  assert.equal(run.fetchBase, "1");
  assert.doesNotMatch(run.plan, /--fetch-base/);
});

test("offline accepted-base operation requires an explicit flag", () => {
  const run = dryRun("slot-0", ["--offline-accepted-base"]);

  assert.equal(run.baseFreshnessPolicy, "offline-accepted");
  assert.equal(run.baseFreshnessStatus, "offline-accepted");
  assert.equal(run.fetchBase, "0");
  assert.doesNotMatch(run.plan, /--fetch-base/);
});

test("a foreign listener never satisfies manifest Postgres ownership", () => {
  assert.equal(
    planPostgresOwnership({
      hasDocker: true,
      manifestContainerExists: false,
      manifestContainerUsesPgvector: false,
      assignedPortReachable: true,
    }),
    "foreign-port-conflict",
  );
  assert.equal(
    planPostgresOwnership({
      hasDocker: true,
      manifestContainerExists: true,
      manifestContainerUsesPgvector: true,
      assignedPortReachable: true,
    }),
    "reuse",
  );
});
