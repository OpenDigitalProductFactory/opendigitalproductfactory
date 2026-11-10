#!/usr/bin/env node
// Pack-skill `category` is a closed set (BI-4CE4F52F).
//
// SCOPE, AND WHAT THIS DELIBERATELY DOES NOT DO. The sibling field `capability`
// is validated by scripts/check-skill-capability-keys.mjs, which reads PERMISSIONS
// and the CapabilityKey union and cross-checks them. This guard does NOT
// re-validate capability: two guards policing one field is the second home
// AGENTS.md §1 forbids, and that one is the better reader.
//
// WHY CATEGORY NEEDS ITS OWN GUARD. /platform/ai/skills keeps its catalog
// default-visible, GROUPED BY CATEGORY, with the group headers showing. So a new
// category is not just a label — it is a permanent addition to that page's
// arrival text, and that page is under a shrink-only UX ratchet.
//
// This is not hypothetical. Authoring nine skills introduced `finance` and
// `marketing`, and the UX route sweep blocked the PR at
//
//     words visible on arrival: 218 → 224
//
// which is not a budget breach (the budget is 450) but exactly the regression the
// ratchet exists to catch. The same two values were then written AGAIN in a second
// worktree after being reported checked — the check had been run against the other
// tree. A rule enforced by remembering to grep is not enforced.
//
// SCOPED TO THE PACK NAMESPACE ON PURPOSE. The legacy `skills/<area>/*.skill.md`
// tree uses area-derived categories (admin, ea, storefront, universal …) that are
// correct there and are not what that page groups.
//
// PARSER FLOOR, for the reason check-self-task-cadence-parity has one: a
// vocabulary guard that silently matches nothing reports success over an empty
// set, which is worse than no guard.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACK_DIR = path.join(ROOT, "packages", "dpf-skill-pack", "skills");

/**
 * Established pack categories. Adding one is a REAL decision — it creates a
 * permanent visible group header on /platform/ai/skills — so it belongs in a
 * reviewed diff here, not as a side effect of one skill's frontmatter.
 */
export const ALLOWED_PACK_CATEGORIES = new Set([
  "architecture", "build", "compliance", "customer", "data-stewardship",
  "design", "docs", "governance", "operations", "ops", "people", "platform",
  "verification",
]);

export const FLOOR_PACK_SKILLS = 50;

/** @returns {string|null} the declared category, or null when absent/unparsable. */
export function readPackCategory(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fm) return null;
  const m = /^category:\s*"?([a-z0-9-]+)"?\s*$/m.exec(fm[1]);
  return m ? m[1] : null;
}

/** @returns {string[]} violation messages, empty when the category is established. */
export function findCategoryViolations(rel, category) {
  if (category === null || ALLOWED_PACK_CATEGORIES.has(category)) return [];
  return [
    `${rel}: category "${category}" is not an established pack category. A new one adds a permanent `
      + "visible group header to /platform/ai/skills, which is under a shrink-only words-on-arrival "
      + "ratchet — so either use an existing value "
      + `(${[...ALLOWED_PACK_CATEGORIES].sort().join(", ")}) or add it to ALLOWED_PACK_CATEGORIES here `
      + "with a reason, in a diff someone reviews.",
  ];
}

const RUN_AS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (RUN_AS_MAIN) {
  const errors = [];
  let count = 0;
  for (const entry of fs.readdirSync(PACK_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PACK_DIR, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    count++;
    errors.push(...findCategoryViolations(
      `packages/dpf-skill-pack/skills/${entry.name}/SKILL.md`,
      readPackCategory(fs.readFileSync(file, "utf8")),
    ));
  }

  // Asserted BEFORE any clean verdict: an empty sweep must fail, not pass.
  if (count < FLOOR_PACK_SKILLS) {
    errors.unshift(
      `PARSER FLOOR: only ${count} pack skill(s) discovered (floor ${FLOOR_PACK_SKILLS}). Fix the `
        + "reader — do not lower the floor to go green.",
    );
  }

  if (errors.length > 0) {
    console.error("Pack-skill category vocabulary FAILED (BI-4CE4F52F).\n");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `Pack-skill category OK — ${count} skill(s) against ${ALLOWED_PACK_CATEGORIES.size} established categories.`,
  );
}
