# ADP sidecar Postgres driver dedup — `postgres` → `pg`

_Status: implemented with BI-C0CEB377 · EP-8DC217EB BET-14 (opener) · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §4 BET-14 (external-surface rationalization, "dual pg drivers")_

## What & why

The platform carried **two** Postgres drivers: `pg` (node-postgres) in
`apps/web` + `packages/db`, and `postgres` (porsager) used by exactly one
file — the ADP sidecar's `services/adp/src/lib/db.ts`. Per the rent-not-own
doctrine, converging two implementations of one part onto the standard is a
**pure dedup** (step 2, no own/retire — both endpoints are `KEEP_EXTERNAL`),
so it needs no WWMD gate.

This removes the `postgres` dependency from the SBOM entirely.

## Change (1 source file + manifest + allowlist)

- `services/adp/src/lib/db.ts` — swap `import postgres from "postgres"` →
  `import { Pool } from "pg"`. `Sql` type becomes `pg.Pool`. The three raw-SQL
  functions (`loadAdpCredential`, `updateTokenCache`, `insertToolCallLog`)
  convert from porsager tagged-templates to `pool.query(text, params)` with
  positional `$n` placeholders. Column identifiers keep their quoted camelCase,
  so the returned `result.rows` objects still match the row interfaces — no
  caller change. `getSql()`/`setSqlForTesting()` keep their signatures; pool
  options map 1:1 (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`).
- `services/adp/package.json` — drop `postgres`, add `pg ^8.22.0` (matching
  apps/web + packages/db) and dev `@types/pg`.
- `sbom/dependency-allowlist.json` — remove the `postgres` entry; add
  `services/adp` to `pg`'s workspaces (112 → 111 acknowledged direct deps).

## Blast radius

Confined to `db.ts`. No consumer writes raw SQL (`grep` for `` sql` `` outside
db.ts is empty) — `creds.ts` and the four tool modules only pass the handle to
db.ts functions or mock `../lib/db.js` at the module boundary. Touches none of
the Inside-Out hot-zones (`schema.prisma`, `lib/tak`, `lib/govern`,
`lib/routing`, `lib/queue`); the one `lib/queue` `pg` importer
(`model-discovery-refresh.ts`) is the survivor side, untouched.

## Verification

- ADP service: `pnpm --filter dpf-adp-mcp typecheck` exit 0; `test` → 35 passed / 11 skipped.
- `node scripts/sbom/check-new-dependencies.mjs` → OK (111 acknowledged).
- Full web `vitest run` → 14874 passed, 0 failed (the lone unhandled-rejection
  in `lib/voice/transcribe.test.ts` is a pre-existing teardown flake, unrelated).
- Guard loop 12 green.

## Follow-on (BET-14 tail, WWMD-gated — NOT in this PR)

The remaining BET-14 own-candidates each need their own `principle_decide`
before code: `nanoid` → a `newId` façade (17 files / 39 sites, no
custom-alphabet), `dotenv` → Node `--env-file` (3 files), `picomatch` (1 dev
test). `undici`→native-fetch is low-payoff (primary surface is `request` +
`MockAgent` + custom-TLS `Agent`) and `undici` is `KEEP_EXTERNAL`; `gray-matter`
is the sole frontmatter parser (own decision, pulls `yaml`). These are tracked
under BI-C0CEB377 as subsequent increments.
