#!/bin/sh
# scripts/hooks/mcp-health.sh
#
# SessionStart dpf-MCP reachability advisory (POSIX). Counterpart of mcp-health.ps1.
#
# Why: the `dpf` MCP server is a remote HTTP transport. When its backing portal
# container restarts mid-session (a self-upgrade does exactly this), Claude Code
# retries the dropped HTTP connection a few times with backoff and then marks the
# server FAILED. From that point every mcp__dpf__* tool silently vanishes from the
# session for the rest of its life, and the model cannot reconnect it -- reconnect
# is a user/harness operation (`/mcp` -> dpf -> reconnect, or restart the client).
# The failure is easy to misread as "server down" when the endpoint is in fact
# healthy. This hook probes the real endpoint at session start and turns a SILENT
# strand into a LOUD, correctly-triaged advisory, so the reader knows whether the
# problem is the server, the token, or a client-side reconnect.
#
# NOTE ON SCOPE: this hook probes the ENDPOINT (server reachability); it cannot see
# Claude Code's own MCP client state, so it cannot itself confirm that mcp__dpf__*
# tools are attached this turn. Its job is disambiguation + the reconnect recipe.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Advisory only. Exit 0 ALWAYS -- a health probe must never block a session from
# starting. Advisory text is printed to stdout, which Claude Code adds to session
# context. Bounded 4s probe so it can never hang startup. Never prints the token.
# Set DPF_SKIP_MCP_HEALTH=1 to silence. Plain ASCII.

set -u

[ "${DPF_SKIP_MCP_HEALTH:-0}" = "1" ] && exit 0

# curl is the probe transport; without it, stay silent rather than guess.
command -v curl >/dev/null 2>&1 || exit 0

# Repo root: prefer Claude Code's per-invocation env var; fall back to this
# file's location (scripts/hooks/mcp-health.sh -> repo root is two dirs up).
root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." 2>/dev/null && pwd)"
fi

# Probe URL: read the dpf server url from .mcp.json when present so the probe
# tracks the real client config; otherwise use the known local bind. No JSON
# parser dependency -- take the first "url" string in the file (.mcp.json holds
# only the dpf server here).
url="http://127.0.0.1:3000/api/mcp/v1"
cfg="${root:-.}/.mcp.json"
if [ -f "$cfg" ]; then
  u="$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" 2>/dev/null | head -n 1)"
  [ -n "$u" ] && url="$u"
fi

runbook="docs/architecture/mcp-tool-authorization-runbook.md"

# A "localhost" url is a latent failure on hosts where localhost resolves to ::1
# and IPv6 is not answering; 127.0.0.1 is the safe literal.
case "$url" in
  *localhost*)
    printf '%s\n' "NOTE: DPF MCP -- .mcp.json points dpf at '$url'. If localhost resolves to ::1 and IPv6 is not answering, the client cannot connect; use the 127.0.0.1 literal instead."
    ;;
esac

# BI-46B636B0: the client authorizes over OAuth only on https, and a pinned
# Authorization header disables OAuth. So on a plain-http endpoint the
# ${DPF_MCP_BEARER_TOKEN} header reference in .mcp.json is the ONLY credential
# path, and on https it must be absent. Diagnose the config at session start
# instead of at the first refused tool call.
has_header=0
if [ -f "$cfg" ] && grep -q '"Authorization"' "$cfg" 2>/dev/null; then has_header=1; fi
case "$url" in
  https://*)
    if [ "$has_header" = "1" ]; then
      printf '%s\n' "NOTE: DPF MCP -- .mcp.json pins headers.Authorization on an https endpoint; that disables the client's OAuth fallback. Re-run the toolchain bootstrap (it omits the header for https) or remove it by hand. Runbook: $runbook."
    fi
    ;;
  *)
    if [ "$has_header" != "1" ]; then
      printf '%s\n' "WARNING: DPF MCP -- .mcp.json points dpf at plain-http '$url' with NO headers.Authorization. The client refuses OAuth over http, so this config cannot authenticate by ANY path (BI-46B636B0). Fix: re-run the toolchain bootstrap (scripts/dpf-bootstrap-agent-toolchain.sh) to restore the \${DPF_MCP_BEARER_TOKEN} header fallback, or serve the portal over https (docker-compose.tls.yml) and point .mcp.json at it. Runbook: $runbook."
    fi
    ;;
