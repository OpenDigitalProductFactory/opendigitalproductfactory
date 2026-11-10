// Self-test for the self-task cadence parity guard (BI-4CE4F52F).
//
// The guard's real job is catching a pair that drifted. Its SECOND job — the one
// that caused a defect while it was being written — is not silently covering an
// empty set: the registry lives in two files, and a reader that sees only one
// passes happily on everything in the other. Both are asserted here.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseStandingRegistry,
  parseOriginalRegistry,
  parseRecurringSkill,
  findSkillParityViolations,
} from "./check-self-task-cadence-parity.mjs";

const STANDING_SRC = `
export const COWORKER_STANDING_SELF_TASKS: Record<string, CoworkerSelfTask> = {
  "soc-triage-analyst": task(
    "Enrich and judge the detection queue", "/ops/security", "11 6 * * 1-5", "11 6,14 * * *",
    ["step one"],
  ),
  "bookkeeper": task(
    "Open or advance the current books period", "/finance/banking", "7 9 * * 1", "7 9 * * 1-5",
    ["step one"],
  ),
};
`;

const ORIGINAL_SRC = `
export const COWORKER_SELF_TASKS: Record<string, CoworkerSelfTask> = {
  "finance-controller": {
    title: "Review burn, revenue, and runway",
    prompt: ["a", "b"],
    cadence: { balanced: "23 13 * * 3", assertive: "23 13 * * 1,4" },
  },
};
`;

const skill = (cadence, targets, taskType = "recurring") => `---
name: a-skill
taskType: "${taskType}"
cadence: "${cadence}"
assignTo: [${targets.map((t) => `"${t}"`).join(", ")}]
---
body
`;

test("parses the task(...) registry shape", () => {
  const m = parseStandingRegistry(STANDING_SRC);
  assert.equal(m.get("soc-triage-analyst"), "11 6 * * 1-5");
  // The BALANCED cron, not the assertive one that follows it.
  assert.equal(m.get("bookkeeper"), "7 9 * * 1");
  assert.equal(m.size, 2);
});

test("parses the cadence-object registry shape — the file a one-registry reader forgets", () => {
  const m = parseOriginalRegistry(ORIGINAL_SRC);
  assert.equal(m.get("finance-controller"), "23 13 * * 3");
  assert.equal(m.size, 1);
});

test("a parser that stops matching yields an EMPTY map, which the floor check turns into a failure", () => {
  // Guards against the real defect: silent zero coverage reported as success.
  assert.equal(parseStandingRegistry("const x = {};").size, 0);
  assert.equal(parseOriginalRegistry("const x = {};").size, 0);
});

test("reads cadence and assignTo off a recurring skill, and ignores a non-recurring one", () => {
  const p = parseRecurringSkill(skill("7 9 * * 1", ["bookkeeper"]));
  assert.equal(p.cadence, "7 9 * * 1");
  assert.deepEqual(p.targets, ["bookkeeper"]);
  assert.equal(parseRecurringSkill(skill("7 9 * * 1", ["x"], "on-demand")), null);
  assert.equal(parseRecurringSkill("no frontmatter"), null);
});

const REGISTRY = new Map([["bookkeeper", "7 9 * * 1"], ["finance-controller", "23 13 * * 3"]]);
const SOURCE = new Map([
  ["bookkeeper", "standing.ts"],
  ["finance-controller", "original.ts"],
]);

test("agreement is silent", () => {
  const v = findSkillParityViolations("s.md", parseRecurringSkill(skill("7 9 * * 1", ["bookkeeper"])), REGISTRY, SOURCE);
  assert.deepEqual(v, []);
});

test("drift fails, and the message names the registry that disagrees", () => {
  const v = findSkillParityViolations("s.md", parseRecurringSkill(skill("7 9 * * 2", ["bookkeeper"])), REGISTRY, SOURCE);
  assert.equal(v.length, 1);
  assert.match(v[0], /"7 9 \* \* 2" disagrees with the Balanced cron "7 9 \* \* 1"/);
  assert.match(v[0], /standing\.ts/);
});

test("drift is caught for the SECOND registry too, not just the first", () => {
  const v = findSkillParityViolations(
    "s.md", parseRecurringSkill(skill("23 13 * * 5", ["finance-controller"])), REGISTRY, SOURCE,
  );
  assert.equal(v.length, 1);
  assert.match(v[0], /original\.ts/);
});

test("a recurring skill with no cadence is a violation on its own", () => {
  const parsed = { cadence: null, targets: ["bookkeeper"] };
  const v = findSkillParityViolations("s.md", parsed, REGISTRY, SOURCE);
  assert.equal(v.length, 1);
  assert.match(v[0], /must say how often it recurs/);
});

test("a skill assigned to a coworker with no self-task entry is not drift", () => {
  // That is a cadence-plane gap for the measure to report, not a disagreement.
  const v = findSkillParityViolations("s.md", parseRecurringSkill(skill("1 1 * * 1", ["nobody"])), REGISTRY, SOURCE);
  assert.deepEqual(v, []);
});
