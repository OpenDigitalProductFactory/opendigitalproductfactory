// scripts/check-no-expired-baseline-budgets.test.mjs
// BI-3F17B16B — self-test for the owned-expiring-budget baseline guard, plus
// the shared budget helpers in scripts/lib/baseline-budget.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  budgetForFile,
  checkBaselineBudgets,
  discoverBaselineFiles,
} from "./check-no-expired-baseline-budgets.mjs";
import {
  formatBudgetedFileMap,
  formatTxtBudgetHeader,
  parseTxtBudgetHeader,
  readBudgetedFileMap,
  validateBudget,
} from "./lib/baseline-budget.mjs";

const TODAY = "2026-08-18";

test("validateBudget passes a well-formed unexpired budget", () => {
  assert.deepEqual(
    validateBudget({ owner: "platform-architecture", expiry: "2026-11-16" }, { today: TODAY }),
    [],
  );
});

test("validateBudget fails a missing owner, malformed expiry, and an expired budget", () => {
  assert.match(validateBudget({ expiry: "2026-11-16" }, { today: TODAY }).join("\n"), /missing budget owner/);
  assert.match(validateBudget({ owner: "x", expiry: "soon" }, { today: TODAY }).join("\n"), /malformed budget expiry/);
  assert.match(
    validateBudget({ owner: "x", expiry: "2026-08-17" }, { today: TODAY }).join("\n"),
    /EXPIRED on 2026-08-17/,
  );
});

test("txt header round-trips and tolerates union-merge duplicate header lines", () => {
  const header = formatTxtBudgetHeader({ owner: "platform-architecture", expiry: "2026-11-16", noteLines: ["shrink-only"] });
  const parsed = parseTxtBudgetHeader(`${header}${header}apps/web/lib/a.ts\t900\n# owner: not-this-one\n`);
  assert.deepEqual(parsed, { owner: "platform-architecture", expiry: "2026-11-16" });
});

test("budgetForFile reads JSON top-level fields and txt headers; malformed JSON yields nulls", () => {
  assert.deepEqual(
    budgetForFile("scripts/x-baseline.json", '{"owner":"a","expiry":"2026-11-16","files":{}}'),
    { owner: "a", expiry: "2026-11-16" },
  );
  assert.deepEqual(
    budgetForFile("scripts/x-baseline.txt", "# owner: a\n# expiry: 2026-11-16\nfoo\t1\n"),
    { owner: "a", expiry: "2026-11-16" },
  );
  assert.deepEqual(budgetForFile("scripts/x-baseline.json", "{nope"), { owner: null, expiry: null });
});

test("readBudgetedFileMap accepts both the envelope and the legacy bare map", () => {
  const envelope = JSON.parse(formatBudgetedFileMap({ "b.ts": 2, "a.ts": 1 }, { owner: "o", expiry: "2026-11-16" }));
  assert.deepEqual(Object.keys(envelope.files), ["a.ts", "b.ts"]);
  const viaEnvelope = readBudgetedFileMap(envelope);
  assert.equal(viaEnvelope.budget.owner, "o");
  assert.deepEqual(viaEnvelope.files, { "a.ts": 1, "b.ts": 2 });
  const legacy = readBudgetedFileMap({ "a.ts": 1 });
  assert.equal(legacy.budget.owner, null);
  assert.deepEqual(legacy.files, { "a.ts": 1 });
});

test("discoverBaselineFiles finds *-baseline.{json,txt} and the boundary registry", () => {
  const files = discoverBaselineFiles(["module-size-baseline.txt", "style-drift-baseline.json", "check-guards.mjs"]);
  assert.deepEqual(files, [
    "scripts/application-boundaries.json",
    "scripts/module-size-baseline.txt",
    "scripts/style-drift-baseline.json",
  ]);
});

test("an unclassified baseline without a budget fails; a budgeted one passes", () => {
  const files = {
    "scripts/new-thing-baseline.txt": "foo\t1\n",
    "scripts/good-baseline.json": '{"owner":"o","expiry":"2026-11-16","files":{}}',
  };
  const { failures } = checkBaselineBudgets({
    discovered: Object.keys(files).sort(),
    readFile: (rel) => files[rel] ?? null,
    exempt: {},
    deferred: [],
    perRow: {},
    today: TODAY,
  });
  assert.equal(failures.length, 2); // missing owner + missing expiry, only for the txt file
  assert.match(failures.join("\n"), /new-thing-baseline\.txt/);
  assert.doesNotMatch(failures.join("\n"), /good-baseline\.json/);
});

test("an expired budget fails even when classified nowhere else", () => {
  const { failures } = checkBaselineBudgets({
    discovered: ["scripts/old-baseline.json"],
    readFile: () => '{"owner":"o","expiry":"2026-01-01","files":{}}',
    exempt: {},
    deferred: [],
    perRow: {},
    today: TODAY,
  });
  assert.match(failures.join("\n"), /EXPIRED on 2026-01-01/);
});

