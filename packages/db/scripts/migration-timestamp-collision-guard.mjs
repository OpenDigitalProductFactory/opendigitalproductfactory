#!/usr/bin/env node
//
// migration-timestamp-collision-guard.mjs — block a NEW Prisma migration whose
// 14-digit timestamp prefix collides with another migration in the tree.
//
// Why this exists (BI-BFDCE0A9, 2026-07-06): Prisma orders migrations by full
// directory name, so a timestamp-prefix collision (two dirs sharing the same
// 20260706080000 prefix) does NOT break `migrate deploy` — ordering falls back
// to the suffix and stays deterministic. The repo already carries 19 such pairs
// and they apply fine. The hazard is human, not mechanical: a shared timestamp
// makes migration ordering non-obvious to a reader, invites "just bump the
// timestamp" fixes, and — critically — renaming an ALREADY-APPLIED migration to
// de-collide is destructive (it re-runs on every existing install: P3018
// `column already exists`, wedging the forward-only chain). The safe posture is
// therefore: never retro-rename applied migrations, but stop NEW collisions at
// the door so the set never grows.
//
// What it flags: any NEW migration (absent at <base-ref>) whose 14-digit
// timestamp prefix is shared by any other migration in the working tree —
// whether that other migration is pre-existing or also new. Existing pairs are
// never "new", so the 19 legacy collisions self-baseline and are never flagged.
// One exact-checksum exception restores a migration identity already applied by
// an earlier branch revision; changing either its name or bytes would create
// fleet drift, so the exception is narrower than an ordinary baseline.
//
// The fix for a flagged collision is always to pick a fresh, later timestamp for
// the NEW migration BEFORE it merges (it has never been applied anywhere, so
// renaming it is free) — never to rename the migration it collides with.
//
// Usage:   node packages/db/scripts/migration-timestamp-collision-guard.mjs <base-ref>
// Exit:    0 no new collisions · 1 at least one · 2 invocation error
//
// Wired into:
//   - .github/workflows/migration-safety-guard.yml (CI)
//   - packages/db/scripts/migration-timestamp-collision-guard.test.ts (vitest)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = "packages/db/prisma/migrations";
const TS_PREFIX = /^(\d{14})_/;

// A former branch revision reached real databases under this exact identity
// before the migration was renamed. Restoring those exact bytes is required to
// preserve Prisma history; any checksum drift remains a collision failure.
export const HISTORICAL_COLLISION_RESTORATIONS = Object.freeze({
  "20260728120000_repair_inventory_entity_index_integrity":
    "84704a50ad127a0a4823074956f8041cd99f647accbcb39ce17c856fa1f13d90",
});

/**
 * Given the full set of migration directory names and the subset that is NEW
 * (absent at the base ref), return one finding per new migration that collides.
 * Pure — no I/O — so the test can drive it directly.
 *
 * @param {string[]} allDirs   every migration dir name in the working tree
 * @param {Set<string>} newDirs the subset that is new since the base ref
 * @param {Map<string, string>} migrationChecksums SHA-256 by migration dir
 * @returns {{ dir: string, timestamp: string, collidesWith: string[] }[]}
 */
export function findCollisions(allDirs, newDirs, migrationChecksums = new Map()) {
  const byTimestamp = new Map();
  for (const dir of allDirs) {
    const m = TS_PREFIX.exec(dir);
    if (!m) continue;
    const ts = m[1];
    if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
    byTimestamp.get(ts).push(dir);
  }

  const findings = [];
  for (const dir of allDirs) {
    if (!newDirs.has(dir)) continue;
    const restorationChecksum = HISTORICAL_COLLISION_RESTORATIONS[dir];
    if (
      restorationChecksum
      && migrationChecksums.get(dir) === restorationChecksum
    ) {
      continue;
    }
    const m = TS_PREFIX.exec(dir);
    if (!m) continue;
    const siblings = byTimestamp.get(m[1]).filter((d) => d !== dir);
    if (siblings.length > 0) {
      findings.push({ dir, timestamp: m[1], collidesWith: siblings.sort() });
    }
  }
  return findings;
}

// ─── driver ──────────────────────────────────────────────────────────────────
function main() {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error("Usage: node packages/db/scripts/migration-timestamp-collision-guard.mjs <base-ref>");
    process.exit(2);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", `${MIGRATIONS_DIR}/**/migration.sql`], {
      cwd: repoRoot, encoding: "utf8",
    }).split("\n").filter(Boolean);
  } catch (err) {
    console.error(`❌ git ls-files failed: ${err.message.split("\n")[0]}`);
    process.exit(2);
  }

  // Map each migration.sql path → its migration directory name.
  const dirOf = (f) => f.slice(`${MIGRATIONS_DIR}/`.length).split("/")[0];
  const allDirs = tracked.map(dirOf);
  const migrationChecksums = new Map(
    tracked.map((file) => [
      dirOf(file),
      createHash("sha256")
        .update(readFileSync(resolve(repoRoot, file)))
        .digest("hex"),
    ]),
  );

  const newDirs = new Set(
    tracked
      .filter((f) => {
        try {
          execFileSync("git", ["cat-file", "-e", `${baseRef}:${f}`], { cwd: repoRoot, stdio: "ignore" });
          return false; // exists at base → not new
        } catch {
          return true; // absent at base → new migration
        }
      })
      .map(dirOf),
  );

  const findings = findCollisions(allDirs, newDirs, migrationChecksums);

  if (findings.length === 0) {
    console.log("✅ No new migration timestamp collisions.");
    process.exit(0);
  }

  console.error("❌ Migration timestamp collision: a new migration shares its timestamp with another.");
  console.error("");
  console.error("Prisma still applies these deterministically (ordered by full dir name), but a");
  console.error("shared timestamp obscures ordering and invites a de-collide rename. Renaming an");
  console.error("ALREADY-APPLIED migration re-runs it on every install (P3018 column-already-exists),");
  console.error("so the only safe fix is to rebump THIS new, unapplied migration to a later timestamp.");
  console.error("");
  for (const f of findings) {
    console.error(`  ${f.dir}`);
    console.error(`    • timestamp ${f.timestamp} also used by: ${f.collidesWith.join(", ")}`);
    if (HISTORICAL_COLLISION_RESTORATIONS[f.dir]) {
      console.error(
        `    • historical restoration must have checksum ${HISTORICAL_COLLISION_RESTORATIONS[f.dir]}`,
      );
      console.error(`    • observed checksum ${migrationChecksums.get(f.dir) ?? "<missing>"}`);
    }
  }
  console.error("");
  console.error("Fix an ordinary NEW migration by renaming it to a fresh timestamp before merge.");
  console.error("Fix a listed historical restoration by restoring its exact recorded bytes.");
  console.error("Never rename a migration identity that has already been applied anywhere.");
  console.error("");
  process.exit(1);
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
