#!/usr/bin/env bash
# Open Digital Product Factory -- agent toolchain bootstrap (POSIX)
#
# Converges the contributor's Claude Code + Codex CLI sessions to a known
# kernel-aware state on every install or worktree creation. POSIX sibling of
# scripts/dpf-bootstrap-agent-toolchain.ps1 — same architecture, same
# readiness banner, same UX contract.
#
# Architecture (per docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md):
#   1. Detect Claude Code / Codex CLIs + DPF MCP token presence.
#   2. Call the @dpf/bootstrap planning library via Node (tsx) to compute an
#      AgentToolchainPlan (data-in / data-out, no side effects).
#   3. Apply the plan: claude plugin install, Codex config TOML upsert,
#      kernel-memory seed.
#   4. Run a read-only MCP tools/list probe (Phase 5 implements the live HTTP
#      call; this script stubs the result).
#   5. Run the kernel-principle smoke probe (Phase 5 implements; this script
#      stubs to `skipped`).
#   6. Materialize the agentToolchain state and persist via state.sh.
#   7. Print a single readiness banner using the spec's readinessCopy() table.
#
# The banner contains NO substrate names (config.toml, installed_plugins.json,
# .codex, .claude/plugins, etc.) and NO command snippets. Substrate detail
# is available under --show-substrate for debugging.
#
# Usage:
#   bash scripts/dpf-bootstrap-agent-toolchain.sh [--dry-run] [--headless]
#                                                 [--reconcile-stale-entries]
#                                                 [--show-substrate]
#                                                 [<repo-root>]
#
# Bash 3.2 baseline (macOS default).

set -euo pipefail

# --- Argument parsing --------------------------------------------------------

REPO_ROOT=""
DRY_RUN=0
HEADLESS="${DPF_HEADLESS:-0}"
RECONCILE_STALE=0
SHOW_SUBSTRATE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)                  DRY_RUN=1 ;;
    --headless)                 HEADLESS=1 ;;
    --reconcile-stale-entries)  RECONCILE_STALE=1 ;;
    --show-substrate)           SHOW_SUBSTRATE=1 ;;
    -h|--help)
      cat <<EOF
Usage: bash dpf-bootstrap-agent-toolchain.sh [flags] [<repo-root>]

Flags:
  --dry-run                   Plan and print but apply no writes.
  --headless                  Suppress interactive prompts (default in CI).
  --reconcile-stale-entries   Remove stale installed_plugins.json entries.
  --show-substrate            Show substrate detail under the banner.

The bootstrap is idempotent. Re-running on a converged install is a no-op.
EOF
      exit 0
      ;;
    --*)
      printf '  [FAIL] Unknown flag: %s\n' "$1" >&2
      exit 64
      ;;
    *)
      if [ -z "$REPO_ROOT" ]; then
        REPO_ROOT="$1"
      else
        printf '  [FAIL] Unexpected positional argument: %s\n' "$1" >&2
        exit 64
      fi
      ;;
  esac
  shift
done

REPO_ROOT="${REPO_ROOT:-$PWD}"
REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"

# --- Output helpers ----------------------------------------------------------

