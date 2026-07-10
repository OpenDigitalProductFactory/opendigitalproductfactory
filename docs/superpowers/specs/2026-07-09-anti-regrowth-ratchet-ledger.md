# Anti-regrowth ratchet ledger — EP-8DC217EB §6 standing discipline

_Status: BI-81EE4A46 · EP-8DC217EB (Vertical Integration Inward) plan §6 · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §6 (ratchet — every consolidation ships a guard so the duplication cannot regrow)_

## Purpose

Plan §6 requires that **every** consolidation ship a guard so the collapsed
duplication cannot regrow, mirroring the dependency gates. Since BI-3B0AD9CF a
new ratchet is **one `scripts/check-no-*.mjs` file** — the `Repo Guard Loop`
(`scripts/check-guards.mjs`) auto-discovers it and runs its sibling
`*.test.mjs` self-test first; no `ci.yml` or `package.json` edit. This doc is
the running ledger of the §6-named ratchets.

## Ledger

| §6 ratchet | Canonical target | Guard | Status |
|---|---|---|---|
| ban raw `err.message` ternary | `getErrorMessage` (`lib/shared/get-error-message`) | `check-no-raw-error-message.mjs` | shipped (BET-6) |
| ban new local `isRecord` | `isRecord` (`lib/shared/coerce`) | `check-no-local-isrecord.mjs` | shipped (BET-6) |
| ban new `requireAuth`/`requireUser` variants | `lib/actions/shared/guards` | `check-no-local-auth-guard.mjs` | shipped (BET-2) |
| ban new local backup helper / heartbeat / metric | `managed-backup`/`managed-restore` | `check-no-local-backup-helper.mjs` | shipped (BET-11) |
| **ban new local `Record<…, Intent>` status→color map** | report-kit `statusColors` / `<StatusBadge domain=… status=…>` | **`check-no-local-status-color.mjs`** | **this BI** |
| **ban new raw `NextResponse.json({ error })`** | `apiErrorResponse` (`lib/api/error`) | **`check-no-raw-route-error.mjs`** | **this BI** |
| cap the MCP tool count / drain the switch | `composeToolPacks` + packs | `check-mcp-tool-pack.mjs` (inline-switch freeze) | partial — a runtime total-count cap is a tracked follow-up |
| ban new `status String` without a registered catalog | (a status-catalog registry) | — | tracked follow-up (needs the catalog substrate first) |

## The two ratchets added here (BI-81EE4A46)

### `check-no-local-status-color.mjs`
Allowlist-style (mirrors `check-no-local-isrecord`): 8 files already defining a
local `Record<…, Intent>` status map are the migration backlog; a NEW local
map outside the allowlist (and outside report-kit, the canonical palette home)
fails CI. Steers new reporting UI to `<StatusBadge domain=… status=…>`. A stale
allowlist entry (file migrated) also fails, keeping the backlog honest.

### `check-no-raw-route-error.mjs`
Per-file **count** baseline (mirrors `check-style-drift`/`check-module-size`):
`scripts/route-error-baseline.txt` freezes the 292 raw
`NextResponse.json({ error … })` occurrences across 83 route files; each file
may only shrink. New file or grown count fails CI, steering to
`apiErrorResponse`. The baseline is **line-oriented with `merge=union`**
(`.gitattributes`, per BI-3B0AD9CF) so concurrent migration PRs never conflict;
the parser resolves union-merge duplicate paths to the max count. `--update`
retightens after a migration.

## Remaining §6 ratchets (tracked, not yet shipped)

- **MCP tool-count cap** — `check-mcp-tool-pack.mjs` already freezes the inline
  `executeTool` switch (new tools must register in a pack), but a hard cap on
  the *total assembled* tool count (the AGENTS.md ~15 selection-collapse
  ceiling) needs to count `PLATFORM_TOOLS` at runtime — a static `.mjs` cannot
  assemble the packs. Deferred to BET-4 (MCP tool-pack migration), which owns
  the assembly surface.
- **`status String` catalog guard** — requires the status-catalog registry
  substrate to exist first (BET-1/BET-10 read-model work); the guard lands with
  that substrate.
