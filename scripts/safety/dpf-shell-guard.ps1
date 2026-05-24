#Requires -Version 5.1
# scripts/safety/dpf-shell-guard.ps1
#
# Windows counterpart of dpf-shell-guard.sh. Installer copies this into
# $DPF_DIR\safety-bin\ and generates .cmd shims (docker.cmd, git.cmd, etc.)
# that invoke `pwsh -NoProfile -File dpf-shell-guard.ps1 -BinName <name> -- ARGS`.
#
# Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
# Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md

param(
  [Parameter(Mandatory = $true)][string]$BinName,
  [Parameter(ValueFromRemainingArguments = $true)]$Args
)

$ErrorActionPreference = 'Stop'

$GateUrl = if ($env:DPF_GATE_URL) { $env:DPF_GATE_URL } else { 'http://localhost:3000/api/kernel/gate' }
$SessionClass = if ($env:DPF_AUTONOMOUS_SESSION_ID) { 'autonomous' } else { 'interactive' }
$GuardDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load real-binary paths cached at install time. PowerShell equivalent of the
# .env file the POSIX guard reads — a .ps1 we dot-source.
$RealEnvFile = Join-Path $GuardDir 'real-binaries.ps1'
if (Test-Path $RealEnvFile) { . $RealEnvFile }
$realVarName = "DPF_REAL_$($BinName.ToUpper())"
$RealBin = (Get-Item "env:$realVarName" -ErrorAction SilentlyContinue).Value

if (-not $RealBin -or -not (Test-Path -LiteralPath $RealBin)) {
  Write-Error "[dpf-shell-guard] cannot find real $BinName (set $realVarName or reinstall)"
  exit 127
}

# Build the request body using ConvertTo-Json (PowerShell's native JSON
# emitter handles backslash/quote/control-char escaping).
$argsArray = @()
if ($null -ne $Args) {
  $argsArray = @($Args | ForEach-Object { [string]$_ })
}
$body = @{
  attempt = @{ kind = 'shell'; command = $BinName; args = $argsArray }
  sessionClass = $SessionClass
} | ConvertTo-Json -Compress -Depth 5

# Call the gate (overridable via DPF_GATE_CMD env for tests; returns JSON
# response text on stdout).
$resp = $null
try {
  if ($env:DPF_GATE_CMD) {
    $resp = Invoke-Expression $env:DPF_GATE_CMD
  } else {
    $resp = Invoke-RestMethod -Method Post -Uri $GateUrl -Body $body `
              -ContentType 'application/json' -TimeoutSec 3 |
              ConvertTo-Json -Depth 5 -Compress
  }
} catch {
  $resp = '{"verdict":"_unreachable"}'
}

# Parse the response.
try {
  $decision = $resp | ConvertFrom-Json
} catch {
  $decision = [PSCustomObject]@{ verdict = '_unreachable' }
}

function Invoke-Real {
  & $RealBin @argsArray
  exit $LASTEXITCODE
}

switch ($decision.verdict) {
  'allow' { Invoke-Real }
  'refuse' {
    $slug = $decision.principleSlug
    $rat = $decision.rationale
    Write-Error "[dpf-shell-guard] REFUSED by kernel commandment '$slug': $rat"
    Write-Error "                  Operator may bypass via absolute path: $RealBin ..."
    exit 1
  }
  'require_confirm' {
    $slug = $decision.principleSlug
    $rat = $decision.rationale
    $phrase = $decision.requiredPhrase
    Write-Host ""
    Write-Host "[dpf-shell-guard] Commandment '$slug' requires explicit operator go:"
    Write-Host "                  $rat"
    Write-Host ""
    Write-Host "  Type EXACTLY (no quotes): $phrase"
    $typed = Read-Host "  > "
    if ($typed -ceq $phrase) { Invoke-Real }
    Write-Error "[dpf-shell-guard] phrase mismatch — REFUSED"
    exit 1
  }
  '_unreachable' {
    # Fail-closed for tier-commandment patterns: parse the static fallback
    # JSON, regex-match the command line, refuse if any pattern matches.
    $fallback = Join-Path $GuardDir 'dpf-shell-guard-fallback-patterns.json'
    $cmdLine = "$BinName $($argsArray -join ' ')"
    if (Test-Path $fallback) {
      $fb = Get-Content -Raw $fallback | ConvertFrom-Json
      foreach ($p in $fb.patterns) {
        if ($p.kind -ne 'shell') { continue }
        if ($cmdLine -match $p.regex) {
          Write-Error "[dpf-shell-guard] gate unreachable AND command matches static fallback — REFUSED"
          Write-Error "                  $($p.rationale)"
          Write-Error "                  Operator may bypass via absolute path: $RealBin ..."
          exit 1
        }
      }
    }
    Invoke-Real
  }
  default {
    Write-Error "[dpf-shell-guard] unknown verdict '$($decision.verdict)'; refusing"
    exit 1
  }
}
