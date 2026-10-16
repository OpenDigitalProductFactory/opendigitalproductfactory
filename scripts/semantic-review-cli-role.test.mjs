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
    reviewerVersion: policy.reviewerVersion, specialistIds: [], specialistSelectionDigest: "d".repeat(64), disposition: "reviewed",
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
