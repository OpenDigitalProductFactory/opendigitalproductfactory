// scripts/measure-obligation-cadence-coverage.test.mjs
//
// Pins the PARSER and — most importantly — that this measure classifies a
// frequency exactly as the runtime sweep does. A word the measure calls a
// cadence and the runtime does not would make the coverage report disagree with
// the ledger it reports on, which is worse than having no report.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CADENCE_WORDS,
  buildReport,
  classifyFrequency,
  readArchetypes,
  readCompliancePacks,
} from "./measure-obligation-cadence-coverage.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("classifies the four values the seeded packs actually write", () => {
  assert.equal(classifyFrequency("annual"), "cadence");
  assert.equal(classifyFrequency("monthly"), "cadence");
  assert.equal(classifyFrequency("continuous"), "continuous");
  assert.equal(classifyFrequency("event-driven"), "event-driven");
});

test("never guesses, and separates unrecorded from uncomputable", () => {
  assert.equal(classifyFrequency("when the auditor asks"), "unrecognised");
  assert.equal(classifyFrequency(null), "unspecified");
  assert.equal(classifyFrequency("  "), "unspecified");
});

test("stays in lockstep with the runtime classifier", () => {
  // The runtime owns the vocabulary; this measure mirrors it. Drift here means
  // the coverage number describes a sweep that is not the one running.
  const runtime = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "lib", "compliance", "obligation-cadence.ts"),
    "utf8",
  );
  const runtimeWords = new Set(
    [...runtime.matchAll(/^\s*"?([a-z-]+)"?:\s*\d+,/gm)].map((m) => m[1]),
  );
  assert.ok(runtimeWords.size > 0, "failed to parse CADENCE_PERIOD_DAYS from the runtime module");
  for (const word of runtimeWords) {
    assert.ok(CADENCE_WORDS.has(word), `runtime knows cadence word "${word}" and the measure does not`);
  }
  for (const word of CADENCE_WORDS) {
    assert.ok(runtimeWords.has(word), `measure knows cadence word "${word}" and the runtime does not`);
  }
});

test("reads every archetype category from the canonical definitions", () => {
  const byCategory = readArchetypes();
  assert.ok(byCategory.size >= 20, `expected the full taxonomy, got ${byCategory.size} categories`);
  assert.ok(byCategory.has("food-hospitality"));
  assert.ok(byCategory.get("food-hospitality").has("restaurant"));
});

test("an ungated pack is reported as a defect, never as common coverage", () => {
  const report = buildReport({
    byCategory: new Map([["food-hospitality", new Set(["restaurant"])]]),
    packs: [
      {
        pack: "no-spec", scope: "ungated", gatesOn: [], hasStructuredSpec: false,
        obligations: 4, byTriggerClass: { cadence: 1, continuous: 3, "event-driven": 0, unrecognised: 0, unspecified: 0 },
      },
    ],
  });
  assert.equal(report.summary.ungatedPacks.packs.length, 1);
  assert.equal(report.summary.common.packs.length, 0);
  // And it must NOT be credited as covering the category it reaches by accident.
  assert.equal(report.categories[0].status, "no-pack");
});

test("a pack of purely continuous duties does not count as covered", () => {
  const report = buildReport({
    byCategory: new Map([["pet-services", new Set(["kennel"])]]),
    packs: [
      {
        pack: "pets", scope: "archetype", gatesOn: ["kennel"], hasStructuredSpec: true,
        obligations: 3, byTriggerClass: { cadence: 0, continuous: 3, "event-driven": 0, unrecognised: 0, unspecified: 0 },
      },
    ],
  });
  // The deadline watch can act on nothing here, so the calendar stays empty.
  assert.equal(report.categories[0].status, "no-recurring");
  assert.equal(report.summary.categoriesCovered, 0);
});

test("the shipped artifact matches a fresh run of the measure", () => {
  const fresh = buildReport({ byCategory: readArchetypes(), packs: readCompliancePacks() });
  const shipped = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "lib", "compliance", "obligation-cadence-coverage.generated.json"),
    "utf8",
  ));
  assert.deepEqual(shipped.summary, fresh.summary);
});
