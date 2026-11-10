import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readGitDiffDigest } from "./lib/semantic-review-gate.mjs";

const cli = fileURLToPath(new URL("./semantic-review-gate.mjs", import.meta.url));
const policy = JSON.parse(readFileSync(new URL("./semantic-review-policy.json", import.meta.url), "utf8"));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-review-role-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const hooks = join(cwd, "empty-hooks");
  mkdirSync(hooks);
  git("init", "-b", "topic");
  git("config", "user.name", "Review test");
  git("config", "user.email", "review@example.invalid");
  git("-c", `core.hooksPath=${hooks}`, "commit", "--allow-empty", "-m", "base");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);
  writeFileSync(join(cwd, "scope.md"), "Immutable scope\n");
  git("add", "scope.md");
  git("-c", `core.hooksPath=${hooks}`, "commit", "-m", "scope");
  const receipt = {
    schemaVersion: policy.receiptSchemaVersion, artifactType: "spec", capsuleId: "WC-TEST",
    baseTreeHash: git("rev-parse", `${base}^{tree}`), headTreeHash: git("rev-parse", "HEAD^{tree}"),
    diffDigest: readGitDiffDigest(base, spawnSync, cwd), policyVersion: policy.policyVersion,
    reviewerVersion: policy.reviewerVersion, specialistIds: [], disposition: "reviewed",
    result: { decision: "pass", issues: [], summary: "Reviewed immutable spec." },
  };
  const path = join(cwd, "receipt.json");
  writeFileSync(path, JSON.stringify(receipt));
  return { cwd, path, receipt, run: (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" }) };
}

test("CLI binds the requested publication role independently from the receipt", t => {
  const f = fixture(t);
  const wrong = f.run("record", "--receipt-file", f.path, "--evidence-id", "evidence-1", "--artifact-type", "code-change");
  assert.notEqual(wrong.status, 0, "a spec receipt must not authorize code publication");
  const right = f.run("record", "--receipt-file", f.path, "--evidence-id", "evidence-1", "--artifact-type", "spec");
  assert.equal(right.status, 0, right.stderr);
  assert.match(f.run("validate", "--artifact-type", "spec").stdout, /fresh-receipt/);
  assert.doesNotMatch(f.run("validate", "--artifact-type", "plan").stdout, /fresh-receipt/);
  assert.doesNotMatch(f.run("validate").stdout, /fresh-receipt/, "the publication hook always expects code-change");
});

test("CLI refuses invalid roles and legacy receipts under the active contract", t => {
  const f = fixture(t);
  assert.notEqual(f.run("record", "--receipt-file", f.path, "--evidence-id", "evidence-1", "--artifact-type", "invented-role").status, 0);
  writeFileSync(f.path, JSON.stringify({ ...f.receipt, schemaVersion: "semantic-change-review-receipt.v2", artifactType: undefined }));
  assert.notEqual(f.run("record", "--receipt-file", f.path, "--evidence-id", "evidence-1").status, 0);
});

test("pnpm separator and direct form record only an exact receipt", t => {
  const f = fixture(t);
  for (const args of [[], ["--"]]) {
    const implicit = f.run(...args);
    assert.equal(implicit.status, 0, implicit.stderr);
    assert.match(implicit.stderr, /missing-receipt/);
    assert.doesNotMatch(`${implicit.stderr}${implicit.stdout}`, /unknown command/);
  }
  const tampered = join(f.cwd, "tampered.json");
  writeFileSync(tampered, JSON.stringify({ ...f.receipt, diffDigest: "e".repeat(64) }));
  const record = (prefix, file) => f.run(...prefix, "record", "--receipt-file", file, "--evidence-id", "evidence-1", "--artifact-type", "spec");
  for (const prefix of [[], ["--"]]) {
    const rejected = record(prefix, tampered);
    assert.notEqual(rejected.status, 0, prefix.join(" ") || "direct");
    assert.match(rejected.stderr, /receipt identity does not match/);
    assert.doesNotMatch(rejected.stderr, /unknown command/);
  }
  for (const prefix of [[], ["--"]]) {
    const accepted = record(prefix, f.path);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /recorded pass receipt/);
  }
  assert.match(f.run("validate", "--artifact-type", "spec").stdout, /fresh-receipt/);
  assert.match(f.run("--", "validate", "--artifact-type", "spec").stdout, /fresh-receipt/);
  const wrongRole = f.run("--", "validate");
  assert.doesNotMatch(wrongRole.stdout, /fresh-receipt/);
  assert.match(wrongRole.stderr, /stale-receipt/);
  const unknown = f.run("--", "nope");
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown command: nope/);
});

test("pnpm separator and direct form keep exemption receipt checks", t => {
  const f = fixture(t);
  for (const prefix of [[], ["--"]]) {
    const missing = f.run(...prefix, "record-exemption");
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /record-exemption requires --receipt-file/);
    assert.doesNotMatch(missing.stderr, /unknown command: --/);
  }
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: f.cwd, encoding: "utf8" });
  assert.equal(sha.status, 0, sha.stderr);
  const evidenceId = "evidence-exempt-1";
  const exemption = {
    evidenceId,
    schemaVersion: "semantic-change-review-exemption.v1",
    sourceHeadSha: sha.stdout.trim(),
    baseTreeHash: f.receipt.baseTreeHash,
    headTreeHash: f.receipt.headTreeHash,
    diffDigest: f.receipt.diffDigest,
    policyVersion: f.receipt.policyVersion,
    capsuleId: "WC-TEST",
    specialistIds: [],
    nativeReview: "UNRUN",
    reviewBasis: "operator-accepted-client-assessment",
    independentReview: "UNVERIFIED",
    approvedByUserId: "operator",
    reason: "Audited source publication exception",
    bindingDigest: "f".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const path = join(f.cwd, "exemption.json");
  const write = (body) => writeFileSync(path, JSON.stringify(body));
  write({ success: true, entityId: evidenceId, data: { exemption: { ...exemption, diffDigest: "e".repeat(64) } } });
  for (const prefix of [[], ["--"]]) {
    const rejected = f.run(...prefix, "record-exemption", "--receipt-file", path);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /exemption identity does not match/);
    assert.doesNotMatch(rejected.stderr, /unknown command/);
  }
  write({ success: true, entityId: evidenceId, data: { exemption } });
  for (const prefix of [[], ["--"]]) {
    const accepted = f.run(...prefix, "record-exemption", "--receipt-file", path);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /recorded policy exception/);
  }
  assert.match(f.run("validate").stdout, /policy-exemption/);
  assert.match(f.run("--", "validate").stdout, /policy-exemption/);
  assert.match(f.run("--", "validate").stdout, /native review UNRUN/);
});
