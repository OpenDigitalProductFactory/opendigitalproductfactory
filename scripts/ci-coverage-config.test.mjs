import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const webConfig = readFileSync("apps/web/vitest.config.ts", "utf8");
const dbConfig = readFileSync("packages/db/vitest.config.ts", "utf8");
const webPackage = JSON.parse(readFileSync("apps/web/package.json", "utf8"));
const dbPackage = JSON.parse(readFileSync("packages/db/package.json", "utf8"));
const calibrationWorkflow = readFileSync(".github/workflows/ci-calibration.yml", "utf8");

test("web V8 coverage explicitly includes owned production surfaces", () => {
  assert.match(webConfig, /coverage:\s*\{/);
  assert.match(webConfig, /provider:\s*["']v8["']/);
  assert.doesNotMatch(webConfig, /\ball:\s*true/);
  for (const pattern of [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "proxy.ts",
    "instrumentation.ts",
  ]) {
    assert.match(webConfig, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(webConfig, /\*\*\/\*\.\{test,spec\}\.\{ts,tsx\}/);
  assert.match(webConfig, /reportOnFailure:\s*true/);
});

test("database V8 coverage explicitly includes unloaded owned source", () => {
  assert.match(dbConfig, /coverage:\s*\{/);
  assert.match(dbConfig, /provider:\s*["']v8["']/);
  assert.doesNotMatch(dbConfig, /\ball:\s*true/);
  assert.match(dbConfig, /src\/\*\*\/\*\.ts/);
  assert.match(dbConfig, /\*\*\/\*\.\{test,spec\}\.ts/);
  assert.match(dbConfig, /reportOnFailure:\s*true/);
});

test("web and database packages declare complete coverage runtimes", () => {
  for (const manifest of [webPackage, dbPackage]) {
    assert.equal(manifest.scripts["test:coverage"], "vitest run --coverage");
    assert.equal(manifest.devDependencies["@vitest/coverage-v8"], "^4.1.10");
  }
});

test("calibration workflow is scheduled, manual, observable, and non-blocking to PRs", () => {
  assert.match(calibrationWorkflow, /^name:\s*CI Calibration/m);
  assert.match(calibrationWorkflow, /^\s+schedule:/m);
  assert.match(calibrationWorkflow, /cron:\s*["']0 6 \* \* 1,4["']/);
  assert.match(calibrationWorkflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(calibrationWorkflow, /^\s+pull_request:/m);
  assert.match(calibrationWorkflow, /actions:\s*read/);
  assert.match(calibrationWorkflow, /actions\/cache\/restore@v5/);
  assert.match(calibrationWorkflow, /actions\/cache\/save@v5/);
  assert.match(calibrationWorkflow, /name:\s*Run web coverage/);
  assert.match(calibrationWorkflow, /name:\s*Run database coverage/);
  assert.match(calibrationWorkflow, /name:\s*Run shadow related tests/);
  assert.match(calibrationWorkflow, /name:\s*Assemble CI observation/);
  assert.match(calibrationWorkflow, /name:\s*ci-observation/);
  assert.match(calibrationWorkflow, /retention-days:\s*30/);
  assert.match(calibrationWorkflow, /pgvector\/pgvector:pg16/);
  assert.match(calibrationWorkflow, /prisma migrate deploy/);
  assert.match(calibrationWorkflow, /--reporter=json/);
  assert.match(calibrationWorkflow, /--previous-observation/);
  assert.match(calibrationWorkflow, /path:\s*artifacts\/ci-observation/);
});

test("calibration measures both pnpm and exact-key Turbopack cache economics", () => {
  assert.match(calibrationWorkflow, /cacheName:\s*["']pnpm-store["']/);
  assert.match(calibrationWorkflow, /cacheName:\s*["']turbopack-build["']/);
  assert.match(calibrationWorkflow, /pnpmRestoreMs/);
  assert.match(calibrationWorkflow, /pnpmSaveMs/);
  assert.match(calibrationWorkflow, /turbopackRestoreMs/);
  assert.match(calibrationWorkflow, /turbopackSaveMs/);
  assert.match(calibrationWorkflow, /du -sb "\$PNPM_STORE_PATH"/);
  assert.match(calibrationWorkflow, /du -sb apps\/web\/\.next\/cache/);
  assert.doesNotMatch(calibrationWorkflow, /restoreMs:\s*hit\w*\s*\?\s*1/);
  assert.doesNotMatch(
    calibrationWorkflow,
    /key:\s*nextjs-[\s\S]{0,300}restore-keys:/,
  );
});
