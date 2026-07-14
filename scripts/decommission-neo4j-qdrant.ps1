# scripts/decommission-neo4j-qdrant.ps1
# BET-5 (BI-922EBB99): Windows equivalent of decommission-neo4j-qdrant.sh — remove the Neo4j +
# Qdrant containers and their data volumes AFTER their data is copied into the Postgres mirror.
# DATA-SAFETY GATED and idempotent. See the .sh header for the full contract.
#
# Per-store gate: Neo4j removed only once graph_node holds InfraCI nodes (the only
# non-regenerable payload); Qdrant removed only once vector_embedding holds rows.
# Set $env:DPF_FORCE_DECOMMISSION="1" to bypass the gate (NOT recommended).
#
# Exit codes: 0 done / no-op; 2 prereq missing; 3 safety gate failed.

$ErrorActionPreference = "Stop"

function Log([string]$m) { Write-Host "[decommission] $m" }
function Fail([string]$m, [int]$code = 1) { Log "failed: $m"; exit $code }

$PG               = if ($env:DPF_POSTGRES_CONTAINER) { $env:DPF_POSTGRES_CONTAINER } else { "dpf-postgres-1" }
$DB_NAME          = if ($env:DPF_DB_NAME) { $env:DPF_DB_NAME } else { "dpf" }
$DB_USER          = if ($env:DPF_DB_USER) { $env:DPF_DB_USER } else { "dpf" }
$NEO4J_CONTAINER  = if ($env:DPF_NEO4J_CONTAINER)  { $env:DPF_NEO4J_CONTAINER }  else { "dpf-neo4j-1" }
$NEO4J_VOLUME     = if ($env:DPF_NEO4J_VOLUME)     { $env:DPF_NEO4J_VOLUME }     else { "dpf_neo4jdata" }
$QDRANT_CONTAINER = if ($env:DPF_QDRANT_CONTAINER) { $env:DPF_QDRANT_CONTAINER } else { "dpf-qdrant-1" }
$QDRANT_VOLUME    = if ($env:DPF_QDRANT_VOLUME)    { $env:DPF_QDRANT_VOLUME }    else { "dpf_qdrant_data" }
$FORCE            = if ($env:DPF_FORCE_DECOMMISSION) { $env:DPF_FORCE_DECOMMISSION } else { "0" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "docker CLI not available" 2 }

function Container-Exists([string]$n) { (docker ps -a --format '{{.Names}}') -contains $n }
function Volume-Exists([string]$n)    { (docker volume ls --format '{{.Name}}') -contains $n }

# Count rows via psql inside the Postgres container. Returns $null on any error.
function Pg-Count([string]$sql) {
  try {
    $out = docker exec $PG psql -U $DB_USER -d $DB_NAME -tAc $sql 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return [int]($out -replace '\s', '')
  } catch { return $null }
}

function Remove-Store([string]$name, [string]$container, [string]$volume) {
  $img = ""
  if (Container-Exists $container) {
    $img = (docker inspect --format '{{.Config.Image}}' $container 2>$null)
    Log "removing $name container: $container"
    docker rm -f $container | Out-Null
  } else { Log "$name container $container not present - skipping" }
  if (Volume-Exists $volume) {
    Log "removing $name volume: $volume"
    docker volume rm $volume | Out-Null
  } else { Log "$name volume $volume not present - skipping" }
  # Best-effort image reclaim - never fails the run (image may be shared or in use).
  if ($img) {
    Log "reclaiming $name image: $img"
    docker rmi $img 2>$null | Out-Null
  }
}

if (-not (Container-Exists $NEO4J_CONTAINER) -and -not (Container-Exists $QDRANT_CONTAINER) `
    -and -not (Volume-Exists $NEO4J_VOLUME) -and -not (Volume-Exists $QDRANT_VOLUME)) {
  Log "no Neo4j/Qdrant containers or volumes present - already decommissioned."
  exit 0
}

# Neo4j: gate on InfraCI presence in the graph mirror.
if ((Container-Exists $NEO4J_CONTAINER) -or (Volume-Exists $NEO4J_VOLUME)) {
  if ($FORCE -eq "1") {
    Log "FORCE set - skipping Neo4j mirror gate"
    Remove-Store "Neo4j" $NEO4J_CONTAINER $NEO4J_VOLUME
  } else {
    $infra = Pg-Count "SELECT count(*) FROM graph_node WHERE 'InfraCI' = ANY(labels)"
    if ($null -ne $infra -and $infra -gt 0) {
      Log "graph mirror holds $infra InfraCI node(s) - Neo4j safe to remove"
      Remove-Store "Neo4j" $NEO4J_CONTAINER $NEO4J_VOLUME
    } else {
      Fail "graph mirror has no InfraCI nodes yet - boot the portal on the BET-5 image so the backfill runs, then re-run (or set DPF_FORCE_DECOMMISSION=1)" 3
    }
  }
}

# Qdrant: gate on vector_embedding rows.
if ((Container-Exists $QDRANT_CONTAINER) -or (Volume-Exists $QDRANT_VOLUME)) {
  if ($FORCE -eq "1") {
    Log "FORCE set - skipping Qdrant mirror gate"
    Remove-Store "Qdrant" $QDRANT_CONTAINER $QDRANT_VOLUME
  } else {
    $vec = Pg-Count "SELECT count(*) FROM vector_embedding"
    if ($null -ne $vec -and $vec -gt 0) {
      Log "vector mirror holds $vec embedding(s) - Qdrant safe to remove"
      Remove-Store "Qdrant" $QDRANT_CONTAINER $QDRANT_VOLUME
    } else {
      Fail "vector mirror is empty - boot the portal on the BET-5 image so the backfill runs, then re-run (or set DPF_FORCE_DECOMMISSION=1)" 3
    }
  }
}

Log "decommission complete."
exit 0
