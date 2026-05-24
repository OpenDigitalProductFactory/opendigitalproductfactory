#Requires -Version 5.1
# scripts/safety/transcript-snapshot.ps1
#
# Out-of-band snapshot of Claude Code session transcripts.
#
# BI:   BI-C8655C8C (EP-DR-HARDENING-2026-05-23)
# Lessons: 2026-05-23 overnight session wiped Docker volumes AND its own
# Claude Code transcript was lost — no forensic trace remained. This hook
# breaks that pattern by copying the active transcript to a durable
# location after every Nth tool call (PostToolUse) and on session end
# (SessionEnd). The location lives OUTSIDE the install root so a future
# repo-tree wipe cannot destroy the audit trail.
#
# Invoked by Claude Code hooks defined in .claude/settings.json. Receives
# a JSON payload on stdin:
#   {
#     "session_id": "<uuid>",
#     "transcript_path": "C:/Users/.../.claude/projects/<slug>/<uuid>.jsonl",
#     "tool_name": "Bash",
#     "hook_event_name": "PostToolUse"
#   }
#
# Exit 0 ALWAYS — a snapshot failure must never block the user's tool call.
# Failures are logged to the snapshot dir + surfaced via the operator's
# existing readiness card pattern.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # never throw out of a hook

# Read stdin payload. Pester-friendly: callers can also pass via STDIN-piped string.
$rawPayload = [Console]::In.ReadToEnd()
if (-not $rawPayload) { exit 0 }

try {
    $payload = $rawPayload | ConvertFrom-Json
} catch {
    # Malformed payload from harness — log and exit cleanly.
    exit 0
}

$sessionId      = $payload.session_id
$transcriptPath = $payload.transcript_path
$toolName       = $payload.tool_name
$hookEvent      = $payload.hook_event_name

if (-not $sessionId -or -not $transcriptPath) { exit 0 }
if (-not (Test-Path -LiteralPath $transcriptPath)) { exit 0 }

# ─── Resolve $DPF_DIR + $DPF_BACKUPS_HOST_PATH ──────────────────────────────
#
# Three-source resolution chain:
#   1. $env:DPF_BACKUPS_HOST_PATH (operator override)
#   2. <install-root>/.env DPF_BACKUPS_HOST_PATH= line
#   3. <install-root>-backups (default convention per BI-8004BCD8)
#
# Install root is derived from the script's own location: this script lives
# at $DPF_DIR/scripts/safety/transcript-snapshot.ps1, so $PSScriptRoot/../.. is
# the install root.

$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path

$backupsHostPath = $null
if ($env:DPF_BACKUPS_HOST_PATH) {
    $backupsHostPath = $env:DPF_BACKUPS_HOST_PATH
} elseif (Test-Path -LiteralPath (Join-Path $installRoot '.env')) {
    $envLine = Select-String -LiteralPath (Join-Path $installRoot '.env') -Pattern '^DPF_BACKUPS_HOST_PATH=(.+)$' -ErrorAction SilentlyContinue
    if ($envLine) {
        $backupsHostPath = $envLine.Matches[0].Groups[1].Value.Trim()
    }
}
if (-not $backupsHostPath) {
    $backupsHostPath = "$installRoot-backups"
}

# ─── Snapshot destination ────────────────────────────────────────────────────

$dateDir       = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$snapshotRoot  = Join-Path $backupsHostPath 'session-transcripts'
$snapshotDay   = Join-Path $snapshotRoot $dateDir
$snapshotFile  = Join-Path $snapshotDay "$sessionId.jsonl"
$stateDir      = Join-Path $env:USERPROFILE '.claude\hook-state'
$stateFile     = Join-Path $stateDir "$sessionId.last-snapshot"
$logFile       = Join-Path $snapshotRoot '.snapshot.log'

# ─── Read-only tool allowlist (PostToolUse skip) ────────────────────────────
#
# Skip snapshotting after pure read-only ops — they don't change state, so
# the snapshot wouldn't capture anything new. SessionEnd always snapshots.

$readOnlyTools = @('Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'TaskList', 'TaskGet')
if ($hookEvent -eq 'PostToolUse' -and $toolName -and ($readOnlyTools -contains $toolName)) {
    exit 0
}

# ─── Throttle (PostToolUse only; SessionEnd is always honored) ───────────────
#
# Snapshot at most once per $throttleSeconds even under heavy tool-call
# bursts. State file holds the last-snapshot epoch as a single integer.

$throttleSeconds = 120  # 2 minutes — fast enough to limit data loss, slow
                        # enough to keep hook overhead negligible.

if ($hookEvent -eq 'PostToolUse' -and (Test-Path -LiteralPath $stateFile)) {
    try {
        $lastEpoch = [int64](Get-Content -LiteralPath $stateFile -Raw).Trim()
        $nowEpoch = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
        if (($nowEpoch - $lastEpoch) -lt $throttleSeconds) {
            exit 0
        }
    } catch {
        # Corrupt state file — fall through and snapshot, then overwrite.
    }
}

# ─── Snapshot ────────────────────────────────────────────────────────────────

try {
    if (-not (Test-Path -LiteralPath $snapshotDay)) {
        New-Item -ItemType Directory -Path $snapshotDay -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    # Copy-Item with Force overwrites existing destination. We always
    # overwrite — the latest snapshot supersedes prior ones for this session.
    Copy-Item -LiteralPath $transcriptPath -Destination $snapshotFile -Force
    [int64]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) | Set-Content -LiteralPath $stateFile -Encoding ASCII

    # Audit log line.
    $sizeBytes = (Get-Item -LiteralPath $snapshotFile).Length
    $logLine = ConvertTo-Json -Compress -InputObject @{
        timestamp       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        session_id      = $sessionId
        hook_event      = $hookEvent
        tool_name       = $toolName
        snapshot_path   = $snapshotFile
        size_bytes      = $sizeBytes
        install_root    = $installRoot
        backups_root    = $backupsHostPath
    }
    Add-Content -LiteralPath $logFile -Value $logLine -Encoding UTF8
} catch {
    # Last-resort: write the failure to a sidecar log so the operator sees
    # snapshots stopped working without the hook ever blocking Claude Code.
    try {
        $errLine = ConvertTo-Json -Compress -InputObject @{
            timestamp  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            session_id = $sessionId
            error      = "$($_.Exception.Message)"
        }
        Add-Content -LiteralPath $logFile -Value $errLine -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

# ─── Retention pruning (best-effort, cheap, on every invocation) ─────────────
#
# Delete day-dirs older than $retentionDays. The pruner is intentionally
# cheap — we only touch the top-level YYYY-MM-DD dirs. If a directory
# can't be removed (file lock, permission), skip silently.

$retentionDays = 30
try {
    if (Test-Path -LiteralPath $snapshotRoot) {
        $cutoff = (Get-Date).AddDays(-$retentionDays)
        Get-ChildItem -LiteralPath $snapshotRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' -and $_.LastWriteTime -lt $cutoff } |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
    }
} catch {}

exit 0
