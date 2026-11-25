// Self-test for the authorized source writer entrypoint (BI-224F56F1, DI-250233FBDD9B).
//
// The writer runs only fixed operations on the install checkout mounted at
// /host-dpf. Inputs are refnames and flags, never paths or git argv.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSourceWriterRequest, runSourceWriter, SOURCE_WRITER_ROOT } from "./source-writer.mjs";

const prepare = { sourceMode: "upstream", remote: "origin", branch: "main", installBranch: "dpf/install", isolatedWorkspace: true };

test("accepts the fixed operations with refname-only inputs", () => {
  assert.deepEqual(parseSourceWriterRequest("prepare-upgrade-source", JSON.stringify(prepare)), { operation: "prepare-upgrade-source", input: prepare });
  assert.deepEqual(parseSourceWriterRequest("refresh-upstream-head", JSON.stringify({ remote: "origin", branch: "main" })),
    { operation: "refresh-upstream-head", input: { remote: "origin", branch: "main" } });
});

test("refuses unknown operations, extra fields, paths, options and malformed refnames", () => {
  const bad = [
    ["push-anything", prepare],
    ["prepare-upgrade-source", { ...prepare, workspacePath: "/etc" }],
    ["prepare-upgrade-source", { ...prepare, remote: "--upload-pack=evil" }],
    ["prepare-upgrade-source", { ...prepare, branch: "../../main" }],
    ["prepare-upgrade-source", { ...prepare, branch: "main lock" }],
    ["prepare-upgrade-source", { ...prepare, installBranch: "-x" }],
    ["prepare-upgrade-source", { ...prepare, sourceMode: "anything" }],
    ["prepare-upgrade-source", { ...prepare, isolatedWorkspace: "yes" }],
    ["refresh-upstream-head", { remote: "origin", branch: "main", extra: 1 }],
  ];
  for (const [operation, input] of bad) {
    assert.throws(() => parseSourceWriterRequest(operation, JSON.stringify(input)), /source_writer_request_invalid/, `${operation} ${JSON.stringify(input)}`);
  }
  assert.throws(() => parseSourceWriterRequest("prepare-upgrade-source", "not json"), /source_writer_request_invalid/);
  assert.throws(() => parseSourceWriterRequest("prepare-upgrade-source", "x".repeat(5000)), /source_writer_request_invalid/);
});

test("prepares the upgrade source against the fixed root and its workspace", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(" "));
    if (args.includes("rev-parse") && args.includes("HEAD")) return { code: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const result = await runSourceWriter({ operation: "prepare-upgrade-source", input: { ...prepare, sourceMode: "local" } }, run);
  assert.deepEqual(result, { ok: true, mode: "local", stamp: "a".repeat(40) });
  assert.ok(calls.every((call) => call.startsWith(`-C ${SOURCE_WRITER_ROOT} `)), calls.join("\n"));
});

test("refreshes the upstream head with exactly a fetch and a rev-parse", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return args.includes("rev-parse") ? { code: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" };
  };
  const result = await runSourceWriter({ operation: "refresh-upstream-head", input: { remote: "origin", branch: "main" } }, run);
  assert.deepEqual(result, { ok: true, upstreamSha: "b".repeat(40) });
  assert.deepEqual(calls, [
    ["-C", SOURCE_WRITER_ROOT, "fetch", "origin", "main"],
    ["-C", SOURCE_WRITER_ROOT, "rev-parse", "origin/main"],
  ]);
  const missing = await runSourceWriter({ operation: "refresh-upstream-head", input: { remote: "origin", branch: "main" } },
    async (args) => args.includes("rev-parse") ? { code: 128, stdout: "", stderr: "unknown" } : { code: 0, stdout: "", stderr: "" });
  assert.deepEqual(missing, { ok: false, reason: "no-target" });
});
