#!/usr/bin/env node
// scripts/check-employment-event-writers.mjs
//
// BI-2624B7EA — every EmploymentEvent write must actuate.
//
// THE PROBLEM IT FIXES: the employment lifecycle actuator shipped twice in a
// state that looked delivered and was not.
//
//   1. PR #4842 merged the actuator with every unit test green and NOTHING
//      calling it. The module was inert, not broken — the tests invoked it
//      directly, and nobody asserted that production code did.
//   2. PR #4865 wired it into recordEmploymentLifecycleEvent, and a per-function
//      test proved that one seam. Three OTHER functions — createEmployeeProfile,
//      assignEmployeeOrg, reassignEmployeeManager — were still writing
//      EmploymentEvent rows that did nothing. Hiring, the headline case, was
//      among them.
//
// Wiring call sites one at a time is what produced both. So the invariant is
// structural rather than per-site: `recordAndActuateEmploymentEvent` is the ONLY
// writer, and it always actuates. A new lifecycle event added anywhere inherits
// the behaviour instead of needing somebody to remember.
//
//   node scripts/check-employment-event-writers.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The one module allowed to write the row. */
const CANONICAL_WRITER = path.join(
  "apps", "web", "lib", "workforce", "employment-event-actuator-runtime.ts",
);

const SEARCH_ROOTS = [path.join("apps", "web", "lib"), path.join("apps", "web", "app")];
const WRITE_RE = /\bemploymentEvent\s*\.\s*(create|createMany|upsert)\s*\(/;
const SKIP_RE = /(\.(test|spec|stories)\.[cm]?[jt]sx?$|__tests__\/|\/generated\/|\.next\/)/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) yield* walk(full);
    else if (/\.[cm]?tsx?$/.test(full)) yield full;
  }
}

const offenders = [];
for (const root of SEARCH_ROOTS) {
  for (const file of walk(path.join(REPO_ROOT, root))) {
    const rel = path.relative(REPO_ROOT, file);
    if (SKIP_RE.test(rel.replaceAll("\\", "/"))) continue;
    if (rel === CANONICAL_WRITER) continue;
    const source = readFileSync(file, "utf8");
    source.split("\n").forEach((line, i) => {
      if (WRITE_RE.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
}

if (offenders.length > 0) {
  console.error("EmploymentEvent is written outside its canonical writer (BI-2624B7EA).\n");
  for (const offender of offenders) console.error(`  ✗ ${offender}`);
  console.error(
    "\nAn EmploymentEvent that is written without actuating is a log entry, which is\n" +
      "exactly the state EP-862820FD exists to remove. Write it through\n" +
      "recordAndActuateEmploymentEvent() so the event and the Workroom it prescribes\n" +
      "commit together.\n",
  );
  process.exit(1);
}

// The canonical writer must itself still actuate — otherwise this guard would
// happily pass over a writer that had been hollowed out.
const writerSource = readFileSync(path.join(REPO_ROOT, CANONICAL_WRITER), "utf8");
const writerBody = writerSource.slice(
  writerSource.indexOf("export async function recordAndActuateEmploymentEvent"),
);
if (!writerBody.includes("actuateForLifecycleEvent(")) {
  console.error(
    "recordAndActuateEmploymentEvent no longer actuates (BI-2624B7EA).\n" +
      "It writes the row, so every employment event in the product would silently\n" +
      "stop opening its Workroom while this guard still passed.",
  );
  process.exit(1);
}

console.log("EmploymentEvent writers OK — one canonical writer, and it actuates.");
