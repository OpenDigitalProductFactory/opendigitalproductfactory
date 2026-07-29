// Guard: every place that PROVISIONS a Postgres container must use a pgvector
// image, never a plain `postgres:` image.
//
// WHY THIS EXISTS (BET-5 datastore compression — BI-A1E864A5 / BI-28D31FB7):
// BET-5 moved vectors into Postgres via pgvector, so every Postgres the platform
// migrates against must ship the `vector` extension (a migration runs
// `CREATE EXTENSION vector`). The image bump to `pgvector/pgvector:pg16` had to be
// applied by hand at EACH independent provisioning site — and it was missed three
// separate times, each detonating only in its own environment:
//   1. the live install's compose postgres        → PR #2969 (ensure-pgvector recreate)
//   2. the local-CI pregate's self-provisioned db  → PR #2990 (BI-032B49EB)
//   3. the Build Studio sandbox's per-build db      → this change (BI-28D31FB7)
// Each is a separate `docker run` / `image:` with no shared source of truth, so a
// datastore change silently leaves a site behind. This guard is the cheap ratchet:
// it fails if any known provisioning site references a non-pgvector Postgres image,
// so the NEXT datastore change can't ship a half-covered fleet. (Longer term: fold
// these into one shared "provision Postgres" helper; until then, guard them.)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// apps/web/lib/verify → repo root is four levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

// The known sites that provision a Postgres CONTAINER (docker run / compose image).
// Add a site here when a new one is introduced — that is the point of the ratchet.
const PROVISIONING_SITES = [
  "apps/web/lib/integrate/sandbox/sandbox-db.ts",
  "scripts/local-ci-runner.mjs",
  "docker-compose.yml",
];

// A bare Postgres IMAGE tag: `postgres:` + a major version (14–17 → `1x`) or
// `latest`. Deliberately excludes the DSN host:port form `@postgres:5432` (port,
// not `1x`), the `postgresql://` scheme, and `postgres-exporter:` (hyphen, not
// colon). `pgvector/pgvector:pg16` also does not contain `postgres:1x`.
const BARE_POSTGRES_IMAGE = /\bpostgres:(?:1\d|latest)/;

/** Strip line comments so a cautionary mention of the old image in a comment
 *  doesn't trip the guard — only real provisioning lines count. */
function stripComments(line: string): string {
  return line.replace(/(^|\s)(#|\/\/).*$/, "");
}

describe("postgres-pgvector provisioning guard", () => {
  for (const site of PROVISIONING_SITES) {
    it(`${site} provisions Postgres on a pgvector image, not a plain one`, () => {
      const content = readFileSync(resolve(REPO_ROOT, site), "utf8");
      const offending = content
        .split(/\r?\n/)
        .map((l, i) => ({ n: i + 1, code: stripComments(l) }))
        .filter(({ code }) => BARE_POSTGRES_IMAGE.test(code));

      expect(
        offending,
        `${site} provisions a NON-pgvector Postgres image (BET-5 requires pgvector — a ` +
          `migration runs CREATE EXTENSION vector). Use pgvector/pgvector:pg16.\n` +
          offending.map(({ n, code }) => `  L${n}: ${code.trim()}`).join("\n"),
      ).toEqual([]);
    });
  }

  it("each site actually references a pgvector Postgres image (guard isn't vacuous)", () => {
    for (const site of PROVISIONING_SITES) {
      const content = readFileSync(resolve(REPO_ROOT, site), "utf8");
      expect(content, `${site} should provision pgvector/pgvector`).toMatch(/pgvector\/pgvector/);
    }
  });
});
