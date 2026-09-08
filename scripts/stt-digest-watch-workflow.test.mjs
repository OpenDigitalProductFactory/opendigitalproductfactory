// BI-BBD60CF8 — the STT Digest Watch must survive its own success signal.
//
// `re-resolve-stt-digest.mjs --apply` exits 3 when it rewrote the pin, by
// design: "so callers know a change was made". The workflow step runs under
// `bash -e`, so an unguarded call aborts on the ONLY path the watch exists to
// serve — the drift day — and every downstream line (contract tests, manifest
// guard, commit, push, PR, auto-merge) never runs.
//
// The script itself was never broken and its own unit tests always passed. What
// went untested was the WIRING, so this reads the workflow rather than the
// script, and executes the guarded fragment against a stub that exits 3 instead
// of asserting on the presence of `set +e`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const WORKFLOW_PATH = ".github/workflows/stt-digest-watch.yml";
const workflow = readFileSync(WORKFLOW_PATH, "utf8");

/** The `run:` body of one named step, dedented. */
function stepScript(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `step "${name}" not found in ${WORKFLOW_PATH}`);
  const runAt = workflow.indexOf("run: |", start);
  assert.notEqual(runAt, -1, `step "${name}" has no run block`);
  const lines = workflow.slice(workflow.indexOf("\n", runAt) + 1).split("\n");
  const body = [];
  for (const line of lines) {
    // The block ends at the next line that is not blank and not indented into it.
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

const applyScript = stepScript("Apply re-pin and open PR");
const checkScript = stepScript("Check pinned digest against the live registry");

/**
 * Run the leading guard of a step under `bash -e`, with the re-resolve script
 * replaced by a stub exiting `code`, and report whether execution continued past
 * it. Everything from the first `git config` on is dropped so the test never
 * touches git, the network, or the registry.
 */
function survivesExitCode(script, code) {
  const guard = script.slice(0, script.indexOf("git config"));
  const stubbed = guard
    // Replace the real invocations with a stub carrying the exit code.
    .replace(/node scripts\/release\/re-resolve-stt-digest\.mjs[^\n]*/g, `( exit ${code} )`)
    // The verification commands are not what this test is about.
    .replace(/node --test[^\n]*/g, ":")
    .replace(/node scripts\/release\/verify-compose-image-manifests\.mjs[^\n]*/g, ":");
  const result = spawnSync("bash", ["-e", "-c", `${stubbed}\necho REACHED_END`], {
    encoding: "utf8",
  });
  return { reached: (result.stdout ?? "").includes("REACHED_END"), status: result.status };
}

describe("STT Digest Watch — apply step", () => {
  it("continues past the documented drift exit code", () => {
    // Exit 3 means "I rewrote the pin". The step must go on to commit it.
    const { reached } = survivesExitCode(applyScript, 3);
    assert.equal(
      reached,
      true,
      "the apply step aborted on exit 3 — the drift signal — so the re-pin is written but never committed",
    );
  });

  it("continues when there was nothing to re-pin", () => {
    assert.equal(survivesExitCode(applyScript, 0).reached, true);
  });

  it("still fails on a real error from the re-resolve script", () => {
    // Exit 2 is usage / Docker Hub API failure. Tolerating everything would
    // trade this bug for a worse one: committing a pin that was never resolved.
    const { reached, status } = survivesExitCode(applyScript, 2);
    assert.equal(reached, false, "exit 2 (API/usage failure) must stop the step");
    assert.equal(status, 2, "the step should surface the script's own exit code");
  });
});

/**
 * BI-8CEBDD09. Run the tail of the apply step — everything from `gh pr create`
 * on — with `gh` replaced by a stub, and report what the step did. The refusal
 * text is the real one GitHub returns when "Allow GitHub Actions to create and
 * approve pull requests" is off.
 */
function runPrHandoff({ prCreateFails, issueAlreadyOpen = false }) {
  const tail = applyScript.slice(applyScript.indexOf("# BI-8CEBDD09"));
  const dir = mkdtempSync(join(tmpdir(), "stt-watch-"));
  const log = join(dir, "gh.log");
  const refusal = "GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)";
  // A stub `gh` that records every call and fails only `pr create`.
  const stub = [
    "#!/usr/bin/env bash",
    `echo "$@" >> ${JSON.stringify(log)}`,
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
    prCreateFails ? `  echo ${JSON.stringify(refusal)}; exit 1` : "  echo created; exit 0",
    "fi",
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then',
    issueAlreadyOpen ? "  echo 4242; exit 0" : "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, stub, { mode: 0o755 });
  const summary = join(dir, "summary.md");
  const result = spawnSync("bash", ["-e", "-c", tail], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      BRANCH: "bot/stt-digest-repin",
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      RUNNER_TEMP: dir,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return {
    status: result.status,
    calls,
    summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
    dispatchedCi: calls.includes("workflow run ci.yml"),
    dispatchedGates: calls.includes("workflow run release-gates.yml"),
    createdIssue: calls.includes("issue create"),
    armedAutoMerge: calls.includes("pr merge"),
  };
}

describe("STT Digest Watch — PR hand-off when Actions may not open PRs (BI-8CEBDD09)", () => {
  it("still dispatches the required checks onto the pushed branch", () => {
    // The refusal used to abort the step under `bash -e`, so the branch was
    // pushed and then abandoned: no checks, no auto-merge, no PR.
    const r = runPrHandoff({ prCreateFails: true });
    assert.equal(r.dispatchedCi, true, "ci.yml was not dispatched after the refusal");
    assert.equal(r.dispatchedGates, true, "release-gates.yml was not dispatched after the refusal");
  });

  it("raises one hand-off issue carrying the compare link", () => {
    const r = runPrHandoff({ prCreateFails: true });
    assert.equal(r.createdIssue, true, "no issue was raised, so the stranded branch is invisible");
    assert.match(r.summary, /compare\/main\.\.\.bot\/stt-digest-repin/);
    assert.match(r.summary, /Allow GitHub Actions to create and approve pull requests/);
  });

  it("does not pile up an issue per daily run", () => {
    const r = runPrHandoff({ prCreateFails: true, issueAlreadyOpen: true });
    assert.equal(r.createdIssue, false, "a second issue was opened while one was already waiting");
  });

  it("still reports failure, because the loop did not close on its own", () => {
    assert.notEqual(runPrHandoff({ prCreateFails: true }).status, 0);
  });

  it("arms auto-merge and succeeds on the happy path", () => {
    const r = runPrHandoff({ prCreateFails: false });
    assert.equal(r.armedAutoMerge, true, "auto-merge was not armed after a successful PR creation");
    assert.equal(r.createdIssue, false, "an issue was raised even though the PR opened");
    assert.equal(r.status, 0);
  });
});

describe("STT Digest Watch — check step", () => {
  it("decodes the drift exit code rather than dying on it", () => {
    // The check step was always correct; this pins that so a future edit cannot
    // reintroduce the same inversion at the other end of the workflow.
    assert.match(checkScript, /set \+e/);
    assert.match(checkScript, /code=\$\?/);
    assert.match(checkScript, /"\$code"\s*=\s*"3"/);
    assert.match(checkScript, /drift=true/);
  });

  it("treats an unreachable registry as no-drift rather than a failure", () => {
    assert.match(checkScript, /Docker Hub API unavailable/);
  });
});
