import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const web = workflow.jobs["test-web"];
const qualification = web.steps.find(step => step.id === "workroom-ingestion-scale");

test("scale qualification requires explicit manual opt-in on one owned database", () => {
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.workroom_ingestion_scale, {
    description: "Qualify Workroom ingestion at 10000 rooms and 100000 events on the CI-owned database",
    required: false, type: "boolean", default: false,
  });
  assert.equal(qualification.if,
    "github.event_name == 'workflow_dispatch' && inputs.workroom_ingestion_scale == true && matrix.shard == 1");
  assert.equal(web.services.postgres.env.POSTGRES_DB, "dpf");
  assert.equal(qualification.env.DPF_INGESTION_TEST_DATABASE_URL, "${{ env.DATABASE_URL }}");
  assert.match(web.env.DATABASE_URL, /@localhost:5432\/dpf$/);
  assert.equal(qualification.env.DPF_INGESTION_SCALE_QUALIFICATION, "1");
  assert.equal(qualification.env.NODE_OPTIONS, "--max-old-space-size=4096");
  const migrations = web.steps.findIndex(step => step.name === "Apply migrations");
  assert.ok(migrations >= 0 && migrations < web.steps.indexOf(qualification));
});

test("scale execution has a scoped command, deadline and failure-preserving artifacts", () => {
  assert.equal(qualification["timeout-minutes"], 35);
  assert.match(qualification.run, /set -euo pipefail/);
  assert.match(qualification.run, /vitest run lib\/work-management\/room-review-ingestion\.scale\.postgres\.test\.ts --maxWorkers=1/);
  assert.match(qualification.run, /--reporter=default --reporter=json/);
  assert.match(qualification.run, /tee "\$RUNNER_TEMP\/workroom-ingestion-scale\.log"/);
  assert.match(qualification.run, /scale\?\.status !== 'passed'/);
  assert.match(qualification.run, /report\.numPendingTests !== 0/);
  assert.match(qualification.run, /JSON\.parse\(readFileSync/);
  assert.equal(qualification["continue-on-error"], undefined);
  const upload = web.steps.find(step => step.name === "Retain Workroom scale qualification evidence");
  assert.equal(upload.if, "always() && steps.workroom-ingestion-scale.outcome != 'skipped'");
  assert.equal(upload.uses, "actions/upload-artifact@v7");
  assert.match(upload.with.path, /workroom-ingestion-scale\.json/);
  assert.match(upload.with.path, /workroom-ingestion-scale\.log/);
  assert.match(upload.with.path, /workroom-ingestion-scale-source\.json/);
  assert.equal(upload.with["if-no-files-found"], "error");
});

test("the actual CI report validator refuses skipped or failed scale, rather than accepting auditor-only green", () => {
  const blocks = [...qualification.run.matchAll(/node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/g)];
  const validator = blocks.at(-1)?.[1];
  assert.ok(validator);
  const directory = mkdtempSync(join(tmpdir(), "workroom-scale-report-"));
  try {
    for (const [status, failed, pending, expectedExit] of [
      ["skipped", 0, 1, 1], ["failed", 1, 0, 1], ["passed", 0, 0, 0],
    ]) {
      // Only the JSON-result guard is exercised here; this is not a database result.
      writeFileSync(join(directory, "workroom-ingestion-scale.json"), JSON.stringify({
        numFailedTests: failed, numPendingTests: pending,
        testResults: [{ assertionResults: [{
          fullName: "admitted PostgreSQL ingestion scale qualification preserves bounded SQL pages, sparse turns and durable cursor/output effects at the declared load",
          status,
        }] }],
      }));
      const run = spawnSync(process.execPath, ["--input-type=module"], {
        input: validator, env: { ...process.env, RUNNER_TEMP: directory }, encoding: "utf8",
      });
      assert.equal(run.status, expectedExit, `${status}: ${run.stderr}`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