esac

# BI-FA2C46D7: on https the client authorizes itself over OAuth, so no token is
# expected here. Probe anonymously with the organization root bundle and read
# the challenge: a 401 that names resource_metadata is the healthy answer.
cacert_args=""
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "${NODE_EXTRA_CA_CERTS}" ]; then
  cacert_args="--cacert ${NODE_EXTRA_CA_CERTS}"
fi
case "$url" in
  https://*)
    if [ -z "${DPF_MCP_BEARER_TOKEN:-}" ] || [ "$has_header" != "1" ]; then
      # shellcheck disable=SC2086 # cacert_args is a single option pair.
      challenge="$(curl -s -o /dev/null -D - --max-time 4 $cacert_args -X POST "$url" \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null | tr -d '\r')"
      case "$challenge" in
        *"HTTP/"*" 401"*resource_metadata*)
          printf '%s\n' "OK: dpf MCP endpoint reachable over https at $url; it advertises OAuth (resource_metadata in the challenge) and the client authorizes itself -- no bearer token is needed or expected."
          ;;
        *"HTTP/"*)
          printf '%s\n' "WARNING: dpf MCP endpoint at $url answered without an OAuth challenge (resource_metadata missing). The client cannot authorize over OAuth against it. Runbook: $runbook."
          ;;
        *)
          if [ -z "$cacert_args" ]; then
            printf '%s\n' "WARNING: dpf MCP endpoint at $url did not answer. On https the client must trust the organization root: NODE_EXTRA_CA_CERTS is not set in this environment. Re-run the toolchain bootstrap (it persists the bundle), then restart the client. Runbook: $runbook."
          else
            printf '%s\n' "WARNING: dpf MCP endpoint at $url did not answer (TLS front not running, or the certificate is not issued by the trusted root at $NODE_EXTRA_CA_CERTS). Runbook: $runbook."
          fi
          ;;
      esac
      exit 0
    fi
    ;;
esac

if [ -z "${DPF_MCP_BEARER_TOKEN:-}" ]; then
  printf '%s\n' "NOTE: DPF MCP -- DPF_MCP_BEARER_TOKEN is not set in this environment; the dpf server cannot authenticate. Set the user env var, then restart the client. Runbook: $runbook (Token rotation). Silence: DPF_SKIP_MCP_HEALTH=1."
  exit 0
fi

# shellcheck disable=SC2086 # cacert_args is a single option pair.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 $cacert_args -X POST "$url" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null || echo 000)"

case "$code" in
  200)
    printf '%s\n' "OK: dpf MCP endpoint reachable and authenticating (HTTP 200) at $url."
    printf '%s\n' "  If mcp__dpf__* tools are ABSENT this session, the server is healthy -- this is a CLIENT-side dropped connection (common trigger: the portal self-upgraded and restarted). The model cannot reconnect it; in an interactive client run '/mcp' -> select dpf -> reconnect (or '/mcp reconnect dpf'), else restart the client. Runbook: $runbook. Silence: DPF_SKIP_MCP_HEALTH=1."
    ;;
  401 | 403)
    printf '%s\n' "WARNING: dpf MCP endpoint at $url returned HTTP $code (auth rejected). The bearer token is absent/invalid/expired -- rotate or reseed it (never print it). Runbook: $runbook (Token rotation)."
    ;;
  000)
    printf '%s\n' "WARNING: dpf MCP endpoint at $url is UNREACHABLE (no HTTP response within 4s). The portal/runtime is down or mid-restart (a self-upgrade restarts the container). Check runtime health; once it answers, reconnect with '/mcp' or restart the client. Runbook: $runbook (Diagnosis order)."
    ;;
  *)
    printf '%s\n' "WARNING: dpf MCP endpoint at $url returned HTTP $code (unexpected). Check runtime health. Runbook: $runbook (Diagnosis order)."
    ;;
esac

exit 0
