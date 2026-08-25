import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildHostResourceClaim,
  classifyHeavyProcess,
  findUngovernedHeavyProcesses,
  parseHostResourceArgs,
} from "./host-resource-runner.mjs";

const GiB = 1024 ** 3;

test("parses one declared resource class and a command without shell interpolation", () => {
  assert.deepEqual(
    parseHostResourceArgs(["--class", "vitest", "--", "pnpm", "--filter", "web", "test"]),
    {
      resourceClass: "vitest",
      command: "pnpm",
      commandArgs: ["--filter", "web", "test"],
    },
  );
});

test("rejects obsolete polling wait flags because queued work resumes through durable events", () => {
  assert.throws(
    () => parseHostResourceArgs(["--class", "vitest", "--wait-seconds", "30", "--", "pnpm", "test"]),
    /unknown argument: --wait-seconds/,
  );
});

test("rejects an undeclared command", () => {
  assert.throws(() => parseHostResourceArgs(["--", "pnpm", "test"]), /--class is required/);
});

test("classifies canonical heavyweight process families", () => {
  assert.equal(classifyHeavyProcess("node node_modules/typescript/bin/tsc --noEmit"), "typescript");
  assert.equal(classifyHeavyProcess("node node_modules/vitest/vitest.mjs run"), "vitest");
  assert.equal(classifyHeavyProcess("node node_modules/next/dist/bin/next build"), "next-build");
  assert.equal(classifyHeavyProcess("docker buildx build --load ."), "docker-build");
  assert.equal(classifyHeavyProcess("next dev --port 3100"), "preview");
  assert.equal(classifyHeavyProcess("node scripts/check-doc-links.mjs"), null);
});

test("reports stray heavy processes as evidence and never returns a kill instruction", () => {
  const findings = findUngovernedHeavyProcesses([
    { pid: 10, parentPid: 1, commandLine: "node node_modules/vitest/vitest.mjs run" },
    { pid: 11, parentPid: 1, commandLine: "node scripts/check-doc-links.mjs" },
  ], { governedPids: [] });

  assert.deepEqual(findings, [{
    pid: 10,
    parentPid: 1,
    resourceClass: "vitest",
    commandLine: "node node_modules/vitest/vitest.mjs run",
    disposition: "evidence-only",
  }]);
  assert.equal(JSON.stringify(findings).includes("kill"), false);
  assert.equal(JSON.stringify(findings).includes("terminate"), false);
});

test("builds one typed durable claim with host and inference evidence", () => {
  const claim = buildHostResourceClaim({
    resourceClass: "next-build",
    ownerProvider: "codex",
    ownerSessionId: "thread-1",
    worktreePath: "D:/wt",
    branchName: "feat/x",
    pid: 42,
    processIdentity: "win32:638917704000000000",
    now: new Date("2026-08-25T10:00:00.000Z"),
    totalMemoryBytes: 64 * GiB,
    availableMemoryBytes: 24 * GiB,
    inferenceResident: true,
    ungovernedProcesses: [{ pid: 9, resourceClass: "vitest", disposition: "evidence-only" }],
  });

  assert.deepEqual(claim, {
    environmentKey: "host-heavy-resource",
    ownerProvider: "codex",
    ownerSessionId: "thread-1",
    claimKey: "host-resource:thread-1:42",
    purpose: "host-resource:next-build",
    url: "host://localhost",
    ports: [],
    expiresAt: "2026-08-25T10:10:00.000Z",
    worktreePath: "D:/wt",
    branchName: "feat/x",
    resourceClass: "next-build",
    expectedMemoryBytes: 16 * GiB,
    ownerProcessId: 42,
    ownerProcessIdentity: "win32:638917704000000000",
    hostResource: {
      totalMemoryBytes: 64 * GiB,
      availableMemoryBytes: 24 * GiB,
      inferenceResident: true,
      ungovernedProcesses: [{ pid: 9, resourceClass: "vitest", disposition: "evidence-only" }],
    },
  });
});

test("canonical heavyweight package scripts cannot bypass the governed runner", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.typecheck, /host-resource-runner\.mjs --class typescript/);
  assert.match(manifest.scripts.test, /host-resource-runner\.mjs --class vitest/);
  assert.match(manifest.scripts.build, /host-resource-runner\.mjs --class next-build/);
  assert.match(manifest.scripts.dev, /host-resource-runner\.mjs --class preview/);
});