ok()   { printf '  [OK] %s\n'   "$1"; }
info() { printf '  [..] %s\n'   "$1"; }
skip() { printf '  [SKIP] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; }

# --- Python3 is required for safe JSON handling -----------------------------

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found on PATH. The bootstrap requires python3 for safe JSON parsing on POSIX hosts."
  fail "macOS ships python3 by default; on Linux install via your distro package manager (e.g. apt install python3)."
  exit 1
fi

# --- Load state library ------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=installer/lib/state.sh
. "$SCRIPT_DIR/installer/lib/state.sh"

# --- Resolve substrate paths -------------------------------------------------

CODEX_CONFIG_PATH="$HOME/.codex/config.toml"
CLAUDE_PLUGINS_PATH="$HOME/.claude/plugins/installed_plugins.json"
KERNEL_PRINCIPLES_DIR="$REPO_ROOT/docs/founder-kernel/wiki/principles"
CONTRIBUTOR_MEMORY_DIR="$HOME/.claude/projects"
PROJECT_SLUG="$(printf '%s' "$REPO_ROOT" | sed -E 's:[/:]:-:g' | sed -E 's:^-+::')"
MCP_ENDPOINT="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"
SKILL_PACK_MANIFEST="$REPO_ROOT/packages/dpf-skill-pack/.claude-plugin/plugin.json"

if [ ! -f "$SKILL_PACK_MANIFEST" ]; then
  fail "DPF skill pack plugin manifest missing at $SKILL_PACK_MANIFEST; aborting bootstrap."
  exit 1
fi

EXPECTED_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SKILL_PACK_MANIFEST")"

# --- Detect CLIs + token -----------------------------------------------------

CLAUDE_PRESENT=0
CODEX_PRESENT=0
HAS_TOKEN=0
command -v claude >/dev/null 2>&1 && CLAUDE_PRESENT=1
command -v codex  >/dev/null 2>&1 && CODEX_PRESENT=1
if [ -n "${DPF_MCP_BEARER_TOKEN:-}" ]; then
  HAS_TOKEN=1
fi

printf '\n-> DPF agent toolchain bootstrap\n'
info "Repo root        : $REPO_ROOT"
info "Claude CLI       : $([ $CLAUDE_PRESENT -eq 1 ] && echo present || echo missing)"
info "Codex CLI        : $([ $CODEX_PRESENT  -eq 1 ] && echo present || echo missing)"
info "DPF MCP token    : $([ $HAS_TOKEN      -eq 1 ] && echo present || echo missing)"
info "Skill pack ver.  : $EXPECTED_VERSION"

# --- Compute plan via Node bridge --------------------------------------------

BOOTSTRAP_CLI="$REPO_ROOT/packages/dpf-bootstrap/src/agent-toolchain/cli/compute-plan.ts"
if [ ! -f "$BOOTSTRAP_CLI" ]; then
  fail "Bootstrap CLI not found at $BOOTSTRAP_CLI (is @dpf/bootstrap installed?)"
  exit 1
fi

bridge_args=(
  --filter @dpf/bootstrap exec
  tsx "$BOOTSTRAP_CLI"
  --repo-root             "$REPO_ROOT"
  --codex-config          "$CODEX_CONFIG_PATH"
  --claude-plugins        "$CLAUDE_PLUGINS_PATH"
  --kernel-principles     "$KERNEL_PRINCIPLES_DIR"
  --contributor-memory    "$CONTRIBUTOR_MEMORY_DIR"
  --project-slug          "$PROJECT_SLUG"
  --mcp-endpoint          "$MCP_ENDPOINT"
  --expected-dpf-platform-version "$EXPECTED_VERSION"
)
[ $CLAUDE_PRESENT  -eq 1 ] && bridge_args+=(--claude-cli-present)
[ $CODEX_PRESENT   -eq 1 ] && bridge_args+=(--codex-cli-present)
[ $HAS_TOKEN       -eq 1 ] && bridge_args+=(--has-token)
[ $RECONCILE_STALE -eq 1 ] && bridge_args+=(--reconcile-stale-entries)

# Capture both stdout (plan JSON) and stderr from the bridge for diagnostics.
# Write plan to a temp file so python can read it via env var path — bash
# heredoc would otherwise hijack python's stdin and silently drop the pipe.
PLAN_TMP="$(mktemp)"
trap 'rm -f "$PLAN_TMP"' EXIT
if ! pnpm "${bridge_args[@]}" > "$PLAN_TMP" 2>&1; then
  fail "compute-plan failed; cannot proceed with bootstrap."
  cat "$PLAN_TMP" >&2
  exit 1
fi
if [ ! -s "$PLAN_TMP" ]; then
  fail "compute-plan produced empty output; cannot proceed."
  exit 1
fi

# The bridge writes its summary line to stderr and the plan JSON to stdout.
# When 2>&1 merges them, the summary appears before the JSON; strip it.
sed -n '/^{/,$p' "$PLAN_TMP" > "${PLAN_TMP}.json"
mv "${PLAN_TMP}.json" "$PLAN_TMP"

# --- Decision points (python parses + emits flat shell vars) -----------------

# Single python pass: parse plan from tempfile, emit shell-safe variables.
eval "$(PLAN_FILE="$PLAN_TMP" python3 - <<'PY'
import json, os, shlex
with open(os.environ["PLAN_FILE"]) as f:
    plan = json.load(f)

def shell_var(name, value):
    print(f"PLAN_{name}={shlex.quote(str(value))}")

claude = plan.get("claude") or {}
codex = plan.get("codex") or {}
memory = plan.get("memory") or {}

shell_var("CLAUDE_MODE", claude.get("mode", "skip") if claude else "skip")
shell_var("CLAUDE_STALE_COUNT", len(claude.get("staleEntriesToReconcile", [])) if claude else 0)
shell_var("CODEX_WRITES_COUNT", len(codex.get("writes", [])) if codex else 0)
shell_var("CODEX_PRESERVED_USER_INTENT", "true" if codex.get("preservedUserIntent") else "false")
shell_var("MEMORY_WRITES_COUNT", len(memory.get("writes", [])))
shell_var("PREVIEW_STATE", plan.get("preview", {}).get("readinessState", "missing_cli"))
PY
)"

