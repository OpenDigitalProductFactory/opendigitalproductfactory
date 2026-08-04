#!/usr/bin/env bash
# scripts/verify-edge-node-air-gap.sh
#
# Produce auditable evidence that a DPF Edge Node install is air-gap
# safe: zero outbound packets off the Authority allow-list, observation
# replay correctness after Authority outages, and Edge Node liveness
# throughout.
#
# Runs on the Edge Node host (NOT the Authority host). Installs a
# transient iptables OUTPUT chain that ACCEPTs traffic to loopback +
# the resolved Authority IPs, LOGs everything else with a known
# prefix, and DROPs it. After the run, the script tallies the LOG
# entries and writes a markdown report.
#
# The cleanup trap restores iptables on any exit path — Ctrl-C,
# scripted termination, or panic. If you abort the host (kernel
# panic / power loss), restart and run `iptables -F DPF_AIRGAP_OUT &&
# iptables -X DPF_AIRGAP_OUT` once to clean up. The chain is named so
# you can spot it.
#
# Spec:    docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
# Footprint contract (FP1, BI-4B381171): docs/superpowers/specs/
#   2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md §6
# Runbook: docs/install/edge-node-air-gapped.md
# Report:  docs/install/edge-node-air-gapped-verification-report.md
#
# --allow-federation-discovery-mdns (BI-4B381171): the native Go edge
# runtime's optional `federation.discovery` capability (only ever accepted
# by the Authority — services/edge-node-go/internal/federation/zeroconf.go)
# sends/receives IPv4 mDNS on 224.0.0.251:5353 to find nearby DPF
# installations. That traffic never touches the Authority IP, so a node
# running with this capability accepted will otherwise show as a FAIL
# against the default allow-list even though it never opens an inbound
# listener and never talks to any host outside the mDNS multicast group.
# Pass this flag when testing a node with federation.discovery accepted;
# omit it (the default) to verify the strict single-Authority-destination
# posture most nodes run under.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  verify-edge-node-air-gap.sh \
    --mode {sanity|soak} \
    --authority-url URL \
    [--duration-sec N] \
    [--report PATH] \
    [--allow-extra IP[,IP...]] \
    [--allow-federation-discovery-mdns] \
    [--log-prefix PREFIX] \
    [--no-iptables]

Modes:
  sanity   10-minute fast check (default duration 600 s).
  soak     long-running verification (default duration 86400 s = 24 h).

Required:
  --authority-url   HTTP(S) URL the Edge Node speaks to. Resolved at
                    script start; allow-list contains every A/AAAA
                    record returned.

Optional:
  --duration-sec    Override the default duration for the mode.
  --report          Output report path. Default:
                    ./edge-node-air-gap-{mode}-report.md
  --allow-extra     Additional IPs to ACCEPT (e.g. internal DNS,
                    internal NTP). Comma-separated. Loopback is
                    always allowed implicitly.
  --allow-federation-discovery-mdns
                    ACCEPT outbound UDP to 224.0.0.251:5353 (IPv4 mDNS)
                    for nodes running with the native binary's
                    federation.discovery capability accepted. Off by
                    default — most nodes should verify clean against
                    the Authority-only allow-list.
  --log-prefix      iptables LOG prefix. Default: "dpf-airgap: "
  --no-iptables     Skip iptables setup (for environments that
                    manage egress filtering externally). Script
                    still observes /var/log/kern.log for matching
                    prefix entries written by an external filter.

Examples:
  sudo ./verify-edge-node-air-gap.sh \
    --mode sanity --authority-url https://dpf-authority.lan

  sudo ./verify-edge-node-air-gap.sh \
    --mode soak --authority-url https://dpf-authority.lan \
    --duration-sec 604800 --allow-extra 10.0.0.53,10.0.0.123 \
    --report ./soak-2026-05-14.md
EOF
}

MODE=""
AUTHORITY_URL=""
DURATION_SEC=""
REPORT=""
ALLOW_EXTRA=""
ALLOW_MDNS=0
LOG_PREFIX="dpf-airgap: "
NO_IPTABLES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)            shift; MODE="${1:?--mode requires a value}" ;;
    --authority-url)   shift; AUTHORITY_URL="${1:?--authority-url requires a value}" ;;
    --duration-sec)    shift; DURATION_SEC="${1:?--duration-sec requires a value}" ;;
    --report)          shift; REPORT="${1:?--report requires a value}" ;;
    --allow-extra)     shift; ALLOW_EXTRA="${1:?--allow-extra requires a value}" ;;
    --allow-federation-discovery-mdns) ALLOW_MDNS=1 ;;
    --log-prefix)      shift; LOG_PREFIX="${1:?--log-prefix requires a value}" ;;
    --no-iptables)     NO_IPTABLES=1 ;;
    -h|--help)         usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$MODE" || -z "$AUTHORITY_URL" ]]; then
  echo "ERROR: --mode and --authority-url are required." >&2
  usage >&2
  exit 2
