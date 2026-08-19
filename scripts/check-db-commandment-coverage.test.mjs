// The never-wipe-db-for-code-fixes commandment guarded TWO spellings of "destroy
// the database" and allowed three equivalents. Verified against the live gate on a
// running install:
//
//   docker compose down -v                        -> require_confirm
//   docker volume rm dpf_pgdata                   -> require_confirm
//   docker compose down --volumes                 -> ALLOW   (exact long form of -v)
//   docker volume prune -f                        -> ALLOW
//   docker system prune -a --volumes              -> ALLOW   (the most destructive one)
//   docker compose -f docker-compose.yml down -v  -> ALLOW   (how compose is actually invoked)
//   docker compose -p dpf down -v                 -> ALLOW   (how dpf-stop.ps1 invokes it)
//
// The last two matter most: the original regex required `compose` and `down` to be
// adjacent, so every real multi-file or named-project invocation slipped past --
// including the platform's own. The static fallback repeated the same hole, so the
// offline path was not a safety net either.
//
// Nothing tested the guard's own COVERAGE. A pattern list is only as good as the
// set of commands it is asserted against, and that set did not exist. This is it.
//
// Both sources of truth are checked, because they drift independently:
//   - the commandment frontmatter (seeded into the DB, used by /api/kernel/gate)
//   - scripts/safety/dpf-shell-guard-fallback-patterns.json (used when the portal
//     is unreachable, i.e. exactly when the database is most at risk)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDMENT = join(
  repoRoot, "docs", "founder-kernel", "wiki", "principles",
  "never-wipe-db-for-code-fixes.md",
);
const FALLBACK = join(repoRoot, "scripts", "safety", "dpf-shell-guard-fallback-patterns.json");

/** Commands that MUST require confirmation. Each destroys operator data. */
const MUST_GUARD = [
  "docker compose down -v",
  "docker compose down --volume",
  "docker compose down --volumes",
  "docker compose down --volumes --remove-orphans",
  "docker compose -f docker-compose.yml down -v",
  "docker compose -p dpf down -v",
  "docker compose -p dpf -f a.yml -f b.yml down --volumes",
  "docker volume rm dpf_pgdata",
  "docker volume prune",
  "docker volume prune -f",
  "docker system prune -a --volumes",
  "docker system prune --volumes -f",
  "prisma migrate reset",
  "pnpm --filter @dpf/db exec prisma migrate reset",
];

/** Everyday commands that MUST NOT be guarded, or the guard becomes noise. */
const MUST_ALLOW = [
  "docker compose down",
  "docker compose -f docker-compose.yml down",
  "docker compose down --remove-orphans",
  "docker compose up -d",
  "docker compose logs -f portal",
  "docker compose ps",
  "docker volume ls",
  "docker volume inspect dpf_pgdata",
  "docker system prune -a",
  "docker ps -a",
  "docker images",
];

function shellPatternsFromCommandment() {
  const src = readFileSync(COMMANDMENT, "utf8");
  const m = src.match(/^principleRuntimeEnforcement:\s*(\{.*\})\s*$/m);
  assert.ok(m, "commandment must still declare principleRuntimeEnforcement");
  const obj = JSON.parse(m[1]);
  const pats = obj.patterns ?? obj.runtime?.patterns ?? [];
  return pats.filter((p) => p.kind === "shell").map((p) => p.regex);
}

function shellPatternsFromFallback() {
  const obj = JSON.parse(readFileSync(FALLBACK, "utf8"));
  return (obj.patterns ?? []).filter((p) => p.kind === "shell").map((p) => p.regex);
}

const guards = (patterns, cmd) => patterns.some((r) => new RegExp(r).test(cmd));

for (const [label, load] of [
  ["commandment frontmatter", shellPatternsFromCommandment],
  ["static fallback", shellPatternsFromFallback],
]) {
  test(`${label}: guards every way of destroying the database`, () => {
    const pats = load();
    assert.ok(pats.length > 0, "no shell patterns found");
    const unguarded = MUST_GUARD.filter((c) => !guards(pats, c));
    assert.deepEqual(
      unguarded,
      [],
      `these destroy operator data but are NOT guarded:\n  ${unguarded.join("\n  ")}`,
    );
  });

  test(`${label}: does not guard ordinary non-destructive commands`, () => {
    const pats = load();
    const overreach = MUST_ALLOW.filter((c) => guards(pats, c));
    assert.deepEqual(
      overreach,
      [],
      `these are harmless but would demand a confirmation phrase, training operators ` +
        `to bypass the guard:\n  ${overreach.join("\n  ")}`,
    );
  });

  test(`${label}: every pattern is a valid regex`, () => {
    for (const r of load()) {
      assert.doesNotThrow(() => new RegExp(r), `invalid regex: ${r}`);
    }
  });
}

test("the two sources of truth agree on the docker patterns", () => {
  // They are maintained separately and drift silently; the fallback is what runs
  // when the portal is down, which is precisely when it matters most.
  const inCommandment = new Set(shellPatternsFromCommandment().filter((r) => r.includes("docker")));
  const inFallback = new Set(shellPatternsFromFallback().filter((r) => r.includes("docker")));
  const missingFromFallback = [...inCommandment].filter((r) => !inFallback.has(r));
  assert.deepEqual(
    missingFromFallback,
    [],
    `the offline fallback is missing docker patterns the commandment declares:\n  ` +
      missingFromFallback.join("\n  "),
  );
});