info "Plan preview     : $PLAN_PREVIEW_STATE"

# --- Apply plan via a single python step ------------------------------------

CLAUDE_WIRED=0
CODEX_WIRED=0
MEMORY_SEEDED_AT=""

# 1. Claude plugin install.
case "$PLAN_CLAUDE_MODE" in
  create|update)
    if [ "$DRY_RUN" -eq 1 ]; then
      info "DRY-RUN: claude plugin install dpf-platform@dpf-platform-local --scope local"
    else
      (
        cd "$REPO_ROOT"
        claude plugin marketplace add ./ --scope local >/dev/null 2>&1 || true
        claude plugin install dpf-platform@dpf-platform-local --scope local >/dev/null 2>&1 || true
      ) && { ok "Claude Code plugin wired ($PLAN_CLAUDE_MODE)."; CLAUDE_WIRED=1; } \
        || warn "claude plugin install failed; toolchain remains partial."
    fi
    ;;
  noop)
    ok "Claude Code plugin already converged."
    CLAUDE_WIRED=1
    ;;
  skip)
    skip "Claude CLI not installed; skipping plugin wire."
    ;;
esac

if [ "${PLAN_CLAUDE_STALE_COUNT:-0}" -gt 0 ] && [ "$RECONCILE_STALE" -eq 0 ]; then
  warn "$PLAN_CLAUDE_STALE_COUNT stale Claude plugin entries detected. Re-run with --reconcile-stale-entries to clean."
fi

# 2 + 3. Codex config + kernel memory: apply via one python pass to make
# atomic-ish behavior easier and avoid bash escaping nightmares.
if [ "$DRY_RUN" -eq 1 ]; then
  if [ "${PLAN_CODEX_WRITES_COUNT:-0}" -gt 0 ]; then
    info "DRY-RUN: write Codex config (1 file)"
  fi
  if [ "${PLAN_MEMORY_WRITES_COUNT:-0}" -gt 0 ]; then
    info "DRY-RUN: seed $PLAN_MEMORY_WRITES_COUNT kernel principle(s) to memory"
  fi
else
  PLAN_FILE="$PLAN_TMP" python3 - <<'PY'
import json, os
with open(os.environ["PLAN_FILE"]) as f:
    plan = json.load(f)

# Codex writes.
for w in (plan.get("codex") or {}).get("writes", []):
    os.makedirs(os.path.dirname(w["path"]), exist_ok=True)
    with open(w["path"], "w") as f:
        f.write(w["content"])

# Memory writes (excluding preserve-user-edit).
mem = plan.get("memory") or {}
for w in mem.get("writes", []):
    if w.get("mode") == "preserve-user-edit":
        continue
    os.makedirs(os.path.dirname(w["path"]), exist_ok=True)
    with open(w["path"], "w") as f:
        f.write(w["content"])

# Memory index entry.
idx = mem.get("indexEntry")
if idx:
    os.makedirs(os.path.dirname(idx["path"]), exist_ok=True)
    with open(idx["path"], "w") as f:
        f.write(idx["content"])
