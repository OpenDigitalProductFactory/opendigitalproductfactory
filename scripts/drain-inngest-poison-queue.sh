#!/usr/bin/env bash
# Drain "poison" items from the self-hosted Inngest queue (BI-C8164664).
#
# THE BUG
# -------
# inngest/inngest 1.26 (the version :latest drifted onto) enqueued queue items
# with a nil environment/workspace id (wsID = 00000000-0000-0000-0000-000000000000).
# Newer Inngest (1.28+, and the pinned v1.36.0) reject those items at the
# capacity-lease CONSTRAINT check with `invalid request: ... missing envID`.
# Because that rejection happens BEFORE the attempt counter increments, the items
# never exhaust `maxAtts` and never dead-letter — the scheduler re-scans them
# forever, emitting two ERROR lines (with full base64 stack traces) per item per
# pass. A backlog of ~22k such items produced ~135 log lines/sec, pinned the
# scheduler CPU, and grew the container log to multiple GB ("scrolling like crazy").
#
# Bumping the image version (docker-compose.yml) stops NEW poison items from being
# enqueued, but does NOT drain ones already sitting in the Redis queue store. This
# script does the one-time drain. It is SAFE TO RE-RUN (idempotent) and only
# touches partitions whose head item carries the nil workspace id, so legitimate
# cron / app partitions (e.g. the 00000000-...-4000-b000-... system workspace) are
# left untouched.
#
# WHAT IT TOUCHES
# ---------------
# The Inngest queue lives in the Redis instance pointed to by INNGEST_REDIS_URI
# (in DPF compose that's the `redis` service, which is Inngest-dedicated — no
# other service sets a REDIS_URL/REDIS_URI). Per-function work is laid out as:
#   {queue}:queue:sorted:<fnID>          ZSET of due item ids   (scanner input)
#   {queue}:queue:status:<fnID>:start    ZSET of in-status items
#   {queue}:queue:item                   HASH  itemId -> item JSON (global)
#   {queue}:partition:sorted             ZSET of ready partitions (global pointer)
#   {queue}:accounts:<acct>:partition:sorted  ZSET of partitions per account
# For each poison function this script deletes the two per-function ZSETs and
# removes the function from the partition pointers. Orphaned {queue}:queue:item
# fields and {estate:<runID>}:* leaf keys for those dead runs are left to expire
# via their existing TTLs (they are not re-scanned, so they do not flood).
#
# USAGE
#   scripts/drain-inngest-poison-queue.sh            # dry-run: report only
#   scripts/drain-inngest-poison-queue.sh --apply    # stop inngest, drain, restart
set -euo pipefail

REDIS_CONTAINER="${DPF_REDIS_CONTAINER:-dpf-redis-1}"
INNGEST_CONTAINER="${DPF_INNGEST_CONTAINER:-dpf-inngest-1}"
NIL_WS='00000000-0000-0000-0000-000000000000'
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

redis() { docker exec "$REDIS_CONTAINER" redis-cli "$@"; }

echo "Scanning Inngest queue partitions in $REDIS_CONTAINER ..."
# bash 3.2 (macOS default) has no `mapfile`; read into an array portably.
PARTITIONS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && PARTITIONS+=("$line")
done < <(redis --scan --pattern '{queue}:queue:sorted:*' --count 5000 | grep -vE ':sorted:cron')

poison_fns=()
for key in "${PARTITIONS[@]}"; do
  [[ -z "$key" ]] && continue
  fnid="${key##*:}"
  card="$(redis ZCARD "$key")"
  # Peek the head member (lowest score = soonest due) and read its item body
  # from the global item hash. The nil workspace id is the reliable poison signal.
  member="$(redis ZRANGE "$key" 0 0 | head -1 || true)"
  [[ -z "$member" ]] && continue
  itemjson="$(redis HGET '{queue}:queue:item' "$member" 2>/dev/null || true)"
  if [[ "$itemjson" == *"\"wsID\":\"$NIL_WS\""* ]]; then
    poison_fns+=("$fnid")
    echo "  POISON  ${card} items  fn=$fnid"
  else
    echo "  ok      ${card} items  fn=$fnid"
  fi
done

if [[ ${#poison_fns[@]} -eq 0 ]]; then
  echo "No poison partitions found. Nothing to drain."
  exit 0
fi

echo
echo "${#poison_fns[@]} poison partition(s) identified."
if [[ $APPLY -eq 0 ]]; then
  echo "Dry-run only. Re-run with --apply to drain."
  exit 0
fi

echo "Stopping $INNGEST_CONTAINER to halt the scanner ..."
docker stop "$INNGEST_CONTAINER" >/dev/null

# Account-scoped partition pointers (the nil-workspace items live under the
# nil/zero account); ZREM is a no-op when the member is absent, so removing the
# function from every account pointer is safe.
ACCT_POINTERS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && ACCT_POINTERS+=("$line")
done < <(redis --scan --pattern '{queue}:accounts:*:partition:sorted' --count 5000)

for fnid in "${poison_fns[@]}"; do
  redis DEL "{queue}:queue:sorted:${fnid}" >/dev/null
  redis DEL "{queue}:queue:status:${fnid}:start" >/dev/null
  redis ZREM '{queue}:partition:sorted' "$fnid" >/dev/null || true
  redis HDEL '{queue}:partition:item' "$fnid" >/dev/null || true
  for ap in "${ACCT_POINTERS[@]}"; do
    [[ -z "$ap" ]] && continue
    redis ZREM "$ap" "$fnid" >/dev/null || true
  done
  echo "  drained fn=$fnid"
done

echo "Restarting $INNGEST_CONTAINER ..."
docker start "$INNGEST_CONTAINER" >/dev/null

echo "Done. Confirm the storm has stopped (expect a small number):"
echo "  sleep 15 && docker logs --since 10s $INNGEST_CONTAINER 2>&1 | wc -l"
