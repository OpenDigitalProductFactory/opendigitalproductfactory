import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { githubOutputsForPlan } from "./ci-evidence-plan.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(repoRoot, "scripts", "ci-evidence-plan.mjs");
let fixture;
let baseSha;
let headSha;

function git(...args) {
  return execFileSync("git", args, { cwd: fixture, encoding: "utf8" }).trim();
}

function write(path, contents) {
  const absolute = join(fixture, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function runCli(extraArgs = []) {
  const result = spawnSync(process.execPath, [
    cliPath,
    "--event", "pull_request",
    "--base", baseSha,
    "--head", headSha,
    ...extraArgs,
  ], {
    cwd: fixture,
    encoding: "utf8",
  });
  return result;
}

before(() => {
  fixture = mkdtempSync(join(tmpdir(), "dpf-ci-evidence-plan-"));
  git("init");
  git("config", "user.email", "ci-planner@example.invalid");
  git("config", "user.name", "CI Planner Test");
  write("apps/web/lib/orders.ts", "export const orders = [];\n");
  write(
    "apps/web/lib/orders.test.ts",
    "import { orders } from './orders';\nvoid orders;\n",
  );
  git("add", ".");
  git("commit", "-m", "base");
  baseSha = git("rev-parse", "HEAD");
  write("apps/web/lib/orders.ts", "export const orders = ['changed'];\n");
  git("add", ".");
  git("commit", "-m", "head");
  headSha = git("rev-parse", "HEAD");
});

after(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

describe("ci-evidence-plan CLI", () => {
  it("derives immutable tree identities and writes deterministic plan JSON", () => {
    const firstPath = join(fixture, "first-plan.json");
    const secondPath = join(fixture, "second-plan.json");
    const first = runCli(["--output", firstPath]);
    const second = runCli(["--output", secondPath]);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const firstText = readFileSync(firstPath, "utf8");
    const secondText = readFileSync(secondPath, "utf8");
    assert.equal(firstText, secondText);

    const plan = JSON.parse(firstText);
    assert.equal(plan.baseSha, baseSha);
    assert.equal(plan.headSha, headSha);
    assert.equal(plan.baseTreeSha, git("rev-parse", `${baseSha}^{tree}`));
    assert.equal(plan.headTreeSha, git("rev-parse", `${headSha}^{tree}`));
    assert.deepEqual(plan.changedFiles, ["apps/web/lib/orders.ts"]);
    assert.deepEqual(plan.affectedTests, ["apps/web/lib/orders.test.ts"]);
    assert.equal(plan.fullSuite, true);
    assert.ok(plan.escalations.some((entry) => entry.code === "graph-missing"));
  });

  it("writes stable GitHub outputs without embedding plan JSON in workflow expressions", () => {
    const githubOutput = join(fixture, "github-output.txt");
    const outputPath = join(fixture, "github-plan.json");
    const result = runCli([
      "--output", outputPath,
      "--github-output", githubOutput,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(githubOutput, "utf8");
    assert.match(output, /^heavy=true$/m);
    assert.match(output, /^portal_ux_required=true$/m);
    assert.match(output, /^mobile=false$/m);
    assert.match(output, /^evidence_tier=exhaustive$/m);
    assert.match(output, /^evidence_plan_digest=[a-f0-9]{64}$/m);
  });

  it("keeps portal UX scope independent from the broad heavy-CI switch", () => {
    const runtime = githubOutputsForPlan({
      eventName: "pull_request",
      fullSuite: false,
      scope: { docsOnly: false, mobileOnly: false, heavy: true, mobile: false },
      evidenceTier: "exhaustive",
      digest: "a".repeat(64),
      selection: { selectedPercentage: 100 },
    });
    const docs = githubOutputsForPlan({
      eventName: "pull_request",
      fullSuite: false,
      scope: { docsOnly: true, mobileOnly: false, heavy: false, mobile: false },
      evidenceTier: "affected",
      digest: "b".repeat(64),
      selection: { selectedPercentage: 0 },
    });
    const mobile = githubOutputsForPlan({
      eventName: "pull_request",
      fullSuite: false,
      scope: { docsOnly: false, mobileOnly: true, heavy: false, mobile: true },
      evidenceTier: "affected",
      digest: "c".repeat(64),
      selection: { selectedPercentage: 0 },
    });

    assert.match(runtime, /^heavy=true$/m);
    assert.match(docs, /^heavy=false$/m);
    assert.match(mobile, /^heavy=false$/m);
    assert.match(runtime, /^portal_ux_required=true$/m);
    assert.match(docs, /^portal_ux_required=false$/m);
    assert.match(mobile, /^portal_ux_required=false$/m);
  });

  it("requires portal UX for exhaustive and non-PR lifecycles even when the diff is docs-only", () => {
    const docsOnlyPlan = {
      eventName: "pull_request",
      fullSuite: false,
      scope: { docsOnly: true, mobileOnly: false, heavy: false, mobile: false },
      evidenceTier: "affected",
      digest: "d".repeat(64),
      selection: { selectedPercentage: 0 },
    };

    for (const eventName of ["merge_group", "push", "workflow_dispatch", "schedule", "local-ci"]) {
      const output = githubOutputsForPlan({
        ...docsOnlyPlan,
        eventName,
        fullSuite: true,
        evidenceTier: "exhaustive",
      });
      assert.match(output, /^heavy=true$/m, `${eventName} must run the heavy gates`);
      assert.match(output, /^portal_ux_required=true$/m, `${eventName} must stay exhaustive`);
    }

    const escalatedPullRequest = githubOutputsForPlan({
      ...docsOnlyPlan,
      fullSuite: true,
      evidenceTier: "exhaustive",
    });
    assert.match(escalatedPullRequest, /^heavy=true$/m);
    assert.match(escalatedPullRequest, /^portal_ux_required=true$/m);

    const missingLifecycle = githubOutputsForPlan({
      ...docsOnlyPlan,
      eventName: undefined,
    });
    assert.match(missingLifecycle, /^portal_ux_required=true$/m);
  });

  it("turns malformed optional advice into exhaustive evidence instead of aborting", () => {
    const advicePath = join(fixture, "bad-graph-advice.json");
    const outputPath = join(fixture, "fallback-plan.json");
    writeFileSync(advicePath, "{not-json");
    const result = runCli([
      "--graph-advice", advicePath,
      "--output", outputPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(plan.fullSuite, true);
    assert.ok(
      plan.escalations.some((entry) => entry.code === "planner-input-error"),
    );
  });
});
