param(
  [string]$ConfigPath = "$HOME\.codex\config.toml",
  [string]$ServerName = "youtube_transcript",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Codex config not found at '$ConfigPath'."
}

$config = Get-Content -LiteralPath $ConfigPath -Raw
$sectionHeader = "[mcp_servers.$ServerName]"

if ($config -match [regex]::Escape($sectionHeader) -and -not $Force) {
  Write-Output "MCP server '$ServerName' already exists in $ConfigPath."
  exit 0
}

$backupPath = "$ConfigPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $ConfigPath -Destination $backupPath

$block = @"

[mcp_servers.$ServerName]
command = "npx"
args = ["-y", "@emit-ia/youtube-transcript-mcp"]
"@

if ($config -match [regex]::Escape($sectionHeader) -and $Force) {
  $pattern = "(?ms)^\[mcp_servers\.$([regex]::Escape($ServerName))\].*?(?=^\[|\z)"
  $updated = [regex]::Replace($config, $pattern, $block.TrimStart())
} else {
  $updated = $config.TrimEnd() + $block
}

Set-Content -LiteralPath $ConfigPath -Value $updated -NoNewline

Write-Output "Updated $ConfigPath"
Write-Output "Backup created at $backupPath"
Write-Output "Configured MCP server '$ServerName' using @emit-ia/youtube-transcript-mcp"
Write-Output "Restart Codex to load the new MCP server."
