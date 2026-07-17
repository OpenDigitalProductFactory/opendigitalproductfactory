import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverGuardFiles } from "./check-guards.mjs";

test("guard follows check-no convention and delegates to the canonical checker", async () => {
  const source=await readFile(new URL("./check-no-substrate-regression.mjs",import.meta.url),"utf8");
  assert.match(source,/runSubstrateMeasurement/);
  assert.match(new URL("./check-no-substrate-regression.mjs",import.meta.url).pathname,/check-no-/);
  const discovered=discoverGuardFiles(readdirSync(new URL(".",import.meta.url)));
  assert.ok(discovered.guards.includes("check-no-substrate-regression.mjs"));
  assert.ok(discovered.tests.has("check-no-substrate-regression.test.mjs"));
  const execution=spawnSync(process.execPath,[fileURLToPath(new URL("./check-no-substrate-regression.mjs",import.meta.url))],{encoding:"utf8"});
  assert.equal(execution.status,0,execution.stderr);
  assert.match(execution.stdout,/guard passed/i);
});
