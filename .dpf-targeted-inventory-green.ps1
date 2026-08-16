$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath("D:\DPF-worktrees\.local-ci-runner")
if ($workspace -ne [System.IO.Path]::GetFullPath("D:\DPF-worktrees\.local-ci-runner")) {
  throw "Refusing to prepare an unexpected local-CI workspace: $workspace"
}
if (-not (Test-Path -LiteralPath (Join-Path $workspace ".git"))) {
  throw "The governed local-CI scratch workspace is missing: $workspace"
}

& git -C $workspace reset --hard --quiet
if ($LASTEXITCODE -ne 0) { throw "Could not reset the local-CI scratch workspace." }
& git -C $workspace clean -fd --quiet -e node_modules -e .env
if ($LASTEXITCODE -ne 0) { throw "Could not clean the local-CI scratch workspace." }
& git -C $workspace fetch origin main --deepen=256
if ($LASTEXITCODE -ne 0) { throw "Could not deepen the accepted-base history." }
& git -C $workspace checkout -B local-integration/fix-inventory-preview-integrity origin/main
if ($LASTEXITCODE -ne 0) { throw "Could not check out the accepted base." }
& git -C $workspace merge --no-ff --no-edit fix/inventory-preview-integrity
if ($LASTEXITCODE -ne 0) { throw "Could not merge the inventory repair candidate." }

Push-Location $workspace
try {
  & node scripts/sandbox-freshness-preflight.mjs --converge --branch local-integration/fix-inventory-preview-integrity
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & pnpm --filter "@dpf/db" exec prisma generate
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $env:DATABASE_URL = "postgresql://dpf:dpf_dev@127.0.0.1:5433/dpf"
  & pnpm --filter "@dpf/db" exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & pnpm --filter "@dpf/db" exec vitest run `
    src/inventory-entity-index-integrity-migration.test.ts `
    src/inventory-entity-merge-references.test.ts `
    src/inventory-entity-canonical-read-completeness.test.ts `
    src/inventory-entity-lifecycle.test.ts `
    src/inventory-entity-heap-integrity.test.ts `
    src/discovery-sync.test.ts `
    src/discovery-sync.integrity.test.ts `
    src/discovery-sync.postgres.test.ts `
    scripts/index-integrity-guard.test.ts `
    src/sanitized-clone.test.ts `
    src/sanitized-clone.postgres.test.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & pnpm --filter web exec vitest run `
    lib/actions/assets.test.ts `
    lib/actions/inventory.test.ts `
    lib/consume/discovery-data.test.ts `
    lib/customer-estate/account-estate-summary.test.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node --test scripts/lib/dev-preview-migrate-converge.test.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node --test tests/release/dev-portal-lease-contract.test.mjs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
