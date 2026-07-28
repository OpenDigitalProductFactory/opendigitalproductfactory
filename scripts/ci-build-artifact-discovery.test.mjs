import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/ci-build-artifact.mjs");
const SHA = "9".repeat(40);

/**
 * BI-149370BD. These exercise the real `locate` CLI against a stubbed Actions
 * API, because the reported defect was in the polling loop rather than in the
 * per-poll decision: discovery kept polling to the full deadline even after
 * every exact-tree producer had gone terminal without publishing a build.
 */
function stubActionsApi({ runs, artifactsByRun = {} }) {
  let runsRequests = 0;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.includes("/actions/workflows/")) {
      runsRequests += 1;
      res.end(JSON.stringify({ workflow_runs: runs }));
      return;
    }
    const runId = Number(req.url.match(/\/actions\/runs\/(\d+)\/artifacts/)?.[1]);
    res.end(JSON.stringify({ artifacts: artifactsByRun[runId] ?? [] }));
  });
  return {
    server,
    listen: () => new Promise((r) => server.listen(0, "127.0.0.1", r)),
    baseUrl: () => `http://127.0.0.1:${server.address().port}`,
    runsRequests: () => runsRequests,
  };
}

function producer(overrides) {
  return {
    id: 501,
    head_sha: SHA,
    event: "pull_request",
    run_number: 7,
    run_attempt: 1,
    status: "completed",
    ...overrides,
  };
}

async function runLocate(stub, { waitSeconds }) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-locate-"));
  const outputPath = join(dir, "github-output");
  writeFileSync(outputPath, "");
  const startedAt = Date.now();
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [SCRIPT, "locate", "--workflow", "ci.yml", "--artifact-prefix", "web-production-build",
      "--wait-seconds", String(waitSeconds)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DPF_GITHUB_API_BASE_URL: stub.baseUrl(),
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: "OpenDigitalProductFactory/opendigitalproductfactory",
        GITHUB_TOKEN: "stub-token",
        GITHUB_EVENT_NAME: "pull_request",
        DPF_CI_RUN_HEAD_SHA: SHA,
        GITHUB_STEP_SUMMARY: "",
      },
    },
  );
  const output = readFileSync(outputPath, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { elapsedMs: Date.now() - startedAt, output, stdout, stderr };
}

describe("locate discovery termination", () => {
  const servers = [];
  after(() => servers.forEach((s) => s.close()));

  it("returns fallback immediately when every producer is terminal without an artifact", async () => {
    const stub = stubActionsApi({ runs: [producer({})] });
    servers.push(stub.server);
    await stub.listen();

    const result = await runLocate(stub, { waitSeconds: 600 });

    assert.match(result.output, /found=false/);
    assert.ok(
      result.elapsedMs < 15_000,
      `expected immediate fallback, waited ${result.elapsedMs}ms`,
    );
    assert.equal(stub.runsRequests(), 1, "should not have polled again");
  });

  it("keeps polling while an eligible producer is still active", async () => {
    const stub = stubActionsApi({ runs: [producer({ status: "in_progress" })] });
    servers.push(stub.server);
    await stub.listen();

    const result = await runLocate(stub, { waitSeconds: 6 });

    assert.match(result.output, /found=false/);
    assert.ok(result.elapsedMs >= 5_000, `expected bounded polling, exited in ${result.elapsedMs}ms`);
    assert.ok(stub.runsRequests() > 1, "should have polled more than once");
  });

  it("consumes an available artifact", async () => {
    const stub = stubActionsApi({
      runs: [producer({})],
      artifactsByRun: { 501: [{ id: 900, name: "web-production-build-501-1", expired: false }] },
    });
    servers.push(stub.server);
    await stub.listen();

    const result = await runLocate(stub, { waitSeconds: 600 });

    assert.match(result.output, /found=true/);
    assert.match(result.output, /artifact_name=web-production-build-501-1/);
    assert.match(result.output, /source_run_id=501/);
  });

  it("fails safe to fallback when the Actions API errors", async () => {
    const server = createServer((req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    servers.push(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const stub = {
      baseUrl: () => `http://127.0.0.1:${server.address().port}`,
      runsRequests: () => 0,
      server,
    };

    const result = await runLocate(stub, { waitSeconds: 600 });

    assert.match(result.output, /found=false/);
    assert.ok(result.elapsedMs < 15_000, `expected fast fail-safe, waited ${result.elapsedMs}ms`);
  });
});