fi

case "$MODE" in
  sanity) DURATION_SEC="${DURATION_SEC:-600}" ;;
  soak)   DURATION_SEC="${DURATION_SEC:-86400}" ;;
  *) echo "ERROR: --mode must be 'sanity' or 'soak'." >&2; exit 2 ;;
esac

REPORT="${REPORT:-./edge-node-air-gap-${MODE}-report.md}"

# --- Preflight ---------------------------------------------------------------

if [[ $NO_IPTABLES -eq 0 ]]; then
  if [[ "$EUID" -ne 0 ]]; then
    echo "ERROR: iptables mode requires root. Re-run with sudo, or pass --no-iptables." >&2
    exit 1
  fi
  if ! command -v iptables >/dev/null 2>&1; then
    echo "ERROR: iptables not found. Install it or pass --no-iptables." >&2
    exit 1
  fi
fi

# Resolve authority hostname → IPs. We accept whatever getent says.
AUTHORITY_HOST="$(echo "$AUTHORITY_URL" | sed -E 's|^[a-z]+://([^:/]+).*|\1|')"
if [[ -z "$AUTHORITY_HOST" ]]; then
  echo "ERROR: could not parse host from --authority-url=$AUTHORITY_URL" >&2
  exit 1
fi

mapfile -t AUTHORITY_IPS < <(getent ahosts "$AUTHORITY_HOST" \
  | awk '{print $1}' | sort -u)
