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
# Auto-mint: when no DPF_MCP_BEARER_TOKEN is present, issue one against the local
# portal and persist it durably (POSIX). On by default for the contributor
# bootstrap; pass --no-auto-mint for CI / non-contributor paths.
AUTO_MINT="${DPF_AUTO_MINT:-1}"
# Scope of the auto-minted token. `write` gives an external coding agent all the
# side-effecting MCP tools (backlog, evidence, Build Studio handoff) without the
# token-issuance powers of `admin`. Override with --mint-scope admin|read.
MINT_SCOPE="${DPF_MINT_SCOPE:-write}"
# Opt-in install of Google Antigravity's `agy` CLI. OFF by default: it runs a
# vendor install script, so we never do it silently (kernel DI-B91843F8C157,
# least-privilege deny-by-default). Enable with --install-antigravity.
INSTALL_ANTIGRAVITY="${DPF_INSTALL_ANTIGRAVITY:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)                  DRY_RUN=1 ;;
    --headless)                 HEADLESS=1 ;;
    --reconcile-stale-entries)  RECONCILE_STALE=1 ;;
    --install-antigravity)      INSTALL_ANTIGRAVITY=1 ;;
    --show-substrate)           SHOW_SUBSTRATE=1 ;;
    --auto-mint)                AUTO_MINT=1 ;;
    --no-auto-mint)             AUTO_MINT=0 ;;
    --mint-scope)
      if [ -z "${2:-}" ]; then printf '  [FAIL] --mint-scope requires a value\n' >&2; exit 64; fi
      MINT_SCOPE="$2"; shift
      ;;
    -h|--help)
      cat <<EOF
Usage: bash dpf-bootstrap-agent-toolchain.sh [flags] [<repo-root>]

Flags:
  --dry-run                   Plan and print but apply no writes.
  --headless                  Suppress interactive prompts (default in CI).
  --reconcile-stale-entries   Remove stale installed_plugins.json entries.
  --install-antigravity       Opt-in: run the official installer for Google
                              Antigravity's 'agy' CLI if it is not present,
                              then wire the DPF MCP config.
  --show-substrate            Show substrate detail under the banner.
  --auto-mint                 Issue + persist an MCP token if none is present (default).
  --no-auto-mint              Never issue a token; only wire what a present token allows.
  --mint-scope <read|write|admin>  Scope for the auto-minted token (default: write).

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

# --- Worktree core seeding ---------------------------------------------------
#
# AGENTS.md documents this unified bootstrap as the one command that prepares a
# linked worktree: MCP config, worktree-scoped COMPOSE_PROJECT_NAME, and
# .dpf-worktree-readiness.json. The legacy seed script remains the single owner
# of that file-writing/classification logic; bootstrap invokes it in core-only
# mode to avoid the old ensure-dpf-skill-pack -> bootstrap recursion.

is_linked_worktree() {
  git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  _common="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  _main="$(cd "$(dirname "$_common")" && pwd -P)"
  [ "$_main" != "$REPO_ROOT" ]
}

seed_worktree_core() {
  _phase="$1"
  [ "$DRY_RUN" -eq 1 ] && { info "DRY-RUN: would refresh worktree MCP config, Compose isolation, and readiness marker ($_phase)."; return 0; }
  [ -f "$SCRIPT_DIR/seed-worktree-mcp.sh" ] || return 0
  if is_linked_worktree; then
    if bash "$SCRIPT_DIR/seed-worktree-mcp.sh" "$REPO_ROOT" --core-only >/dev/null; then
      ok "Worktree core seeded ($_phase): MCP config, Compose isolation, readiness marker."
    else
      warn "Worktree core seed failed ($_phase); continuing with toolchain bootstrap."
    fi
  fi
}

seed_worktree_core "pre-toolchain"

# Some contributor surfaces launch this script with pnpm available through a
# bundled runtime while `node` itself is absent from PATH. pnpm can start, but
# dependency lifecycle scripts (`node install/check.js`, etc.) then fail. If a
# known bundled Node runtime exists, expose its bin directory to child processes.
if ! command -v node >/dev/null 2>&1; then
  for _node_dir in \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin" \
    "$HOME/.local/share/codex/node/bin" \
    "$HOME/.codex/node/bin"; do
    if [ -x "$_node_dir/node" ]; then
      export PATH="$_node_dir:$PATH"
      ok "Node runtime added to PATH for bootstrap child processes."
      break
    fi
  done
