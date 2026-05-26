# Open Digital Product Factory -- contributor skill pack installer (Windows)
#
# Ensures the repo-local dpf-platform skill pack is available to contributor
# coding clients without affecting customer coworker seeding. Surface B always
# seeds from packages/dpf-skill-pack via packages/db/src/seed-skills.ts.

param(
    [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Write-Ok { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Skip { param($msg) Write-Host "  [SKIP] $msg" -ForegroundColor Yellow }
function Write-WarnLocal { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$claudeMarketplace = Join-Path $RepoRoot ".claude-plugin\marketplace.json"
$claudePluginManifest = Join-Path $RepoRoot "packages\dpf-skill-pack\.claude-plugin\plugin.json"
$codexMarketplace = Join-Path $RepoRoot ".agents\plugins\marketplace.json"
$codexPluginManifest = Join-Path $RepoRoot "packages\dpf-skill-pack\.codex-plugin\plugin.json"

Write-Host ""
Write-Host "-> Ensuring DPF contributor skill pack" -ForegroundColor Yellow

if ((Test-Path -LiteralPath (Join-Path $HOME ".claude")) -and (Get-Command claude -ErrorAction SilentlyContinue)) {
    if ((Test-Path -LiteralPath $claudeMarketplace) -and (Test-Path -LiteralPath $claudePluginManifest)) {
        Push-Location -LiteralPath $RepoRoot
        try {
            & claude plugin validate $claudePluginManifest | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Claude plugin manifest validation failed." }
            & claude plugin validate $claudeMarketplace | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Claude marketplace validation failed." }
            & claude plugin marketplace add ./ --scope local | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Claude marketplace registration failed." }
            & claude plugin install dpf-platform@dpf-platform-local --scope local | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Claude plugin install failed." }
            Write-Ok "Claude Code local scope points at dpf-platform."
        } catch {
            Write-WarnLocal "Claude Code dpf-platform install failed (non-fatal): $_"
        } finally {
            Pop-Location
        }
    } else {
        Write-WarnLocal "Claude marketplace or plugin manifest missing; skipping Claude Code skill install."
    }
} else {
    Write-Skip "Claude Code home/CLI not detected; Surface A install deferred."
}

if ((Test-Path -LiteralPath $codexMarketplace) -and (Test-Path -LiteralPath $codexPluginManifest)) {
    Write-Ok "Codex repo marketplace is present at .agents/plugins/marketplace.json."
    Write-Ok "Codex will discover dpf-platform from the repo marketplace or legacy-compatible Claude marketplace."
} else {
    Write-WarnLocal "Codex marketplace or plugin manifest missing."
}

Write-Host ""
