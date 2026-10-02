#!/usr/bin/env node
// scripts/check-skill-capability-keys.mjs
//
// Skill Capability Key Guard.
//
// THE PROBLEM IT FIXES: skill frontmatter carries `capability:` — the permission
// gate the in-portal seed loader (Surface B, packages/db/src/seed-skills.ts)
// copies verbatim into SkillDefinition.capability, a free-form Prisma String?.
// Nothing validated the value. On 2026-10-01, nine recurring coworker skills were
// authored with five invented capability names (view_build_studio,
// view_platform_tools, view_workspace, view_operate, view_ai_platform) and the
// ENTIRE preflight — 76 guards, including the Capability Consumer Guard — passed.
// They were caught by a manual grep.
//
// The Capability Consumer Guard does NOT cover this: it polices the ARCHETYPE
// capability registry (packages/storefront-templates, keys like "member-equity"),
// a different namespace from the PORTAL permission keys (`view_*`/`manage_*`) that
// skill frontmatter names. An invented key is silent: `can(user, key)` finds no
// PERMISSIONS entry, so the skill is gated by nothing it can ever satisfy — it
// either never surfaces or surfaces ungated, and neither failure announces itself.
//
// THE SOURCE OF TRUTH: apps/web/lib/govern/permissions.ts. `CapabilityKey` is the
// closed union and `PERMISSIONS: Record<CapabilityKey, Permission>` materialises
// it at runtime; the Record type makes the two compiler-identical. This guard
// parses BOTH and asserts they agree, so a regex that drifts on one side is
// caught by the other rather than quietly shrinking the known set.
//
// THE RULE: every non-null `capability:` in every skill, in both namespaces
// (skills/**/*.skill.md and packages/dpf-skill-pack/skills/*/SKILL.md), must name
// a key in that set. No baseline — the two pre-existing violations
// (scout_external_catalogs, manage_platform_config) were corrected in the same
// change rather than parked, so the guard starts at zero and stays there.
//
// PARSER FLOORS: a guard whose regex stops matching must FAIL, not report success
// over an empty set. Three floors are asserted before any verdict is reached.
//
// Usage:
//   node scripts/check-skill-capability-keys.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PERMISSIONS_PATH = path.join(REPO_ROOT, "apps/web/lib/govern/permissions.ts");
const LEGACY_SKILLS_DIR = path.join(REPO_ROOT, "skills");
const PACK_SKILLS_DIR = path.join(REPO_ROOT, "packages/dpf-skill-pack/skills");

// Floors, set well below the live counts (35 keys / 140 skill files / 140
// capability declarations as of 2026-10-01) so ordinary growth or pruning never
// trips them, but a regex that stops matching does.
export const MIN_CAPABILITY_KEYS = 30;
export const MIN_SKILL_FILES = 120;
export const MIN_CAPABILITY_DECLARATIONS = 120;

/**
 * Parse the capability source of truth two independent ways:
 *   - the `CapabilityKey` union members,
 *   - the top-level keys of the `PERMISSIONS` record.
 * Returns both so the caller can assert they agree.
 */
export function parseCapabilitySourceOfTruth(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  const unionKeys = [];
  let inUnion = false;
  for (const line of lines) {
    if (/^export type CapabilityKey\s*=/.test(line)) {
      inUnion = true;
      // the first member may sit on the declaration line
    }
    if (!inUnion) continue;
    for (const m of line.matchAll(/"([a-z][a-z0-9_]*)"/g)) unionKeys.push(m[1]);
    if (/;\s*$/.test(line)) break;
  }

  const permissionKeys = [];
  let inRecord = false;
  for (const line of lines) {
    if (/^export const PERMISSIONS\b/.test(line)) {
      inRecord = true;
      continue;
    }
    if (!inRecord) continue;
    if (/^\};/.test(line)) break;
    const m = line.match(/^ {2}([a-z][a-z0-9_]*):\s*\{/);
    if (m) permissionKeys.push(m[1]);
  }

  return { unionKeys, permissionKeys };
}

/**
 * Read the `capability:` value out of skill frontmatter.
 * Returns the key string, `null` for an explicit `null`, or `undefined` when the
 * field is absent. Tolerates single quotes, double quotes and a bare scalar —
 * all three shapes are in the tree today.
 */
export function parseSkillCapability(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const block = fm ? fm[1] : text;
  const line = block.split("\n").find((l) => /^capability:/.test(l));
  if (line === undefined) return undefined;
  const value = line.slice("capability:".length).trim().replace(/\s+#.*$/, "");
  if (value === "" || value === "null" || value === "~") return null;
  const unquoted = value.replace(/^["']/, "").replace(/["']$/, "").trim();
  return unquoted === "" || unquoted === "null" ? null : unquoted;
}

/** Collect every skill file across BOTH namespaces, repo-relative, sorted. */
export function collectSkillFiles() {
  const out = [];
  const walk = (dir, match) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, match);
      else if (match(entry.name)) out.push(path.relative(REPO_ROOT, full));
    }
  };
  walk(LEGACY_SKILLS_DIR, (n) => n.endsWith(".skill.md"));
  walk(PACK_SKILLS_DIR, (n) => n === "SKILL.md");
  return out.sort();
}