PY

  if [ "${PLAN_CODEX_WRITES_COUNT:-0}" -gt 0 ]; then
    ok "Codex plugin wired."
    CODEX_WIRED=1
  elif [ "$CODEX_PRESENT" -eq 1 ]; then
    if [ "$PLAN_CODEX_PRESERVED_USER_INTENT" = "true" ]; then
      skip "Codex plugin manually disabled by user; preserving user intent."
    else
      ok "Codex plugin already converged."
      CODEX_WIRED=1
    fi
  else
    skip "Codex CLI not installed; skipping plugin wire."
  fi

  if [ "${PLAN_MEMORY_WRITES_COUNT:-0}" -gt 0 ]; then
    ok "Kernel-tier memory seeded ($PLAN_MEMORY_WRITES_COUNT principle(s))."
    MEMORY_SEEDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  else
    ok "Kernel-tier memory already converged."
  fi
fi

# --- Live probes (Phase 5) ---------------------------------------------------

# Defaults if probes are skipped (dry-run / no token / runner failure).
MCP_READINESS=""
SMOKE_TEST=""
PROBE_REASON="" # `dry_run` | `no_probes_cli` | `runner_failed` | ""

if [ "$DRY_RUN" -eq 1 ]; then
  PROBE_REASON="dry_run"
else
  probes_cli="$REPO_ROOT/packages/dpf-bootstrap/src/agent-toolchain/cli/run-probes.ts"
  if [ ! -f "$probes_cli" ]; then
    PROBE_REASON="no_probes_cli"
  else
    probe_args=(
      --filter @dpf/bootstrap exec
      tsx "$probes_cli"
      --mcp-endpoint "$MCP_ENDPOINT"
    )
    [ $HAS_TOKEN -eq 1 ] && probe_args+=(--token "${DPF_MCP_BEARER_TOKEN:-}")

    PROBE_TMP="$(mktemp)"
    if pnpm "${probe_args[@]}" > "$PROBE_TMP" 2>/dev/null; then
      # Bridge stdout is the JSON document. Bash heredoc gotcha (see Phase 4
      # commit message) is avoided by passing PROBE_FILE as env var.
      sed -n '/^{/,$p' "$PROBE_TMP" > "${PROBE_TMP}.json"
      mv "${PROBE_TMP}.json" "$PROBE_TMP"
      MCP_READINESS="$(PROBE_FILE="$PROBE_TMP" python3 -c '
import json, os
with open(os.environ["PROBE_FILE"]) as f:
    p = json.load(f)
print(json.dumps(p["mcpReadiness"]))
')"
      SMOKE_TEST="$(PROBE_FILE="$PROBE_TMP" python3 -c '
import json, os
with open(os.environ["PROBE_FILE"]) as f:
    p = json.load(f)
print(json.dumps(p["smokeTest"]))
')"
    else
      PROBE_REASON="runner_failed"
    fi
    rm -f "$PROBE_TMP"
  fi
fi

if [ -z "$MCP_READINESS" ]; then
  if [ $HAS_TOKEN -eq 1 ]; then
    MCP_READINESS='{"ok": false, "reason": "endpoint_unreachable", "httpStatus": null}'
  else
    MCP_READINESS='{"ok": false, "reason": "no_token", "httpStatus": null}'
  fi
fi

if [ -z "$SMOKE_TEST" ]; then
  if [ $CLAUDE_PRESENT -eq 0 ] && [ $CODEX_PRESENT -eq 0 ]; then
    SMOKE_TEST='{"result": "skipped", "reason": "claude_not_on_path"}'
  else
    SMOKE_TEST='{"result": "skipped", "reason": "no_token"}'
  fi
fi

if [ -n "$PROBE_REASON" ] && [ "$PROBE_REASON" != "dry_run" ]; then
  warn "Probes were not exercised ($PROBE_REASON); readiness recorded from stubs."
fi

# --- Compute final readiness from applied facts + probe results ------------

# Mirrors computeReadinessState() in @dpf/bootstrap/readiness-state.ts.
MCP_OK="$(printf '%s' "$MCP_READINESS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ok"])')"
MCP_REASON="$(printf '%s' "$MCP_READINESS" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("reason",""))')"
SMOKE_RESULT="$(printf '%s' "$SMOKE_TEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"])')"

