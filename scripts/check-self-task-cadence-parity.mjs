#!/usr/bin/env node
// Self-task cadence parity — the skill's declared cadence must equal the
// registry's Balanced cron (BI-4CE4F52F).
//
// WHY THIS GUARD EXISTS. A coworker's standing rhythm is written TWICE on
// purpose: once in the self-task registry, which the scheduler reads, and once
// in the coworker's own recurring SKILL.md, so its definition says when it runs
// rather than the timing living only in a hand-maintained list. The duplication
// is deliberate and documented in every one of those skills. What was missing
// was anything keeping the two equal — so the pair could silently drift, and the
// skill would describe a rhythm the scheduler does not run. 31 pairs already
// agreed exactly when this guard was written; it exists to keep it that way.
//
// IT READS BOTH REGISTRIES, AND THAT IS THE POINT. The entries live in TWO
// files — coworker-self-tasks.ts (the original six) and
// coworker-standing-self-tasks.ts (the shape-derived set). A reader that knows
// only one silently passes on everything in the other. That exact mistake has
// been made repeatedly against this registry family, including by the first
// draft of this guard, which checked 31 pairs and quietly skipped 3. So the
// parser asserts a FLOOR on what it found in each file: a regex that stops
// matching fails the guard instead of reporting success over an empty set. A
// guard that silently covers nothing is worse than no guard.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => path.join(ROOT, ...p);

// Parse floors. These are LOWER BOUNDS on what each source must yield, not
// exact counts — adding entries is normal, a parser that stops seeing them is
// not. Raise a floor when a source grows substantially.
const FLOOR_STANDING = 30;
const FLOOR_ORIGINAL = 5;
const FLOOR_SKILLS = 30;

const read = (rel) => fs.readFileSync(P(rel), "utf8");

/** Shape A — task("title", "route", "<balanced>", "<assertive>", [...]). */
export function parseStandingRegistry(src) {
  const out = new Map();
  for (const m of src.matchAll(
    /\n {2}"([a-z0-9-]+)":\s*task\(\s*\n?\s*"[^"]*",\s*"[^"]*",\s*"([^"]+)",\s*"([^"]+)"/g,
  )) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** Shape B — { title, prompt, cadence: { balanced, assertive } }. */
export function parseOriginalRegistry(src) {
  const out = new Map();
  for (const m of src.matchAll(/\n {2}"([a-z0-9-]+)":\s*\{/g)) {
    const tail = src.slice(m.index, m.index + 4000);
    const balanced = /balanced:\s*"([^"]+)"/.exec(tail);
    if (balanced) out.set(m[1], balanced[1]);
  }
  return out;
}

/** Recurring-skill frontmatter -> { cadence, targets } (null when not recurring). */
export function parseRecurringSkill(text) {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const taskType = /^taskType:\s*"?(\w+)/m.exec(fm);
  if (!taskType || taskType[1] !== "recurring") return null;
  const cadence = /^cadence:\s*"([^"]+)"/m.exec(fm);
  const assignTo = /^assignTo:\s*\[([^\]]*)\]/m.exec(fm);
  return {
    cadence: cadence ? cadence[1] : null,
    targets: assignTo ? [...assignTo[1].matchAll(/"([^"]+)"/g)].map((t) => t[1]) : [],
  };
}

/**
 * Compare one skill against the merged registry.
 * `balancedByAgent` maps coworker key -> Balanced cron; `sourceOf` names the
 * file it came from, so a failure says WHICH registry disagrees.
 */
export function findSkillParityViolations(rel, parsed, balancedByAgent, sourceOf) {
  const out = [];
  if (parsed.cadence === null) {
    return [`${rel}: taskType "recurring" with no cadence — a recurring skill must say how often it recurs.`];
  }
  for (const target of parsed.targets) {
    const registryCron = balancedByAgent.get(target);
    if (registryCron === undefined) continue;
    if (registryCron !== parsed.cadence) {
      out.push(
        `${rel}: cadence "${parsed.cadence}" disagrees with the Balanced cron "${registryCron}" `
          + `declared for "${target}" in ${sourceOf.get(target) ?? "the registry"}. The scheduler runs `
          + "the registry, so the skill is describing a rhythm nobody runs. Make them equal.",
      );
    }
  }
  return out;
}

const RUN_AS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const errors = [];

// ── The two registries. Different literal shapes, same meaning: key -> Balanced cron.
const STANDING = "apps/web/lib/operate/scheduled-jobs/coworker-standing-self-tasks.ts";
const ORIGINAL = "apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts";

const balancedByAgent = new Map();
const sourceOf = new Map();

// Shape A — task("title", "route", "<balanced>", "<assertive>", [...])
const standingParsed = parseStandingRegistry(read(STANDING));
for (const [k, v] of standingParsed) {
  balancedByAgent.set(k, v);
  sourceOf.set(k, STANDING);
}
const standingCount = standingParsed.size;

// Shape B — { title, prompt, cadence: { balanced: "...", assertive: "..." } }
const originalParsed = parseOriginalRegistry(read(ORIGINAL));
for (const [k, v] of originalParsed) {
  if (balancedByAgent.has(k)) continue;
  balancedByAgent.set(k, v);
  sourceOf.set(k, ORIGINAL);
}
const originalCount = originalParsed.size;

if (standingCount < FLOOR_STANDING) {
  errors.push(
    `PARSER FLOOR: matched only ${standingCount} entries in ${STANDING} (floor ${FLOOR_STANDING}). `
      + "The registry literal shape probably changed — fix this parser; do not lower the floor to go green.",
  );
}
if (originalCount < FLOOR_ORIGINAL) {
  errors.push(
    `PARSER FLOOR: matched only ${originalCount} entries in ${ORIGINAL} (floor ${FLOOR_ORIGINAL}). `
      + "This is the file a one-registry reader forgets; a zero here is the bug this floor exists to catch.",
  );
}

// ── Recurring skills across the pack namespace.
const packDir = P("packages", "dpf-skill-pack", "skills");
let recurringSkills = 0;
for (const entry of fs.readdirSync(packDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const file = path.join(packDir, entry.name, "SKILL.md");
  if (!fs.existsSync(file)) continue;
  const parsed = parseRecurringSkill(fs.readFileSync(file, "utf8"));
  if (!parsed) continue;
  recurringSkills++;
  const rel = `packages/dpf-skill-pack/skills/${entry.name}/SKILL.md`;
  errors.push(...findSkillParityViolations(rel, parsed, balancedByAgent, sourceOf));
}

if (recurringSkills < FLOOR_SKILLS) {
  errors.push(
    `PARSER FLOOR: found only ${recurringSkills} recurring skills (floor ${FLOOR_SKILLS}). `
      + "Frontmatter parsing probably broke — fix the parser rather than lowering the floor.",
  );
}

if (RUN_AS_MAIN && errors.length > 0) {
  console.error("Self-task cadence parity FAILED (BI-4CE4F52F).\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nA coworker's rhythm is declared in two places on purpose: the registry the\n"
      + "scheduler reads, and the coworker's own skill. They must agree.",
  );
  process.exit(1);
}

if (RUN_AS_MAIN) console.log(
  `Self-task cadence parity OK — ${recurringSkills} recurring skill(s) checked against `
    + `${balancedByAgent.size} registry entr(ies) across 2 registries.`,
);