/**
 * The verdict. `skills` is [{ file, capability }] where capability is a string,
 * null (explicitly ungated) or undefined (field absent).
 */
export function evaluateSkillCapabilities({ unionKeys, permissionKeys, skills }) {
  const errors = [];

  // --- Parser floors. Assert BEFORE any per-skill verdict, so a regex that stops
  // matching fails loudly instead of reporting a clean sweep over nothing.
  if (permissionKeys.length < MIN_CAPABILITY_KEYS) {
    errors.push(
      `PARSER FLOOR: parsed only ${permissionKeys.length} PERMISSIONS keys from ` +
        `apps/web/lib/govern/permissions.ts (floor ${MIN_CAPABILITY_KEYS}). The record ` +
        `shape changed and the guard is reading an empty or truncated set — fix the parser, ` +
        `do NOT lower the floor.`,
    );
  }
  if (unionKeys.length < MIN_CAPABILITY_KEYS) {
    errors.push(
      `PARSER FLOOR: parsed only ${unionKeys.length} CapabilityKey union members ` +
        `(floor ${MIN_CAPABILITY_KEYS}). Same fix as above.`,
    );
  }
  if (skills.length < MIN_SKILL_FILES) {
    errors.push(
      `PARSER FLOOR: discovered only ${skills.length} skill files across both namespaces ` +
        `(floor ${MIN_SKILL_FILES}). Discovery is broken or a namespace moved — fix discovery, ` +
        `do NOT lower the floor.`,
    );
  }
  const declared = skills.filter((s) => s.capability !== undefined);
  if (declared.length < MIN_CAPABILITY_DECLARATIONS) {
    errors.push(
      `PARSER FLOOR: read a capability: field from only ${declared.length} of ${skills.length} ` +
        `skill files (floor ${MIN_CAPABILITY_DECLARATIONS}). The frontmatter regex stopped ` +
        `matching — fix it, do NOT lower the floor.`,
    );
  }

  // --- The two parses of the source of truth must agree. If they diverge, the
  // known set is untrustworthy and no per-skill verdict is safe.
  const unionSet = new Set(unionKeys);
  const permissionSet = new Set(permissionKeys);
  const onlyUnion = unionKeys.filter((k) => !permissionSet.has(k));
  const onlyRecord = permissionKeys.filter((k) => !unionSet.has(k));
  if (onlyUnion.length > 0 || onlyRecord.length > 0) {
    errors.push(
      `SOURCE DISAGREEMENT: the CapabilityKey union and the PERMISSIONS record do not match ` +
        `(union-only: ${onlyUnion.join(", ") || "none"}; record-only: ${onlyRecord.join(", ") || "none"}). ` +
        `Record<CapabilityKey, Permission> makes these compiler-identical, so this is a guard parser ` +
        `defect — fix it before trusting any capability verdict.`,
    );
  }

  // Short-circuit: with a broken or disputed known set, per-skill results are noise.
  if (errors.length > 0) return { ok: false, errors, known: [...permissionSet].sort(), checked: 0 };

  const known = permissionSet;
  let checked = 0;
  for (const { file, capability } of skills) {
    if (capability === undefined || capability === null) continue;
    checked += 1;
    if (!known.has(capability)) {
      errors.push(
        `${file}: capability "${capability}" is not a known permission key. ` +
          `Use one of the keys declared by CapabilityKey / PERMISSIONS in ` +
          `apps/web/lib/govern/permissions.ts, or \`capability: null\` for an ungated skill. ` +
          `An invented key gates the skill on a permission nobody can hold.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, known: [...known].sort(), checked };
}

function check() {
  const source = fs.readFileSync(PERMISSIONS_PATH, "utf8");
  const { unionKeys, permissionKeys } = parseCapabilitySourceOfTruth(source);
  const skills = collectSkillFiles().map((file) => ({
    file,
    capability: parseSkillCapability(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")),
  }));

  const { ok, errors, known, checked } = evaluateSkillCapabilities({
    unionKeys,
    permissionKeys,
    skills,
  });

  if (!ok) {
    console.error("Skill capability key guard FAILED:\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\nKnown capability keys (${known.length}): ${known.join(", ")}`);
    process.exit(1);
  }

  console.log(
    `Skill capability key guard OK — ${skills.length} skill files across both namespaces, ` +
      `${checked} gated on one of ${known.length} known capability keys.`,
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-skill-capability-keys.mjs");
if (isMain) check();
