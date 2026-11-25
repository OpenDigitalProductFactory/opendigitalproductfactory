// Self-test for the authorized source writer entrypoint (BI-224F56F1, DI-250233FBDD9B).
//
// The writer runs only fixed operations on the install checkout mounted at
// /host-dpf. Inputs are refnames, flags and an approved skill body, never
// paths or git argv.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseSourceWriterRequest, runSourceWriter, SOURCE_WRITER_ROOT, writeSkillSeedFile } from "./source-writer.mjs";

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

const seedInput = (content, overrides = {}) => ({ category: "platform", skillId: "dpf-example", content,
  sha256: createHash("sha256").update(content).digest("hex"), ...overrides });

test("admits a skill seed write only with safe names and a matching digest", () => {
  const ok = seedInput("# body\n");
  assert.deepEqual(parseSourceWriterRequest("write-skill-seed", JSON.stringify(ok)), { operation: "write-skill-seed", input: ok });
  for (const bad of [
    seedInput("# body\n", { category: "../etc" }),
    seedInput("# body\n", { skillId: "Dpf/x" }),
    { ...seedInput("# body\n"), sha256: "0".repeat(64) },
    seedInput("x".repeat(64 * 1024 + 1)),
    { ...seedInput("# body\n"), path: "/etc/passwd" },
  ]) {
    assert.throws(() => parseSourceWriterRequest("write-skill-seed", JSON.stringify(bad)), /source_writer_request_invalid/);
  }
});

test("overwrites an existing seed, never creates one and never follows a symlink out", () => {
  const root = mkdtempSync(join(tmpdir(), "seed-writer-"));
  const outside = mkdtempSync(join(tmpdir(), "seed-outside-"));
  try {
    mkdirSync(join(root, "packages/dpf-skill-pack/skills/dpf-example"), { recursive: true });
    writeFileSync(join(root, "packages/dpf-skill-pack/skills/dpf-example/SKILL.md"), "# old\n");
    assert.deepEqual(writeSkillSeedFile(seedInput("# new\n"), root),
      { ok: true, status: "written", path: "packages/dpf-skill-pack/skills/dpf-example/SKILL.md" });
    assert.equal(readFileSync(join(root, "packages/dpf-skill-pack/skills/dpf-example/SKILL.md"), "utf8"), "# new\n");

    assert.deepEqual(writeSkillSeedFile(seedInput("# new\n", { skillId: "dpf-missing" }), root), { ok: false, status: "no-seed-file" });
    assert.equal(existsSync(join(root, "skills/platform/dpf-missing.skill.md")), false);

    mkdirSync(join(root, "skills"), { recursive: true });
    writeFileSync(join(outside, "dpf-escape.skill.md"), "# outside\n");
    symlinkSync(outside, join(root, "skills/platform"));
    assert.deepEqual(writeSkillSeedFile(seedInput("# pwned\n", { skillId: "dpf-escape" }), root), { ok: false, status: "no-seed-file" });
    assert.equal(readFileSync(join(outside, "dpf-escape.skill.md"), "utf8"), "# outside\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
