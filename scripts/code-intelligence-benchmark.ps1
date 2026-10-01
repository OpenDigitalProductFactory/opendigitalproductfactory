# Endpoint and credential come from the environment, like the gate scripts
# (scripts/pregate.mjs): DPF_MCP_URL, else the local endpoint, and the bearer
# from DPF_MCP_BEARER_TOKEN. No project .mcp.json is read (BI-5201141C): on
# https Claude Code's dpf connector is the plugin's URL-only OAuth descriptor.
param(
  [string]$McpUrl = "",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

function Read-McpConfig {
  param([string]$Url)

  if (-not $Url) { $Url = $env:DPF_MCP_URL }
  if (-not $Url) { $Url = "http://127.0.0.1:3000/api/mcp/v1" }
  $token = $env:DPF_MCP_BEARER_TOKEN
  if (-not $token) {
    throw "DPF_MCP_BEARER_TOKEN is not set; the benchmark calls the MCP endpoint with a bearer."
  }

  return [pscustomobject]@{ url = $Url; authorization = "Bearer $token" }
}

function Read-McpTextJson {
  param($Response)

  $content = @($Response.result.content)
  $text = $content | Where-Object { $_.type -eq "text" } | Select-Object -First 1 -ExpandProperty text
  if (-not $text) {
    return $null
  }

  return $text | ConvertFrom-Json
}

function Get-ResultCount {
  param($Parsed)

  if (-not $Parsed -or -not $Parsed.data) {
    return 0
  }

  if ($Parsed.data.results) {
    return @($Parsed.data.results).Count
  }
  if ($Parsed.data.tests) {
    return @($Parsed.data.tests).Count
  }
  if ($Parsed.data.relatedTests) {
    return @($Parsed.data.relatedTests).Count
  }

  return 0
}

function Invoke-McpToolMeasured {
  param(
    [int]$Id,
    [string]$Name,
    [hashtable]$Arguments,
    [string]$Label
  )

  $body = @{
    jsonrpc = "2.0"
    id = $Id
    method = "tools/call"
    params = @{
      name = $Name
      arguments = $Arguments
    }
  } | ConvertTo-Json -Depth 30

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-RestMethod -Uri $script:Server.url -Method Post -Headers $script:Headers -Body $body
  $sw.Stop()

  $parsed = Read-McpTextJson -Response $response

  return [ordered]@{
    id = $Id
    label = $Label
    tool = $Name
    durationMs = $sw.ElapsedMilliseconds
    success = if ($parsed) { $parsed.success } else { $null }
    resultCount = Get-ResultCount -Parsed $parsed
    message = if ($parsed) { $parsed.message } else { "" }
  }
}

$script:Server = Read-McpConfig -Url $McpUrl
$script:Headers = @{
  Authorization = $script:Server.authorization
  "Content-Type" = "application/json"
}

$calls = @()
$calls += Invoke-McpToolMeasured -Id 101 -Label "seed-source-p2002" -Name "search_project_files" -Arguments @{ query = "P2002"; glob = "*.ts"; maxResults = 10 }
$calls += Invoke-McpToolMeasured -Id 102 -Label "seed-source-contract" -Name "search_project_files" -Arguments @{ query = "contract under test is seedCityOnce"; glob = "*.ts"; maxResults = 10 }
$calls += Invoke-McpToolMeasured -Id 103 -Label "seed-graph-symbol" -Name "search_code_graph" -Arguments @{ query = "seedCityOnce"; limit = 10 }
$calls += Invoke-McpToolMeasured -Id 104 -Label "seed-graph-tests" -Name "find_related_tests" -Arguments @{ filePath = "packages/db/src/seed-geographic-data.ts"; limit = 10 }
$calls += Invoke-McpToolMeasured -Id 201 -Label "tool-source-name" -Name "search_project_files" -Arguments @{ query = "get_code_graph_freshness"; glob = "*.ts"; maxResults = 20 }
$calls += Invoke-McpToolMeasured -Id 202 -Label "tool-source-function" -Name "search_project_files" -Arguments @{ query = "getCodeGraphFreshness"; glob = "*.ts"; maxResults = 20 }
$calls += Invoke-McpToolMeasured -Id 203 -Label "tool-graph-freshness" -Name "get_code_graph_freshness" -Arguments @{}
$calls += Invoke-McpToolMeasured -Id 204 -Label "tool-graph-search" -Name "search_code_graph" -Arguments @{ query = "get_code_graph_freshness"; limit = 10 }
$calls += Invoke-McpToolMeasured -Id 205 -Label "tool-graph-trace" -Name "trace_code_surface" -Arguments @{ tool = "get_code_graph_freshness" }

$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  serverUrl = $script:Server.url
  calls = $calls
}

$json = $result | ConvertTo-Json -Depth 20
if ($OutputPath) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }
  Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8
} else {
  $json
}
