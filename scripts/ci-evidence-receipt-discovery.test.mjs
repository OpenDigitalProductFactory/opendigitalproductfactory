import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runEvidenceReceiptCli } from "./ci-evidence-receipt.mjs";
import { parseAggregate } from "./merge-readiness-policy.mjs";

async function withApi(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

async function runLocateAgainst(handler) {
  const scratch = mkdtempSync(join(tmpdir(), "dpf-ci-evidence-discovery-"));
  const output = join(scratch, "github-output.txt");
  const prior = {
    api: process.env.DPF_GITHUB_API_BASE_URL,
    output: process.env.GITHUB_OUTPUT,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  };
  try {
    await withApi(handler, async (base) => {
      process.env.DPF_GITHUB_API_BASE_URL = base;
      process.env.GITHUB_OUTPUT = output;
      process.env.GITHUB_REPOSITORY = "OpenDigitalProductFactory/opendigitalproductfactory";
      process.env.GITHUB_TOKEN = "test-token";
      await runEvidenceReceiptCli(["locate"]);
    });
    return readFileSync(output, "utf8");
  } finally {
    for (const [key, value] of Object.entries({
      DPF_GITHUB_API_BASE_URL: prior.api,
      GITHUB_OUTPUT: prior.output,
      GITHUB_REPOSITORY: prior.repository,
      GITHUB_TOKEN: prior.token,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("locate emits exhaustive when no exact-tree artifact exists", async () => {
  const output = await runLocateAgainst((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ artifacts: [] }));
  });
  assert.match(output, /^found=false$/m);
  assert.match(output, /^reason=no unexpired exact-tree evidence artifact$/m);
});

test("locate converts GitHub API failure into exhaustive evidence", async () => {
  const output = await runLocateAgainst((_request, response) => {
    response.statusCode = 503;
    response.end("unavailable");
  });
  assert.match(output, /^found=false$/m);
  assert.match(
    output,
    /^reason=discovery unavailable; exhaustive evidence remains required$/m,
  );
});

test("create writes a checksummed receipt from current-run gates and artifacts", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "dpf-ci-evidence-create-"));
  const prior = Object.fromEntries([
    "DPF_CI_PLANNER_DIGEST",
    "DPF_GITHUB_API_BASE_URL",
    "GITHUB_EVENT_NAME",
    "GITHUB_OUTPUT",
    "GITHUB_REPOSITORY",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_RUN_ID",
    "GITHUB_SHA",
    "GITHUB_TOKEN",
    "NEEDS_JSON",
  ].map((key) => [key, process.env[key]]));
  try {
    const manifest = JSON.parse(readFileSync("config/merge-readiness-policy.json", "utf8"));
    const aggregate = parseAggregate(
      readFileSync(".github/workflows/ci.yml", "utf8"),
      manifest.aggregateJobId,
    );
    const needs = Object.fromEntries(
      aggregate.needs.map((jobId) => [jobId, {
        result: jobId === "exact-tree-evidence-shadow" || jobId === "policy-guards-pr"
          ? "skipped"
          : "success",
      }]),
    );
    const relatedArtifact = {
      name: "ci-evidence-plan-123-1",
      digest: `sha256:${"7".repeat(64)}`,
      size_in_bytes: 8192,
    };
    await withApi((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url.includes("/actions/runs/123/artifacts")) {
        response.end(JSON.stringify({ artifacts: [relatedArtifact] }));
      } else if (request.url.endsWith("/actions/runs/123")) {
        response.end(JSON.stringify({
          id: 123,
          event: "merge_group",
          status: "completed",
          conclusion: "success",
          head_sha: "a".repeat(40),
        }));
      } else if (request.url.includes(`/commits/${"a".repeat(40)}/check-runs`)) {
        response.end(JSON.stringify({
          check_runs: manifest.requiredContexts.map((name) => ({
            name,
            status: "completed",
            conclusion: "success",
          })),
        }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "unexpected test route" }));
      }
    }, async (base) => {
      process.env.DPF_CI_PLANNER_DIGEST = "8".repeat(64);
      process.env.DPF_GITHUB_API_BASE_URL = base;
      process.env.GITHUB_EVENT_NAME = "merge_group";
      process.env.GITHUB_OUTPUT = join(scratch, "github-output.txt");
      process.env.GITHUB_REPOSITORY = "OpenDigitalProductFactory/opendigitalproductfactory";
      process.env.GITHUB_RUN_ATTEMPT = "1";
      process.env.GITHUB_RUN_ID = "123";
      process.env.GITHUB_SHA = "a".repeat(40);
      process.env.GITHUB_TOKEN = "test-token";
      process.env.NEEDS_JSON = JSON.stringify(needs);
      await runEvidenceReceiptCli(["create", "--output-dir", scratch]);
      await runEvidenceReceiptCli([
        "validate",
        "--input-dir",
        scratch,
        "--source-run-id",
        "123",
      ]);
    });
    const receiptPath = join(scratch, "ci-evidence.json");
    const checksumPath = join(scratch, "ci-evidence.sha256");
    assert.equal(existsSync(receiptPath), true);
    assert.equal(existsSync(checksumPath), true);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.workflow.eventName, "merge_group");
    assert.deepEqual(
      receipt.gates.map((gate) => gate.jobId),
      [...aggregate.needs].sort(),
    );
    assert.deepEqual(receipt.artifacts.map((artifact) => artifact.name), [
      "ci-evidence-plan-123-1",
    ]);
    assert.match(readFileSync(checksumPath, "utf8").trim(), /^[a-f0-9]{64}$/);
    assert.match(readFileSync(join(scratch, "github-output.txt"), "utf8"), /^reusable=true$/m);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