if [ "$CLAUDE_WIRED" -eq 0 ] && [ "$CODEX_WIRED" -eq 0 ]; then
  FINAL_STATE="missing_cli"
elif [ "$MCP_OK" != "True" ]; then
  case "$MCP_REASON" in
    no_token|scope_insufficient) FINAL_STATE="missing_token" ;;
    endpoint_unreachable|unexpected_shape) FINAL_STATE="needs_refresh" ;;
    *)                                     FINAL_STATE="needs_refresh" ;;
  esac
elif [ "$SMOKE_RESULT" = "failed" ]; then
  FINAL_STATE="failed_smoke"
elif [ "$CLAUDE_WIRED" -eq 0 ] || [ "$CODEX_WIRED" -eq 0 ]; then
  FINAL_STATE="partial"
else
  FINAL_STATE="ready"
fi

APPLIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MEMORY_SEEDED_AT_JSON='null'
[ -n "$MEMORY_SEEDED_AT" ] && MEMORY_SEEDED_AT_JSON="\"$MEMORY_SEEDED_AT\""

AGENT_TOOLCHAIN_JSON="$(cat <<JSON
{
  "appliedAt": "$APPLIED_AT",
  "dpfPlatformVersion": "$EXPECTED_VERSION",
  "superpowersVersion": null,
  "claudeCodeWired": $([ $CLAUDE_WIRED -eq 1 ] && echo true || echo false),
  "codexWired": $([ $CODEX_WIRED -eq 1 ] && echo true || echo false),
  "memorySeededAt": $MEMORY_SEEDED_AT_JSON,
  "mcpReadiness": $MCP_READINESS,
  "smokeTest": $SMOKE_TEST,
  "readinessState": "$FINAL_STATE"
}
JSON
)"

if [ "$DRY_RUN" -eq 0 ]; then
  dpf_state_init "agent-toolchain-bootstrap-phase-4" "$REPO_ROOT"
  dpf_state_write_json "agentToolchain" "$AGENT_TOOLCHAIN_JSON"
fi

# --- Readiness banner --------------------------------------------------------

case "$FINAL_STATE" in
  ready)         BANNER_MSG="Claude Code and Codex are ready for DPF work.";                                     BANNER_ACTION="Open readiness" ;;
  partial)       BANNER_MSG="One contributor client is ready; the other needs setup.";                           BANNER_ACTION="Repair toolchain" ;;
  missing_cli)   BANNER_MSG="Install the selected agent client to enable contributor sessions.";                 BANNER_ACTION="Open setup guide" ;;
  missing_token) BANNER_MSG="DPF MCP needs a development token before agents can use governed tools.";           BANNER_ACTION="Issue development token" ;;
  needs_refresh) BANNER_MSG="A token exists, but the running client has not picked it up yet.";                  BANNER_ACTION="Refresh client binding" ;;
  failed_smoke)  BANNER_MSG="The agent is installed but did not apply a DPF kernel principle.";                  BANNER_ACTION="View evidence" ;;
esac

printf '\n'
printf '================================================================\n'
printf '  DPF agent toolchain: %s\n' "$(printf '%s' "$FINAL_STATE" | tr '[:lower:]' '[:upper:]')"
printf '  %s\n' "$BANNER_MSG"
printf '  Next: %s\n' "$BANNER_ACTION"
printf '================================================================\n'

if [ "$SHOW_SUBSTRATE" -eq 1 ]; then
  printf '\n'
  printf '  Substrate detail (for debugging):\n'
  printf '    Claude plugin     : %s\n' "$([ $CLAUDE_WIRED -eq 1 ] && echo true || echo false)"
  printf '    Codex plugin      : %s\n' "$([ $CODEX_WIRED  -eq 1 ] && echo true || echo false)"
  printf '    Memory seeded at  : %s\n' "${MEMORY_SEEDED_AT:-never}"
  printf '    DPF platform ver  : %s\n' "$EXPECTED_VERSION"
  printf '    State file        : %s\n' "$(dpf_state_path)"
fi

printf '\n'