fi

# --- Resolve substrate paths -------------------------------------------------

CODEX_CONFIG_PATH="$HOME/.codex/config.toml"
CLAUDE_PLUGINS_PATH="$HOME/.claude/plugins/installed_plugins.json"
GROK_CONFIG_PATH="$HOME/.grok/config.toml"
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

# Detection must not be PATH-only: on macOS the Codex CLI ships inside
# /Applications/Codex.app and Claude Code is often installed at ~/.claude/local
# or launched as a GUI app — none of which are on a non-interactive shell PATH.
# Reporting `missing_cli` for a machine that has both clients is the bug this
# function set fixes. We resolve the binary path (used by `claude plugin
# install`) and treat a resolvable client as present.

resolve_claude_bin() {
  if command -v claude >/dev/null 2>&1; then command -v claude; return 0; fi
  for c in \
    "$HOME/.claude/local/claude" \
    "/opt/homebrew/bin/claude" \
    "/usr/local/bin/claude" \
    "$HOME/.local/bin/claude"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

resolve_codex_bin() {
  if command -v codex >/dev/null 2>&1; then command -v codex; return 0; fi
  for c in \
    "/Applications/Codex.app/Contents/Resources/codex" \
    "$HOME/.codex/bin/codex" \
    "/opt/homebrew/bin/codex" \
    "/usr/local/bin/codex" \
    "$HOME/.local/bin/codex"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

resolve_grok_bin() {
  if command -v grok >/dev/null 2>&1; then command -v grok; return 0; fi
  for c in \
    "$HOME/.grok/bin/grok" \
    "/opt/homebrew/bin/grok" \
    "/usr/local/bin/grok" \
    "$HOME/.local/bin/grok"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

resolve_agy_bin() {
  if command -v agy >/dev/null 2>&1; then command -v agy; return 0; fi
  for c in \
    "$HOME/.local/bin/agy" \
    "/opt/homebrew/bin/agy" \
    "/usr/local/bin/agy"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

# Opt-in install of `agy` (Google Antigravity). Runs the OFFICIAL vendor
# installer only when the operator passed --install-antigravity and the binary
# is absent. Never silent. The install command is the documented one; the CLI is
# a standalone Go binary (no npm).
maybe_install_agy() {
  [ "$INSTALL_ANTIGRAVITY" -eq 1 ] || return 0
  resolve_agy_bin >/dev/null 2>&1 && return 0
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Antigravity CLI  : would run the official agy installer (--dry-run)"
    return 0
  fi
  info "Antigravity CLI  : not found; running the official installer (opt-in)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://antigravity.google/cli/install.sh | bash || warn "agy install failed; install manually per docs/operations/antigravity-cli-onboarding.md"
  else
    warn "curl not found; install agy manually per docs/operations/antigravity-cli-onboarding.md"
  fi
}

CLAUDE_PRESENT=0
CODEX_PRESENT=0
GROK_PRESENT=0
AGY_PRESENT=0
HAS_TOKEN=0
maybe_install_agy
CLAUDE_BIN="$(resolve_claude_bin || true)"
CODEX_BIN="$(resolve_codex_bin || true)"
GROK_BIN="$(resolve_grok_bin || true)"
AGY_BIN="$(resolve_agy_bin || true)"
[ -n "$CLAUDE_BIN" ] && CLAUDE_PRESENT=1
# Codex wiring is file-based (config.toml), so a present-but-not-on-PATH Codex
# (or an existing Codex config dir) is still wirable.
{ [ -n "$CODEX_BIN" ] || [ -f "$CODEX_CONFIG_PATH" ]; } && CODEX_PRESENT=1
[ -n "$GROK_BIN" ] && GROK_PRESENT=1
[ -n "$AGY_BIN" ] && AGY_PRESENT=1
if [ -n "${DPF_MCP_BEARER_TOKEN:-}" ]; then
  HAS_TOKEN=1
fi

printf '\n-> DPF agent toolchain bootstrap\n'
info "Repo root        : $REPO_ROOT"
info "Claude CLI       : $([ $CLAUDE_PRESENT -eq 1 ] && echo present || echo missing)"
info "Codex CLI        : $([ $CODEX_PRESENT  -eq 1 ] && echo present || echo missing)"
info "Grok CLI         : $([ $GROK_PRESENT    -eq 1 ] && echo present || echo missing)"
info "Antigravity CLI  : $([ $AGY_PRESENT     -eq 1 ] && echo present || echo missing)"
# Note: Host OS (this script is POSIX/mac/Linux) vs Windows PowerShell sibling only affects
# local detection paths and config.toml location for direct `grok` CLI usage.
# Build Studio Grok dispatch (grok-dispatch.ts) is containerized Linux execution and is identical.
info "DPF MCP token    : $([ $HAS_TOKEN      -eq 1 ] && echo present || echo missing)"
info "Skill pack ver.  : $EXPECTED_VERSION"

# --- Auto-mint + persist MCP token (POSIX) -----------------------------------
#
# The env-backed client config (.mcp.json, [mcp_servers.dpf]) references
# ${DPF_MCP_BEARER_TOKEN}; without a durably-persisted token the clients cannot
# call /api/mcp/v1. mcp-setup-snippets.ts only emitted a Windows persistence
# line, so macOS/Linux installs were left with no token at all. We mint one
# against the local portal (headless DB issuance via issue-mcp-token.ts) and
# persist it so a new shell, terminal-launched Claude Code, and GUI-launched
# apps all pick it up. The plaintext is NEVER written to install-state or logs.

# POSIX single-quote escaping via bash parameter expansion (no sed gymnastics):
# each ' becomes '\'' so the value is safe inside a single-quoted shell string.
mcp_token_envfile="$HOME/.dpf/agent-toolchain.env"

persist_mcp_token_posix() {
  _tok="$1"
  _esc=${_tok//\'/\'\\\'\'}
  mkdir -p "$HOME/.dpf"
  ( umask 077; printf '# DPF MCP bearer token — managed by dpf-bootstrap-agent-toolchain.sh\nexport DPF_MCP_BEARER_TOKEN='\''%s'\''\n' "$_esc" > "$mcp_token_envfile" )
  chmod 600 "$mcp_token_envfile" 2>/dev/null || true
  # Source the env file from login + non-login shells (idempotent managed line).
  _src_line=". \"$mcp_token_envfile\"  # dpf-mcp-token"
  for _prof in "$HOME/.zshenv" "$HOME/.profile"; do
    if [ -f "$_prof" ] && grep -q 'dpf-mcp-token' "$_prof" 2>/dev/null; then
      continue
    fi
    printf '%s\n' "$_src_line" >> "$_prof"
  done
  # GUI-launched apps (e.g. Codex.app) are not started from a shell, so they do
  # not read the profile. launchctl setenv injects the var for the current boot.
  # (Reboot persistence for GUI apps is a follow-up; terminal clients are durable.)
  if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    launchctl setenv DPF_MCP_BEARER_TOKEN "$_tok" 2>/dev/null || true
  fi
}

# The token is minted INSIDE the portal container, not on the host: on a
# dockerized install the host cannot reach the DB (postgres has no published
# port; DATABASE_URL uses the compose-internal `postgres` host) and consumer
# installs may not have host Node/pnpm. This mirrors the proven Edge Node
# bootstrap path in setup.sh / fresh-install.ps1. The plaintext token crosses
# back to the host only for durable persistence; it is never logged.
resolve_portal_container() {
  _c="$(docker compose -f "$REPO_ROOT/docker-compose.yml" ps -q portal 2>/dev/null | head -1)"
  if [ -n "$_c" ]; then printf '%s\n' "$_c"; return 0; fi
  _c="$(docker ps --filter 'name=portal' --filter 'status=running' --format '{{.Names}}' 2>/dev/null | grep -E 'portal' | head -1)"
  if [ -n "$_c" ]; then printf '%s\n' "$_c"; return 0; fi
  printf 'dpf-portal-1\n'
}

# --- Reconcile an under-provisioned token (BI-A3DE9A31) ----------------------
#
# "token present" != "token sufficient". A token minted before the
# write->development-template fix carries a narrow legacy scope set MISSING
# `registry_read`, so registry-gated tools (e.g. principle_decide / WWMD)
# refuse. Probe a registry_read-gated, read-only, no-arg tool; on an
# UNAMBIGUOUS scope failure naming registry_read, force a re-mint by clearing
# HAS_TOKEN so the mint+persist block below issues a full development token.
# Fail safe: leave the token untouched on unreachable/ambiguous responses.
# Markers mirror interpretScopeCoverageProbe in @dpf/bootstrap (SSOT).
if [ "$HAS_TOKEN" -eq 1 ] && [ "$AUTO_MINT" -eq 1 ] && [ "$DRY_RUN" -eq 0 ] \
   && command -v curl >/dev/null 2>&1; then
  _scope_probe="$(curl -s --max-time 5 -X POST "$MCP_ENDPOINT" \
    -H "Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_my_coworker_profile","arguments":{}}}' \
    2>/dev/null)"
  if printf '%s' "$_scope_probe" | grep -q 'lacks the required scope' \
     && printf '%s' "$_scope_probe" | grep -q 'registry_read'; then
    warn "Present MCP token is under-provisioned (missing registry_read); re-minting with the full development template."
    HAS_TOKEN=0
  fi
fi

if [ "$HAS_TOKEN" -eq 0 ] && [ "$AUTO_MINT" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    info "DRY-RUN: would mint a '$MINT_SCOPE'-scoped MCP token (in portal container) and persist it (POSIX)."
  elif ! command -v docker >/dev/null 2>&1; then
    warn "docker not found; cannot mint an MCP token. Continuing without one."
  else
    PORTAL_CONTAINER="$(resolve_portal_container)"
    info "No MCP token found; minting a '$MINT_SCOPE'-scoped token via portal container ($PORTAL_CONTAINER)."
    MINT_ERR="$(mktemp)"
    # Run the shipped issuer inside the container (matches the just-migrated
    # Prisma schema; reaches postgres over the compose network).
    if MINT_OUT="$(docker exec "$PORTAL_CONTAINER" sh -c \
          "cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-mcp-token.ts --scope '$MINT_SCOPE' --format raw" \
          2>"$MINT_ERR")"; then
      MINT_TOKEN="$(printf '%s\n' "$MINT_OUT" | grep -E '^dpfmcp_' | tail -n 1)"
      if [ -n "$MINT_TOKEN" ]; then
        persist_mcp_token_posix "$MINT_TOKEN"
        export DPF_MCP_BEARER_TOKEN="$MINT_TOKEN"
        HAS_TOKEN=1
        ok "MCP token issued and persisted (${MINT_TOKEN%%_*}_… , scope=$MINT_SCOPE)."
      else
        warn "Token issuance produced no token; continuing without one. See diagnostics below."
        sed -n '1,20p' "$MINT_ERR" >&2 || true
      fi
    else
      warn "Token issuance failed (is the portal container running?); continuing without a token."
      sed -n '1,20p' "$MINT_ERR" >&2 || true
    fi
    rm -f "$MINT_ERR"
  fi
fi

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
  --grok-config           "$GROK_CONFIG_PATH"
  --kernel-principles     "$KERNEL_PRINCIPLES_DIR"
  --contributor-memory    "$CONTRIBUTOR_MEMORY_DIR"
  --project-slug          "$PROJECT_SLUG"
  --mcp-endpoint          "$MCP_ENDPOINT"
  --expected-dpf-platform-version "$EXPECTED_VERSION"
)
[ $CLAUDE_PRESENT  -eq 1 ] && bridge_args+=(--claude-cli-present)
[ $CODEX_PRESENT   -eq 1 ] && bridge_args+=(--codex-cli-present)
[ $GROK_PRESENT    -eq 1 ] && bridge_args+=(--grok-cli-present)
[ $AGY_PRESENT     -eq 1 ] && bridge_args+=(--antigravity-cli-present)
[ $HAS_TOKEN       -eq 1 ] && bridge_args+=(--has-token)
[ $RECONCILE_STALE -eq 1 ] && bridge_args+=(--reconcile-stale-entries)

# Capture both stdout (plan JSON) and stderr from the bridge for diagnostics.
# Write plan to a temp file so python can read it via env var path — bash
# heredoc would otherwise hijack python's stdin and silently drop the pipe.
PLAN_TMP="$(mktemp)"
trap 'rm -f "$PLAN_TMP"' EXIT
if ! pnpm "${bridge_args[@]}" > "$PLAN_TMP" 2>&1; then
  warn "compute-plan failed; using standalone skill-pack updater fallback."
  cat "$PLAN_TMP" >&2
  FALLBACK="$REPO_ROOT/packages/dpf-skill-pack/scripts/update-agent-toolchain.sh"
  if [ -f "$FALLBACK" ]; then
    fallback_args=(--mcp-url "$MCP_ENDPOINT")
    [ "$DRY_RUN" -eq 1 ] && fallback_args+=(--dry-run)
    if bash "$FALLBACK" "${fallback_args[@]}"; then
      seed_worktree_core "post-fallback"
      exit 0
    fi
    fail "Standalone updater failed."
    exit 1
  fi
  fail "Standalone updater missing at $FALLBACK; cannot proceed."
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
with open(os.environ["PLAN_FILE"], encoding="utf-8") as f:
    plan = json.load(f)

def shell_var(name, value):
    print(f"PLAN_{name}={shlex.quote(str(value))}")

claude = plan.get("claude") or {}
codex = plan.get("codex") or {}
grok = plan.get("grok") or {}
memory = plan.get("memory") or {}
mcp_client = plan.get("mcpClientConfig") or {}

shell_var("CLAUDE_MODE", claude.get("mode", "skip") if claude else "skip")
shell_var("CLAUDE_STALE_COUNT", len(claude.get("staleEntriesToReconcile", [])) if claude else 0)
shell_var("CODEX_WRITES_COUNT", len(codex.get("writes", [])) if codex else 0)
shell_var("CODEX_PRESERVED_USER_INTENT", "true" if codex.get("preservedUserIntent") else "false")
# DPF-scoping convergence (generic-client disable + worktree trust), rendered
# one change per line for the readiness banner (spec S4.5). Newline-joined so a
# single shell var carries the whole list; the printf loop below splits on it.
_conv_kind = {
    "plugin-disabled": "disabled generic plugin",
    "mcp-server-disabled": "disabled generic MCP server",
    "project-trusted": "trusted worktree path",
}
_conv_lines = [
    f"Codex: {_conv_kind.get(c.get('kind'), c.get('kind'))} '{c.get('key')}'."
    for c in (codex.get("convergence", []) if codex else [])
]
shell_var("CODEX_CONVERGENCE_COUNT", len(_conv_lines))
shell_var("CODEX_CONVERGENCE", "\n".join(_conv_lines))
shell_var("GROK_WRITES_COUNT", len((grok.get("config") or {}).get("writes", [])) if grok else 0)
shell_var("MCP_CLIENT_WRITES_COUNT", len(mcp_client.get("writes", [])))
shell_var("MEMORY_WRITES_COUNT", len(memory.get("writes", [])))
shell_var("PREVIEW_STATE", plan.get("preview", {}).get("readinessState", "missing_cli"))
shell_var("UPSTREAM_DRIFT_ADVISORY", (plan.get("upstreamDrift") or {}).get("advisory") or "")
PY
)"

info "Plan preview     : $PLAN_PREVIEW_STATE"

# --- Apply plan via a single python step ------------------------------------

CLAUDE_WIRED=0
CODEX_WIRED=0
GROK_WIRED=0
AGY_WIRED=0
MEMORY_SEEDED_AT=""

# 1. Claude plugin install.
case "$PLAN_CLAUDE_MODE" in
  create|update)
    if [ "$DRY_RUN" -eq 1 ]; then
      info "DRY-RUN: claude plugin install dpf-platform@dpf-platform-local --scope project"
    else
      (
        cd "$REPO_ROOT"
        "$CLAUDE_BIN" plugin marketplace add ./ --scope local >/dev/null 2>&1 || true
        "$CLAUDE_BIN" plugin install dpf-platform@dpf-platform-local --scope project >/dev/null 2>&1 || true
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
    if [ "${PLAN_CODEX_CONVERGENCE_COUNT:-0}" -gt 0 ] && [ -n "${PLAN_CODEX_CONVERGENCE:-}" ]; then
      while IFS= read -r _conv_line; do
        [ -n "$_conv_line" ] && info "DRY-RUN: $_conv_line"
      done <<EOF
$PLAN_CODEX_CONVERGENCE
EOF
    fi
  fi
  if [ "${PLAN_MCP_CLIENT_WRITES_COUNT:-0}" -gt 0 ]; then
    info "DRY-RUN: write $PLAN_MCP_CLIENT_WRITES_COUNT MCP client config file(s) (.mcp.json / .vscode/mcp.json)"
  fi
  if [ "${PLAN_MEMORY_WRITES_COUNT:-0}" -gt 0 ]; then
    info "DRY-RUN: seed $PLAN_MEMORY_WRITES_COUNT kernel principle(s) to memory"
  fi
else
  PLAN_FILE="$PLAN_TMP" python3 - <<'PY'
import json, os
with open(os.environ["PLAN_FILE"], encoding="utf-8") as f:
    plan = json.load(f)

# Codex writes.
for w in (plan.get("codex") or {}).get("writes", []):
    os.makedirs(os.path.dirname(w["path"]), exist_ok=True)
    # Binary mode + explicit UTF-8 prevents CRLF translation on Windows,
    # which would otherwise break Phase 6 content-equality idempotence.
    with open(w["path"], "wb") as f:
        f.write(w["content"].encode("utf-8"))

# MCP client config writes (.mcp.json + .vscode/mcp.json — env-backed, no secret).
for w in (plan.get("mcpClientConfig") or {}).get("writes", []):
    os.makedirs(os.path.dirname(w["path"]), exist_ok=True)
    # Binary mode + explicit UTF-8 prevents CRLF translation on Windows,
    # which would otherwise break Phase 6 content-equality idempotence.
    with open(w["path"], "wb") as f:
        f.write(w["content"].encode("utf-8"))

# Grok config writes (TOML for ~/.grok/config.toml , from grok config plan).
for w in (plan.get("grok") or {}).get("config", {}).get("writes", []):
    if w.get("path"):
        d = os.path.dirname(w["path"])
        if d: os.makedirs(d, exist_ok=True)
        with open(w["path"], "wb") as f:
            f.write(w["content"].encode("utf-8"))

# Memory writes (excluding preserve-user-edit).
mem = plan.get("memory") or {}
for w in mem.get("writes", []):
    if w.get("mode") == "preserve-user-edit":
        continue
    os.makedirs(os.path.dirname(w["path"]), exist_ok=True)
    # Binary mode + explicit UTF-8 prevents CRLF translation on Windows,
    # which would otherwise break Phase 6 content-equality idempotence.
    with open(w["path"], "wb") as f:
        f.write(w["content"].encode("utf-8"))

# Memory index entry.
idx = mem.get("indexEntry")
if idx:
    os.makedirs(os.path.dirname(idx["path"]), exist_ok=True)
    with open(idx["path"], "wb") as f:
        f.write(idx["content"].encode("utf-8"))
PY

  if [ "${PLAN_CODEX_WRITES_COUNT:-0}" -gt 0 ]; then
    ok "Codex plugin wired."
    CODEX_WIRED=1
    # Report DPF-scoping convergence so drift is surfaced, not silently
    # tolerated (spec S4.5). One [..] line per change.
    if [ "${PLAN_CODEX_CONVERGENCE_COUNT:-0}" -gt 0 ] && [ -n "${PLAN_CODEX_CONVERGENCE:-}" ]; then
      while IFS= read -r _conv_line; do
        [ -n "$_conv_line" ] && info "$_conv_line"
      done <<EOF
$PLAN_CODEX_CONVERGENCE
EOF
    fi
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

  # Grok wiring: config writes applied in the PY block above if PLAN_GROK_WRITES_COUNT >0 .
  if [ "${PLAN_GROK_WRITES_COUNT:-0}" -gt 0 ]; then
    ok "Grok config wired."
    GROK_WIRED=1
  elif [ "$GROK_PRESENT" -eq 1 ]; then
    ok "Grok CLI detected (config already converged)."
    GROK_WIRED=1
  else
    skip "Grok CLI not installed; skipping (will appear when 'grok' is on PATH)."
  fi

  # Antigravity (agy) recognition. Additive/optional — never gates readiness.
  # The DPF MCP config write is delegated to update_agent_toolchain.py /
  # `issue-mcp-token --format antigravity` (see docs/operations/antigravity-cli-onboarding.md):
  # agy's exact MCP-config path is pending confirmation on a live install
  # (BI-ECAE3494), so we do not write to an unverified path from here.
  if [ "$AGY_PRESENT" -eq 1 ]; then
    ok "Antigravity CLI (agy) detected; wire MCP config per the onboarding runbook."
    AGY_WIRED=1
  else
    skip "Antigravity CLI not installed; skipping (pass --install-antigravity to opt in)."
  fi

  if [ "${PLAN_MCP_CLIENT_WRITES_COUNT:-0}" -gt 0 ]; then
    ok "MCP client config written ($PLAN_MCP_CLIENT_WRITES_COUNT file(s): .mcp.json / .vscode/mcp.json)."
  else
    ok "MCP client config already converged."
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
with open(os.environ["PROBE_FILE"], encoding="utf-8") as f:
    p = json.load(f)
print(json.dumps(p["mcpReadiness"]))
')"
      SMOKE_TEST="$(PROBE_FILE="$PROBE_TMP" python3 -c '
import json, os
with open(os.environ["PROBE_FILE"], encoding="utf-8") as f:
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
  if [ $CLAUDE_PRESENT -eq 0 ] && [ $CODEX_PRESENT -eq 0 ] && [ $GROK_PRESENT -eq 0 ]; then
    SMOKE_TEST='{"result": "skipped", "reason": "no_cli_on_path"}'
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

if [ "$CLAUDE_WIRED" -eq 0 ] && [ "$CODEX_WIRED" -eq 0 ] && [ "$GROK_WIRED" -eq 0 ]; then
  FINAL_STATE="missing_cli"
elif [ "$MCP_OK" != "True" ]; then
  case "$MCP_REASON" in
    no_token|scope_insufficient) FINAL_STATE="missing_token" ;;
    endpoint_unreachable|unexpected_shape) FINAL_STATE="needs_refresh" ;;
    *)                                     FINAL_STATE="needs_refresh" ;;
  esac
elif [ "$SMOKE_RESULT" = "failed" ]; then
  FINAL_STATE="failed_smoke"
elif [ "$CLAUDE_WIRED" -eq 0 ] || [ "$CODEX_WIRED" -eq 0 ] || [ "$GROK_WIRED" -eq 0 ]; then
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
  "grokWired": $([ $GROK_WIRED -eq 1 ] && echo true || echo false),
  "antigravityWired": $([ $AGY_WIRED -eq 1 ] && echo true || echo false),
  "memorySeededAt": $MEMORY_SEEDED_AT_JSON,
  "mcpReadiness": $MCP_READINESS,
  "smokeTest": $SMOKE_TEST,
  "readinessState": "$FINAL_STATE"
}
JSON
)"

if [ "$DRY_RUN" -eq 0 ]; then
  dpf_state_init "agent-toolchain-bootstrap-phase-4" "$REPO_ROOT" || fail "Failed to initialize canonical install state."
  dpf_state_write_json "agentToolchain" "$AGENT_TOOLCHAIN_JSON" || fail "Failed to persist agent toolchain readiness in canonical install state."
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
if [ -n "${PLAN_UPSTREAM_DRIFT_ADVISORY:-}" ]; then
  printf '  %s\n' "$PLAN_UPSTREAM_DRIFT_ADVISORY"
fi
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

seed_worktree_core "post-toolchain"

printf '\n'
