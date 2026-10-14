import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveGuardBash, guardShellEnv } from "./lib/guard-bash.mjs";
import { guardGitEnv } from "./lib/git-hook-env.mjs";

const workflow = readFileSync(new URL("../.github/workflows/daily-checkpoint-tag.yml", import.meta.url), "utf8");
const cutSection = workflow.split("      - name: Cut checkpoint tag if main advanced")[1]
  .split("      - name: Publish the checkpoint")[0];
const cut = cutSection.split(/        run: \|\r?\n/)[1]
  .split(/\r?\n/).map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
const env = guardShellEnv(guardGitEnv(process.env));
const bash = resolveGuardBash({ env });
const dayTag = `v${new Date().toISOString().slice(0, 10).replaceAll("-", ".")}`;

function fixture(t, { checkpoint = true, advance = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "dpf-checkpoint-fixture-"));
  t.after(() => {
    assert.ok(resolve(base).startsWith(resolve(tmpdir()) + "/") || resolve(base).startsWith(resolve(tmpdir()) + "\\"));
    rmSync(base, { recursive: true, force: true });
  });
  const root = join(base, "source"), remote = join(base, "remote.git"), output = join(base, "output");
  mkdirSync(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--bare", remote);
  git("init", "--initial-branch=main", "--quiet");
  git("config", "user.name", "Checkpoint fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(base, "unused-hooks"));
  writeFileSync(join(root, "source.txt"), "initial\n");
  git("add", "source.txt");
  git("commit", "--quiet", "-m", "initial");
  const original = git("rev-parse", "HEAD").trim();
  git("remote", "add", "origin", remote);
  git("push", "--quiet", "origin", "main");
  if (checkpoint) {
    git("tag", "-a", dayTag, "-m", "daily");
    git("push", "--quiet", "origin", `refs/tags/${dayTag}`);
  }
  if (advance) {
    writeFileSync(join(root, "source.txt"), "advanced\n");
    git("add", "source.txt");
    git("commit", "--quiet", "-m", "advanced");
    git("push", "--quiet", "origin", "main");
  }
  const run = (overrides = {}) => {
    writeFileSync(output, "");
    const result = spawnSync(bash, ["--noprofile", "--norc", "-c", cut], {
      cwd: root, env: { ...env, GITHUB_OUTPUT: output.replaceAll("\\", "/"),
        GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_RUN_NUMBER: "42", ADDITIONAL_BATCH: "true", ...overrides },
      encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    return { ...result, output: readFileSync(output, "utf8").trim() };
  };
  return { git, run, original, head: git("rev-parse", "HEAD").trim() };
}

test("default daily dispatch remains a no-op after today's checkpoint", t => {
  const f = fixture(t);
  const result = f.run({ ADDITIONAL_BATCH: "false" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "tag=");
  assert.equal(f.git("rev-list", "-n", "1", dayTag).trim(), f.original);
});

test("the first default daily dispatch still publishes the ordinary daily anchor", t => {
  const f = fixture(t, { checkpoint: false });
  const result = f.run({ ADDITIONAL_BATCH: "false" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `tag=${dayTag}`);
  assert.equal(f.git("rev-list", "-n", "1", dayTag).trim(), f.head);
});

test("an additional batch publishes the advanced head once without moving the daily anchor", t => {
  const f = fixture(t), tag = `${dayTag}-dev-recovery.42`;
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.output, `tag=${tag}`);
  assert.equal(f.git("rev-list", "-n", "1", tag).trim(), f.head);
  assert.match(f.git("ls-remote", "origin", `refs/tags/${tag}`), new RegExp(tag.replaceAll(".", "\\.")));
  assert.equal(f.git("rev-list", "-n", "1", dayTag).trim(), f.original);
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.output, "tag=");
  assert.equal(f.git("rev-list", "-n", "1", tag).trim(), f.head);
});

test("an additional batch with no new source emits no publication", t => {
  const f = fixture(t, { advance: false });
  assert.equal(f.run().output, "tag=");
  assert.equal(f.git("tag", "--list", `${dayTag}-dev-recovery.*`).trim(), "");
});

test("an additional batch requires its existing daily anchor", t => {
  const f = fixture(t, { checkpoint: false });
  assert.equal(f.run().status, 1);
  assert.equal(f.git("tag", "--list").trim(), "");
});

test("non-main refs and unsafe run identities fail without creating tags", t => {
  const f = fixture(t);
  assert.equal(f.run({ GITHUB_REF: "refs/heads/topic" }).status, 1);
  assert.equal(f.run({ GITHUB_RUN_NUMBER: "42;unsafe" }).status, 1);
  assert.equal(f.git("tag", "--list", `${dayTag}-dev-recovery.*`).trim(), "");
});

test("a conflicting immutable batch tag is refused", t => {
  const f = fixture(t), tag = `${dayTag}-dev-recovery.42`;
  f.git("tag", "-a", tag, f.original, "-m", "already published");
  f.git("push", "--quiet", "origin", `refs/tags/${tag}`);
  assert.equal(f.run().status, 1);
  assert.equal(f.git("rev-list", "-n", "1", tag).trim(), f.original);
});

test("the existing producer tests before tagging and dispatches both publishers at the identical tag", () => {
  assert.match(workflow, /additional_batch:[\s\S]*?type: boolean/);
  const verification = workflow.indexOf("node --test scripts/daily-checkpoint-tag.test.mjs");
  assert.ok(verification >= 0 && verification < workflow.indexOf("- name: Cut checkpoint tag"));
  assert.match(workflow, /dispatch publish-release\.yml \|\| rc=1/);
  assert.match(workflow, /dispatch publish-image\.yml \|\| rc=1/);
  assert.ok(workflow.includes('{"ref":"%s","inputs":{"tag":"%s"}}'));
  assert.match(workflow, /group: daily-checkpoint-tag/);
});
