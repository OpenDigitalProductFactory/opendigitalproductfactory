import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LOCAL_CI_MISSING_DATABASE_URL,
  createLocalIntegrationChildInvocation,
  planPostgresOwnership,
  resetOwnedSlotDatabase,
} from "./local-ci-runner.mjs";

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

test("child local-integration invocation uses only the runner-owned test database", () => {
  const base = {
    repoTop: "/repo",
    candidate: "feat/topic",
    baseRef: "refs/dpf/integration/main",
    candidateSha: "candidate-sha",
    baseSha: "base-sha",
    baseFreshness: {
      status: "remote-current",
      resolvedAt: "2026-08-01T00:00:00.000Z",
      fetchMode: "fetch",
    },
    slotKey: "slot-0",
    metadataFile: "/repo/.git/dpf-local-ci-metadata.json",
  };

  const withOwnedDb = createLocalIntegrationChildInvocation({
    ...base,
    testDatabaseUrl: "postgresql://dpf:dpf_dev@127.0.0.1:15432/dpf_local_ci_slot_0",
    env: { DATABASE_URL: "postgresql://dpf:dpf_dev@127.0.0.1:5432/root" },
  });

  assert.ok(withOwnedDb.args.includes("--migrate-deploy"));
  assert.equal(
    withOwnedDb.env.DATABASE_URL,
    "postgresql://dpf:dpf_dev@127.0.0.1:15432/dpf_local_ci_slot_0",
  );

  const withoutOwnedDb = createLocalIntegrationChildInvocation({
    ...base,
    testDatabaseUrl: "",
    env: { DATABASE_URL: "postgresql://dpf:dpf_dev@127.0.0.1:5432/root" },
  });

  assert.ok(!withoutOwnedDb.args.includes("--migrate-deploy"));
  assert.equal(withoutOwnedDb.env.DATABASE_URL, LOCAL_CI_MISSING_DATABASE_URL);
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

test("an admitted runner resets only its manifest-owned disposable slot database", () => {
  const calls = [];
  resetOwnedSlotDatabase({
    container: "dpf-local-ci-postgres-0",
    database: "dpf_local_ci_0",
    run: (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    ["docker", ["exec", "dpf-local-ci-postgres-0", "dropdb", "--if-exists", "--force", "-U", "dpf", "dpf_local_ci_0"]],
    ["docker", ["exec", "dpf-local-ci-postgres-0", "createdb", "-U", "dpf", "-O", "dpf", "dpf_local_ci_0"]],
  ]);
});

test("slot database reset rejects non-manifest identities before invoking Docker", () => {
  let called = false;
  assert.throws(
    () => resetOwnedSlotDatabase({
      container: "postgres",
      database: "production",
      run: () => { called = true; return { status: 0 }; },
    }),
    /refusing non-slot Postgres reset/,
  );
  assert.equal(called, false);
});

test("slot database reset fails closed when drop or create fails", () => {
  assert.throws(
    () => resetOwnedSlotDatabase({
      container: "dpf-local-ci-postgres-1",
      database: "dpf_local_ci_1",
      run: () => ({ status: 1, stdout: "", stderr: "database busy" }),
    }),
    /could not reset disposable slot database.*database busy/,
  );
});