test("deferred legacy files are inventoried, not enforced — until they gain a budget", () => {
  const clean = checkBaselineBudgets({
    discovered: ["scripts/legacy-baseline.txt"],
    readFile: () => "foo\t1\n",
    exempt: {},
    deferred: ["scripts/legacy-baseline.txt"],
    perRow: {},
    today: TODAY,
  });
  assert.deepEqual(clean.failures, []);

  const converted = checkBaselineBudgets({
    discovered: ["scripts/legacy-baseline.txt"],
    readFile: () => "# owner: o\n# expiry: 2026-11-16\nfoo\t1\n",
    exempt: {},
    deferred: ["scripts/legacy-baseline.txt"],
    perRow: {},
    today: TODAY,
  });
  assert.match(converted.failures.join("\n"), /remove its DEFERRED row/);
});

test("stale EXEMPT / DEFERRED rows for deleted files fail", () => {
  const { failures } = checkBaselineBudgets({
    discovered: [],
    readFile: () => null,
    exempt: { "scripts/gone-baseline.json": "why" },
    deferred: ["scripts/also-gone-baseline.txt"],
    perRow: {},
    today: TODAY,
  });
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /gone-baseline\.json: EXEMPT entry is stale/);
  assert.match(failures.join("\n"), /also-gone-baseline\.txt: DEFERRED entry is stale/);
});

test("the LIVE repo passes the guard (the conversion actually happened)", () => {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(scriptsDir, "..");
  const discovered = discoverBaselineFiles(readdirSync(scriptsDir));
  const { failures } = checkBaselineBudgets({
    discovered,
    readFile: (rel) => (existsSync(join(repoRoot, rel)) ? readFileSync(join(repoRoot, rel), "utf8") : null),
  });
  assert.deepEqual(failures, []);
});

// ── BI-24A1264B: per-metric budgets on the substrate baseline ───────────────
// The substrate baseline was EXEMPT as a "generated measurement snapshot",
// which is true of its informational rows and false of its ratchets. A
// non-increasing metric becomes owned debt the moment it is RAISED, so the
// budget lives per row rather than per file.

const { checkPerMetricBudgets, PER_ROW_BUDGETS } = await import("./check-no-expired-baseline-budgets.mjs");

const substrateBaseline = (metrics) => JSON.stringify({ version: 1, metrics });

test("an unraised ratchet carries no budget and is not a finding", () => {
  const text = substrateBaseline({
    defaultRequiredServiceCount: { direction: "non-increasing", value: 5 },
    prismaSchemaLines: { direction: "informational", value: 19700 },
  });
  assert.deepEqual(checkPerMetricBudgets("scripts/platform-substrate-baseline.json", text, "2026-09-16"), []);
});

test("a raised ratchet with a live budget passes", () => {
  const text = substrateBaseline({
    defaultRequiredServiceCount: {
      direction: "non-increasing",
      value: 7,
      owner: "platform-architecture",
      expiry: "2026-12-31",
      contraction: "EP-8B9B50D5",
    },
  });
  assert.deepEqual(checkPerMetricBudgets("scripts/platform-substrate-baseline.json", text, "2026-09-16"), []);
});

test("an EXPIRED per-metric budget fails — the freeze must not outlive its mandate", () => {
  const text = substrateBaseline({
    defaultRequiredServiceCount: {
      direction: "non-increasing",
      value: 7,
      owner: "platform-architecture",
      expiry: "2026-08-01",
      contraction: "EP-8B9B50D5",
    },
  });
  const failures = checkPerMetricBudgets("scripts/platform-substrate-baseline.json", text, "2026-09-16");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /defaultRequiredServiceCount/);
  assert.match(failures[0], /EXPIRED/);
});

test("a raised ratchet with no contraction obligation fails — an expansion nobody owns reducing", () => {
  const text = substrateBaseline({
    defaultRequiredServiceCount: {
      direction: "non-increasing",
      value: 7,
      owner: "platform-architecture",
      expiry: "2026-12-31",
    },
  });
  const failures = checkPerMetricBudgets("scripts/platform-substrate-baseline.json", text, "2026-09-16");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no contraction obligation/);
});

test("a budget on an informational row is a category error", () => {
  const text = substrateBaseline({
    prismaSchemaLines: { direction: "informational", value: 19700, owner: "x", expiry: "2026-12-31", contraction: "EP-1" },
  });
  const failures = checkPerMetricBudgets("scripts/platform-substrate-baseline.json", text, "2026-09-16");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /only a non-increasing ratchet can hold owned debt/);
});

test("the substrate baseline is governed per-row, not exempt", async () => {
  const { EXEMPT } = await import("./check-no-expired-baseline-budgets.mjs");
  assert.ok(!("scripts/platform-substrate-baseline.json" in EXEMPT), "must no longer be whole-file exempt");
  assert.ok("scripts/platform-substrate-baseline.json" in PER_ROW_BUDGETS);
});