if [[ ${#AUTHORITY_IPS[@]} -eq 0 ]]; then
  echo "ERROR: could not resolve $AUTHORITY_HOST to any IP." >&2
  exit 1
fi

# Find a kernel log we can tail for iptables LOG entries.
KERN_LOG=""
for candidate in /var/log/kern.log /var/log/messages; do
  if [[ -r "$candidate" ]]; then KERN_LOG="$candidate"; break; fi
done
USE_JOURNAL=0
if [[ -z "$KERN_LOG" ]]; then
  if command -v journalctl >/dev/null 2>&1; then
    USE_JOURNAL=1
  else
    echo "WARN: no readable /var/log/{kern,messages}.log and no journalctl. Egress observations will be empty." >&2
  fi
fi

# --- iptables setup ----------------------------------------------------------

CHAIN="DPF_AIRGAP_OUT"
INSTALLED_RULES=0

cleanup() {
  set +e
  if [[ $INSTALLED_RULES -eq 1 ]]; then
    echo "[cleanup] removing iptables rules ..."
    iptables -D OUTPUT -j "$CHAIN" 2>/dev/null || true
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ $NO_IPTABLES -eq 0 ]]; then
  iptables -N "$CHAIN" 2>/dev/null || { iptables -F "$CHAIN"; }
  iptables -A "$CHAIN" -o lo -j ACCEPT
  for ip in "${AUTHORITY_IPS[@]}"; do
    iptables -A "$CHAIN" -d "$ip" -j ACCEPT
  done
  if [[ -n "$ALLOW_EXTRA" ]]; then
    IFS=',' read -ra EXTRA_IPS <<< "$ALLOW_EXTRA"
    for ip in "${EXTRA_IPS[@]}"; do
      iptables -A "$CHAIN" -d "$ip" -j ACCEPT
    done
  fi
  if [[ $ALLOW_MDNS -eq 1 ]]; then
    # federation.discovery capability (native binary only, Authority
    # opt-in): outbound IPv4 mDNS query/response on 224.0.0.251:5353.
    # See the BI-4B381171 header comment above for why this is a
    # legitimate non-Authority egress class, not a violation.
    iptables -A "$CHAIN" -d 224.0.0.251 -p udp --dport 5353 -j ACCEPT
  fi
  # Match outgoing established/related back, so reply traffic isn't logged.
  iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A "$CHAIN" -j LOG --log-prefix "$LOG_PREFIX" --log-level 4
  iptables -A "$CHAIN" -j DROP
  iptables -I OUTPUT 1 -j "$CHAIN"
  INSTALLED_RULES=1
  echo "[setup] iptables OUTPUT chain $CHAIN installed; allow-list:"
  printf "        - %s\n" "${AUTHORITY_IPS[@]}"
  if [[ -n "$ALLOW_EXTRA" ]]; then
    IFS=',' read -ra EXTRA_IPS <<< "$ALLOW_EXTRA"
    printf "        - %s (extra)\n" "${EXTRA_IPS[@]}"
  fi
  if [[ $ALLOW_MDNS -eq 1 ]]; then
    echo "        - 224.0.0.251:5353/udp (federation.discovery mDNS)"
  fi
fi

# --- Observation loop --------------------------------------------------------

START_TS="$(date -Is)"
START_EPOCH="$(date +%s)"
END_EPOCH=$(( START_EPOCH + DURATION_SEC ))

echo "[run] mode=$MODE duration_sec=$DURATION_SEC report=$REPORT"
echo "[run] start=$START_TS end_epoch=$END_EPOCH"
echo "[run] Authority: $AUTHORITY_URL ($AUTHORITY_HOST -> ${AUTHORITY_IPS[*]})"

# Capture egress hits to a temp file we'll summarise at the end.
EGRESS_TMP="$(mktemp)"
trap 'rm -f "$EGRESS_TMP"; cleanup' EXIT INT TERM

if [[ -n "$KERN_LOG" ]]; then
  ( tail -F -n0 "$KERN_LOG" | grep --line-buffered -F "$LOG_PREFIX" > "$EGRESS_TMP" ) &
  TAIL_PID=$!
elif [[ $USE_JOURNAL -eq 1 ]]; then
  ( journalctl -k -f --no-pager -g "$LOG_PREFIX" >> "$EGRESS_TMP" ) &
  TAIL_PID=$!
else
  TAIL_PID=""
fi

# Status pulse every 60 s so a tailing operator can see progress.
while [[ "$(date +%s)" -lt "$END_EPOCH" ]]; do
  REMAINING=$(( END_EPOCH - $(date +%s) ))
  HITS="$(wc -l < "$EGRESS_TMP" 2>/dev/null || echo 0)"
  printf "[run] t-remaining=%6ds egress_hits=%d\n" "$REMAINING" "$HITS"
  sleep 60
done

if [[ -n "${TAIL_PID:-}" ]]; then
  kill "$TAIL_PID" 2>/dev/null || true
fi

END_TS="$(date -Is)"
EGRESS_HITS="$(wc -l < "$EGRESS_TMP" 2>/dev/null || echo 0)"

# --- Report ------------------------------------------------------------------

{
  echo "# Edge Node Air-Gap Verification — $MODE mode"
  echo ""
  echo "- Run start: $START_TS"
  echo "- Run end:   $END_TS"
  echo "- Duration:  ${DURATION_SEC} s"
  echo "- Authority: $AUTHORITY_URL ($AUTHORITY_HOST)"
  echo "- Authority allow-list IPs:"
  for ip in "${AUTHORITY_IPS[@]}"; do echo "  - $ip"; done
  if [[ -n "$ALLOW_EXTRA" ]]; then
    echo "- Extra allow-list IPs: $ALLOW_EXTRA"
  fi
  if [[ $ALLOW_MDNS -eq 1 ]]; then
    echo "- federation.discovery mDNS allowed: 224.0.0.251:5353/udp"
  fi
  echo "- iptables installed: $([[ $NO_IPTABLES -eq 0 ]] && echo yes || echo no)"
  echo "- Log source: $([[ -n \"$KERN_LOG\" ]] && echo \"$KERN_LOG\" || ([[ $USE_JOURNAL -eq 1 ]] && echo journalctl -k || echo none))"
  echo ""
  echo "## Result"
  echo ""
  if [[ "$EGRESS_HITS" -eq 0 ]]; then
    echo "**PASS** — zero off-allow-list egress observed across the soak window."
  else
    echo "**FAIL** — $EGRESS_HITS off-allow-list egress packets observed."
    echo ""
    echo "Investigate the offending destinations before claiming air-gap safety:"
    echo ""
    echo '```'
    head -50 "$EGRESS_TMP"
    if [[ "$EGRESS_HITS" -gt 50 ]]; then
      echo "... ($EGRESS_HITS total; truncated to first 50 entries)"
    fi
    echo '```'
  fi
  echo ""
  echo "## Operator follow-up"
  echo ""
  echo "Fill out [edge-node-air-gapped-verification-report.md](edge-node-air-gapped-verification-report.md) with:"
  echo "- Image digests under test (from \`docker images --no-trunc\`)."
  echo "- Authority outage schedule executed during this run."
  echo "- Postgres counts before/after: \`SELECT count(*) FROM \"EdgeNode\"\` and \`SELECT count(*) FROM \"DiscoveryRun\" WHERE \"edgeNodeId\" IS NOT NULL\`."
  echo "- Edge Node logs grep for \`Sweep transient failure\` and \`Sweep buffer full\` to evidence replay / drop-oldest."
} > "$REPORT"

echo ""
echo "==================================================================="
echo "[done] report: $REPORT"
echo "[done] egress hits: $EGRESS_HITS"
echo "[done] $([[ "$EGRESS_HITS" -eq 0 ]] && echo PASS || echo FAIL)"
echo "==================================================================="

# Exit non-zero on FAIL so CI / wrappers can pick it up.
[[ "$EGRESS_HITS" -eq 0 ]]
