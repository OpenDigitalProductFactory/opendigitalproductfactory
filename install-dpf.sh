#!/usr/bin/env bash
# Open Digital Product Factory — end-user installer (macOS / Linux).
#
# This is the Phase 6 *vertical slice*: framework only. Phase 7 adds
# Docker Engine installation, autostart, and the rest of the
# end-user-facing automation. Phase 6 ships:
#
#   - Preflight: unsupported-host detection (Intel Mac, WSL2-without-DD,
#     rootless Docker, Podman, older distros, air-gapped warn).
#   - install-state.json (~/.dpf/install-state.json) read/write/migration.
#   - --dry-run flag: prints planned compose chain + env diffs + state
#     file diffs without touching the host.
#   - --headless flag: non-interactive (default for CI).
#   - doctor subcommand: emits a diagnostic bundle for support reports.
#
# Install modes (parity with install-dpf.ps1 Step 5): the installer prompts
# for one of two modes, or takes --customer / --contributor:
#   - customer    "Ready to go"  — pre-built release images, no contributor
#                                  tooling. The default in headless/CI.
#   - contributor "Customizable" — full stack built from local source, with
#                                  contributor git hooks + agent-toolchain
#                                  bootstrap.
#
# Companion: scripts/setup.sh remains the lightweight *contributor dev*
# bootstrap (dev DB stack + `pnpm dev`), distinct from this installer's
# from-source containerized contributor mode.
#
# Per the deployment doctrine: this implements Contracts 2 (runtime
# config), 3 (lifecycle), 8 (secrets — via .env generation), and is
# the macOS/Linux counterpart to install-dpf.ps1 (Windows GA).
#
# Bash 3.2 baseline (macOS default).

set -euo pipefail

# Resolve repo root from script location so cwd doesn't matter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
LIB_DIR="$REPO_ROOT/scripts/installer/lib"

# Source shared helpers from Phase 2 + Phase 3 + Phase 6 + Phase 7a + Phase 7c.
# shellcheck source=scripts/installer/lib/logging.sh
. "$LIB_DIR/logging.sh"
# shellcheck source=scripts/installer/lib/platform.sh
. "$LIB_DIR/platform.sh"
# shellcheck source=scripts/installer/lib/prompts.sh
. "$LIB_DIR/prompts.sh"
# shellcheck source=scripts/installer/lib/compose.sh
. "$LIB_DIR/compose.sh"
# shellcheck source=scripts/installer/lib/preflight.sh
. "$LIB_DIR/preflight.sh"
# shellcheck source=scripts/installer/lib/state.sh
. "$LIB_DIR/state.sh"
# shellcheck source=scripts/installer/lib/doctor.sh
. "$LIB_DIR/doctor.sh"
# shellcheck source=scripts/installer/lib/docker.sh
. "$LIB_DIR/docker.sh"
# shellcheck source=scripts/installer/lib/autostart.sh
. "$LIB_DIR/autostart.sh"
# shellcheck source=scripts/installer/lib/github-cli.sh
. "$LIB_DIR/github-cli.sh"
# shellcheck source=scripts/installer/native-edge-host.sh
. "$REPO_ROOT/scripts/installer/native-edge-host.sh"

# Installer version (semver-ish; bump per release).
DPF_INSTALLER_VERSION="2026.05.11-phase10a"

dpf_report_image_identity() {
  image="$1"
  repo_digest="$(docker image inspect --format '{{join .RepoDigests ", "}}' "$image" 2>/dev/null || true)"
  created_at="$(docker image inspect --format '{{.Created}}' "$image" 2>/dev/null || true)"
  info "Image digest: ${repo_digest:-unavailable}"
  info "Image created at: ${created_at:-unavailable}"

  case "$image" in
    *:latest)
      main_created="$(curl -fsSL --max-time 8 -H 'Accept: application/vnd.github+json' -H 'User-Agent: dpf-installer' \
        https://api.github.com/repos/OpenDigitalProductFactory/opendigitalproductfactory/commits/main 2>/dev/null \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).commit.committer.date||"")}catch{}})' || true)"
      if [ -n "$main_created" ] && [ -n "$created_at" ]; then
        if DPF_IMAGE_CREATED_AT="$created_at" DPF_MAIN_CREATED_AT="$main_created" node -e \
          'process.exit(Date.parse(process.env.DPF_MAIN_CREATED_AT)-Date.parse(process.env.DPF_IMAGE_CREATED_AT)>86400000?0:1)'; then
          warn "The latest image is older than main by more than 24 hours. Installation can continue, but the published release may be stale."
        fi
      else
        warn "Could not compare latest image age with main; immutable digest and creation date are shown above."
      fi
      ;;
  esac
}

# ── CLI handling ────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Open Digital Product Factory — Installer

Usage:
  bash install-dpf.sh [flags] [subcommand]

Subcommands:
  (default)     Run the install flow.
  doctor        Emit a diagnostic bundle to ~/.dpf/doctor-<timestamp>.tar.gz.

Flags:
  --dry-run     Print the planned actions without touching the host.
                Honors --headless. Useful for CI smoke and pre-flight review.
  --headless    Non-interactive (no prompts). Defaults are used (install
                mode defaults to "customer"); required for CI / unattended
                installs.
  --customer    Ready-to-go install: run the pre-built release images and
                skip contributor tooling. Skips the interactive mode prompt.
  --contributor Customizable install: build the full stack from local source,
                enable contributor git hooks, and run the agent-toolchain
                bootstrap. Skips the interactive mode prompt.
  --environment-class <class>
                Declare what this installation is: production, development, or
                test. Shapes what connected AI agents may do — teardown,
                credential handling, and writes to a paired installation. An
                undeclared install is treated as production.
  --dev-workspace-path <path>
                Contributor-only. Absolute path to the operator's dev workspace
                (where 'git worktree add' creates feature branches and where
                Claude / Codex sessions open). Distinct from the install path
                so the dev tree never collides with the production install or
                the self-upgrade merge. Defaults to the install path (single-
                tree mode — current behavior). When distinct, dev-loop scripts
                refuse to create worktrees inside the install path. BI-0856A4CE.
  --release     Force the pre-built multi-arch GHCR images
                (docker-compose.release.yml overlay). Overrides the compose
                mode that the install mode would otherwise derive.
  --dev         Force locally-built images. Overrides the derived compose
                mode (e.g. release images for a customer install).
  --force-unsupported-host
                Override unsupported-host preflight refusal (advanced).
                Equivalent to DPF_FORCE_UNSUPPORTED_HOST=1.
  --no-autostart
                Skip the LaunchAgent / systemd-user autostart install
                step. The platform comes up but won't auto-start at
                login / boot.
  --with-edge   Bundle a local Edge Node alongside the Authority Core
                (network discovery from this host). OPT-IN: the Edge Node
                is NOT installed by default. A node added this way
                auto-approves at enrollment (choosing it is the consent).
                To map a network from a different machine instead, add a
                node from Admin > Platform Development > Edge Nodes
                (docker-compose.edge-standalone.yml).
  --no-edge     Force-skip the local Edge Node even if a prior install
                enabled it (Edge is already off by default).
  --organization-join-package <file.dpfjoin>
                Join an existing organization trust domain during install.
                The private package is validated, consumed, and deleted on
                success; certificates and restart wiring are automatic.
  -h, --help    Show this help.

Status: Phase 6+ vertical slice. Full end-user install (Docker
auto-install, autostart, model pulls) lands incrementally per the roadmap.
Run with no flags for the interactive customer/contributor mode prompt, or
pass --customer / --contributor to skip it.

Roadmap: docs/superpowers/plans/2026-05-09-macos-linux-native-support.md
Doctrine: docs/superpowers/specs/2026-05-09-deployment-contracts.md
EOF
}

DPF_DRY_RUN=0
DPF_MODE="dev"          # dev | release — compose chain. Derived from the
                        # install mode below unless set explicitly via a flag.
DPF_MODE_EXPLICIT=0     # 1 once --dev/--release is passed, so the install-mode
                        # prompt does not override an explicit compose choice.
DPF_INSTALL_MODE=""     # customer | contributor — resolved in "Install mode".
DPF_AUTOSTART=1
DPF_INCLUDE_EDGE="${DPF_INCLUDE_EDGE:-}"    # opt-in; resolved after state init (BI-72CFF89D). Empty = decide via dpf_resolve_edge_enabled (default OFF).
# BI-0856A4CE Phase 1 — optional contributor-only path that, when distinct from
# the install path, becomes the worktree base. Empty = single-tree mode (current
# behavior). Future phases will turn this into a hard install/dev separation.
DPF_DEV_WORKSPACE_PATH_ARG=""
DPF_ORGANIZATION_JOIN_PACKAGE=""
DPF_INSTALL_CALLER_DIR="$PWD"
SUBCOMMAND=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)              DPF_DRY_RUN=1 ;;
    --headless)             DPF_HEADLESS=1; export DPF_HEADLESS ;;
    --release)              DPF_MODE="release"; DPF_MODE_EXPLICIT=1 ;;
    --dev)                  DPF_MODE="dev"; DPF_MODE_EXPLICIT=1 ;;
    --customer)             DPF_INSTALL_MODE="customer" ;;
    --environment-class)    shift; DPF_ENVIRONMENT_CLASS="${1:-}" ;;
    --environment-class=*)  DPF_ENVIRONMENT_CLASS="${1#*=}" ;;
    --contributor)          DPF_INSTALL_MODE="contributor" ;;
    --dev-workspace-path)   shift; DPF_DEV_WORKSPACE_PATH_ARG="${1:-}" ;;
    --dev-workspace-path=*) DPF_DEV_WORKSPACE_PATH_ARG="${1#*=}" ;;
    --no-autostart)         DPF_AUTOSTART=0 ;;
    --with-edge)            DPF_INCLUDE_EDGE=1 ;;
    --no-edge)              DPF_INCLUDE_EDGE=0 ;;
    --organization-join-package)
                            shift
                            [ -n "${1:-}" ] || { echo "--organization-join-package requires a file" >&2; exit 64; }
                            DPF_ORGANIZATION_JOIN_PACKAGE="$1" ;;
    --force-unsupported-host)
                            DPF_FORCE_UNSUPPORTED_HOST=1
                            export DPF_FORCE_UNSUPPORTED_HOST ;;
    -h|--help)              usage; exit 0 ;;
    doctor)                 SUBCOMMAND="doctor" ;;
    *)
      echo "install-dpf.sh: unknown argument: $1" >&2
      echo "Run 'bash install-dpf.sh --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

if [ -n "$DPF_ORGANIZATION_JOIN_PACKAGE" ]; then
  case "$DPF_ORGANIZATION_JOIN_PACKAGE" in
    /*) : ;;
    *) DPF_ORGANIZATION_JOIN_PACKAGE="$DPF_INSTALL_CALLER_DIR/$DPF_ORGANIZATION_JOIN_PACKAGE" ;;
  esac
  [ -f "$DPF_ORGANIZATION_JOIN_PACKAGE" ] || {
    echo "Organization join package was not found: $DPF_ORGANIZATION_JOIN_PACKAGE" >&2
    exit 66
  }
fi

cd "$REPO_ROOT"

# ── Subcommand: doctor ──────────────────────────────────────────────────────

if [ "$SUBCOMMAND" = "doctor" ]; then
  dpf_doctor_collect "$DPF_MODE"
  exit 0
fi

# ── Main install flow (Phase 6 vertical slice) ──────────────────────────────

echo ""
echo "  Open Digital Product Factory — Installer (Phase 6 vertical slice)"
echo "  =================================================================="
dpf_platform
dpf_arch
echo "  Platform: $DPF_PLATFORM ($DPF_ARCH)"
if [ "$DPF_DRY_RUN" = "1" ]; then echo "  [dry-run]"; fi
echo ""

# 1. Preflight: unsupported-host detection + port conflicts.
step "Preflight: host compatibility"
dpf_preflight_unsupported_host
ok "Host compatibility check passed"

# jq is required by the kernel-commandment shell guard
# (scripts/safety/dpf-shell-guard.sh). The guard's JSON write+parse is the
# load-bearing surface that decides whether destructive commands get through;
# we mandate jq at install time rather than trusting fragile sed/grep parsing.
if ! command -v jq >/dev/null 2>&1; then
  fail "jq is required (kernel-commandment shell guard depends on it).
        Install via your package manager:
          macOS:  brew install jq
          Debian: sudo apt-get install jq
          RHEL:   sudo dnf install jq
          Alpine: apk add jq"
fi
ok "jq present (kernel-commandment shell guard preflight)"

rc=0
dpf_preflight_port_conflicts || rc=$?
if [ "$rc" -ne 0 ]; then
  exit "$rc"
fi
ok "Port preflight passed (portal: ${DPF_PORTAL_PORT:-3000})"

# 2. Bring install-state.json into existence (or validate existing).
step "Install state"
# dpf_state_validate returns 0/2/3 to differentiate states; we capture
# without tripping set -e.
rc=0
dpf_state_validate || rc=$?
case "$rc" in
  0) ok "Install state at $(dpf_state_path) is current (schema $DPF_STATE_SCHEMA_VERSION)" ;;
  2) if [ "$DPF_DRY_RUN" = "1" ]; then
       info "No prior install state; dry-run leaves $(dpf_state_path) unchanged"
     else
       info "No prior install state; initializing $(dpf_state_path)"
       # Bare calls here abort the whole install with a naked exit 1 under
       # `set -euo pipefail`, saying nothing about which stage died. Same
       # `fail ... (see message above)` idiom the validation arm below uses.
       dpf_state_init "$DPF_INSTALLER_VERSION" "$REPO_ROOT"          || fail "Could not initialize install state at $(dpf_state_path) (see message above)"
     fi ;;
  3) warn "Install state is from an older installer; running forward migration"
     dpf_state_migrate        || fail "Install state forward migration failed at $(dpf_state_path) (see message above)" ;;
  *) fail "Install state validation failed (see message above)" ;;
esac

# 2b. Choose install mode (parity with install-dpf.ps1 Step 5). Must run
#     before the compose chain (Step 3) and the dry-run gate (Step 4) since
#     it can derive DPF_MODE.
#       customer    "Ready to go"  → release images, no contributor tooling
#       contributor "Customizable" → from-source build + git hooks + toolchain
step "Install mode"
if [ -z "$DPF_INSTALL_MODE" ]; then
  # Resume: reuse a previously-selected mode without re-prompting.
  prior_mode="$(dpf_state_read installMode 2>/dev/null || true)"
  if [ -n "$prior_mode" ]; then
    DPF_INSTALL_MODE="$prior_mode"
    ok "Using previously selected mode: $DPF_INSTALL_MODE"
  elif [ "${DPF_HEADLESS:-0}" = "1" ] || [ "$DPF_DRY_RUN" = "1" ]; then
    # Non-interactive (CI / dry-run): default to the end-user install.
    DPF_INSTALL_MODE="customer"
    info "Non-interactive run; defaulting to customer mode."
  else
    echo ""
    echo "  How do you want to use Digital Product Factory?"
    echo ""
    echo "    [1] Ready to go   - Pre-built: use Build Studio inside the portal to extend the platform."
    echo "    [2] Customizable  - Full source: Build Studio + your editor work from the same workspace."
    echo ""
    printf "  Choose [1/2] (default 1): "
    read -r mode_choice
    case "$mode_choice" in
      2) DPF_INSTALL_MODE="contributor" ;;
      *) DPF_INSTALL_MODE="customer" ;;
    esac
  fi
fi

case "$DPF_INSTALL_MODE" in
  customer|contributor) ;;
  *) fail "Unknown install mode '$DPF_INSTALL_MODE' (expected customer|contributor)." ;;
esac

# Derive the compose mode unless the operator forced it with --dev/--release.
if [ "$DPF_MODE_EXPLICIT" = "0" ]; then
  if [ "$DPF_INSTALL_MODE" = "contributor" ]; then
    DPF_MODE="dev"      # build the stack from local source
  else
    DPF_MODE="release"  # pull pre-built GHCR images
  fi
fi

# Persist only on a real run. A --dry-run defaults to customer; persisting it
# would make a later real run "resume" that default and skip the prompt.
if [ "$DPF_DRY_RUN" != "1" ]; then
  dpf_state_write installMode "$DPF_INSTALL_MODE" 2>/dev/null || true
fi
ok "Install mode: $DPF_INSTALL_MODE (compose mode: $DPF_MODE)"

# Declare what this installation IS. Agents and lifecycle tooling read this to
# tell a production install from a disposable one. Only a declared value is
# recorded: an undeclared install is treated as production, so a missing
# declaration can never be the reason something gets torn down.
if [ -n "${DPF_ENVIRONMENT_CLASS:-}" ]; then
  case "$DPF_ENVIRONMENT_CLASS" in
    production|development|test)
      if [ "$DPF_DRY_RUN" != "1" ]; then
        dpf_state_write environmentClass "$DPF_ENVIRONMENT_CLASS" 2>/dev/null || true
      fi
      ok "Installation environment class: $DPF_ENVIRONMENT_CLASS"
      ;;
    *)
      fail "--environment-class must be one of: production, development, test"
      ;;
  esac
else
  warn "No environment class declared; this install is treated as production until one is set."
fi

# Edge Node deploy gate (opt-in; BI-72CFF89D / edge-topology design §5).
# Resolve whether to bundle the local Edge Node BEFORE assembling the chain:
# explicit --with-edge/--no-edge wins, else the recorded choice in
# install-state.json, else grandfather a pre-flip install that already has a
# bundled node, else default OFF. Exported so compose.sh includes the overlay
# only when chosen; the resolved choice is recorded to state post-dry-run.
DPF_INCLUDE_EDGE="$(dpf_resolve_edge_enabled "$REPO_ROOT")"
export DPF_INCLUDE_EDGE

# 3. Resolve the compose -f chain (per-platform via compose.sh).
step "Compose chain"
dpf_compose_files "$DPF_MODE"
echo "  Files: ${DPF_COMPOSE_FILES[*]}"

# 4. Dry-run gate.
if [ "$DPF_DRY_RUN" = "1" ]; then
  echo ""
  step "Dry-run plan"
  echo "  Would run:"
  echo "    docker compose ${DPF_COMPOSE_FILES[*]} up -d"
  echo ""
  echo "  Install state file: $(dpf_state_path)"
  echo "  Repo root:          $REPO_ROOT"
  echo ""
  ok "Dry-run complete; no changes made."
  exit 0
fi

# 5. Ensure Docker is installed (Linux: distro pkg manager; macOS: see
#    Phase 7b for the .dmg flow — until then, manual install).
step "Docker Engine"
dpf_docker_ensure_installed; rc=$?
case "$rc" in
  0) ok "Docker present and reachable"
     dpf_state_write dockerEndpoint "$(dpf_docker_endpoint)" 2>/dev/null || true
     dpf_state_write dockerContext "$(dpf_docker_context)" 2>/dev/null || true
     dpf_state_write_json composeFiles "$(dpf_compose_files_json)" 2>/dev/null || true
     if [ "$DPF_INCLUDE_EDGE" = "1" ]; then
       dpf_state_write_json edge '{"enabled":true,"mode":"local"}' 2>/dev/null || true
     else
       dpf_state_write_json edge '{"enabled":false,"mode":null}' 2>/dev/null || true
     fi
     dpf_preflight_docker_memory ;;
  75) # Docker was just installed; operator must log out / newgrp
      echo ""
      warn "Re-run install-dpf.sh after logging out and back in (or 'newgrp docker')."
      exit 75 ;;
  *) fail "Docker setup failed (rc=$rc)" ;;
esac

# 6. Verify Node.js / pnpm. We don't auto-install Node — that's a
#    user choice (nvm / brew / distro pkg) outside the installer's
#    governance. Phase 7 stays clear of language-runtime installation.
step "Node.js and pnpm"
if ! command -v node >/dev/null 2>&1; then
  # Non-interactive shells (bash install-dpf.sh) don't source .zshrc/.bashrc,
  # so nvm-managed node is invisible. Try to load nvm if present.
  _nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$_nvm_sh" ]; then
    info "node not on PATH; sourcing nvm..."
    # shellcheck source=/dev/null
    . "$_nvm_sh" 2>/dev/null || true
    nvm use default 2>/dev/null || nvm use node 2>/dev/null || true
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Install Node 20+ via your platform's package manager (nvm, brew, apt) and re-run."
fi
NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  fail "Node.js v20+ required. Current: $(node -v). Upgrade and re-run."
fi
ok "Node.js $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  info "pnpm not found; installing via npm..."
  npm install -g pnpm
fi
ok "pnpm $(pnpm -v)"

# 7. Install workspace dependencies (so scripts/detect-hardware-host.ts
#    is runnable via the @dpf/db tsx in the steps below).
step "Workspace dependencies"
pnpm install
ok "Dependencies installed"

# Ensure the bundled "voice profile in the build" (founder seed voice for
# mark-dpf-platform) is materialized in the final data/uploads tree *before*
# we do docker compose up (which triggers the platform DB seed that creates
# the VoiceProfile row + consent). The seedPlatformVoice does a best-effort
# copy, but during install the path resolution or prior placeholder files can
# cause it to skip. We force the real clip here (idempotent, best-effort).
# This is the Unix equivalent of what the Mac TTS setup script also does for
# the host sidecar. Windows uses its own .ps1 flow (untouched) + the seed.
CLIP_SRC=""
for cand in \
  "$REPO_ROOT/packages/db/data/seed-voices/mark-dpf-platform/reference.webm" \
  "$REPO_ROOT/packages/db/data/seed-voices/mark-dpf-platform/reference.webm"; do
  if [ -f "$cand" ] && [ -s "$cand" ]; then CLIP_SRC="$cand"; break; fi
done
UPLOADS_DIR="$REPO_ROOT/data/uploads"
if [ -n "$CLIP_SRC" ]; then
  mkdir -p "$UPLOADS_DIR/voices/mark-dpf-platform"
  dst="$UPLOADS_DIR/voices/mark-dpf-platform/reference.webm"
  do_copy=0
  if [ ! -f "$dst" ]; then
    do_copy=1
  else
    src_sz=$(wc -c < "$CLIP_SRC" 2>/dev/null || echo 0)
    dst_sz=$(wc -c < "$dst" 2>/dev/null || echo 0)
    if [ "$dst_sz" -lt 20000 ] && [ "$src_sz" -gt 20000 ]; then do_copy=1; fi
  fi
  if [ "$do_copy" -eq 1 ]; then
    cp -f "$CLIP_SRC" "$dst" || true
    info "Platform founder voice clip placed in $dst (from build)"
  fi
fi

# Contributor git hooks (contributor mode only). Mirrors scripts/setup.sh:
# enables the in-repo .githooks/ (Prisma migration guard + secret scan).
# Idempotent; customer installs skip it (they don't author commits here).
if [ "$DPF_INSTALL_MODE" = "contributor" ] && [ -d .git ]; then
  step "Contributor git hooks"
  if git config core.hooksPath .githooks 2>/dev/null; then
    ok "Git hooks path set to .githooks"
  else
    warn "Could not set core.hooksPath; run 'git config core.hooksPath .githooks' manually."
  fi
fi

# GitHub CLI (contributor mode only). Auto-installs `gh` without Homebrew/sudo
# so contributors can push branches and open PRs (and Build Studio's contribution
# flow works) without the manual "install gh" detour on a fresh machine. Sign-in
# is left to the operator: `gh auth login` is an interactive browser flow and the
# OAuth path it uses is exempt from the fine-grained-PAT lifetime limits some orgs
# enforce. Non-fatal: a failed auto-install just prints the manual fallback.
if [ "$DPF_INSTALL_MODE" = "contributor" ]; then
  step "GitHub CLI"
  dpf_ensure_gh || warn "GitHub CLI auto-install incomplete (non-fatal)."
  if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
    info "Sign in to GitHub to enable pushes and PRs (OAuth — avoids PAT lifetime limits):"
    info "    gh auth login --git-protocol https --web"
    info "  Then wire git:  gh auth setup-git"
  fi
fi

# Agent toolchain bootstrap (BI-4B17051B Phase 4): converges Claude Code +
# Codex CLI sessions, seeds kernel memory, persists agentToolchain readiness.
# The script prints a six-state readiness banner (ready / partial /
# missing_cli / missing_token / needs_refresh / failed_smoke) with no
# substrate names or command snippets in operator-visible output.
# Contributor mode only — customer installs don't need agent CLIs wired up.
if [ "$DPF_INSTALL_MODE" = "contributor" ]; then
  step "Agent toolchain bootstrap"
  bootstrap_script="$REPO_ROOT/scripts/dpf-bootstrap-agent-toolchain.sh"
  if [ -f "$bootstrap_script" ]; then
    bootstrap_args=("$REPO_ROOT")
    if [ "${DPF_HEADLESS:-0}" = "1" ]; then
      bootstrap_args=(--headless "${bootstrap_args[@]}")
    fi
    if [ "${DPF_DRY_RUN:-0}" = "1" ]; then
      bootstrap_args=(--dry-run "${bootstrap_args[@]}")
    fi
    bash "$bootstrap_script" "${bootstrap_args[@]}" || warn "Agent toolchain bootstrap reported an issue (non-fatal)."
  else
    warn "scripts/dpf-bootstrap-agent-toolchain.sh not found; skipping agent toolchain convergence."
  fi
else
  info "Skipping agent toolchain bootstrap (customer mode)."
fi

# 8. Resolve host hardware profile (Phase 5 macOS / Linux detector).
#    Writes DPF_HOST_PROFILE for docker-entrypoint.sh to consume on
#    portal-init.
step "Host hardware profile"
DPF_SELECTED_MODEL=""

# Defensive nvm sourcing for pnpm (mirrors the earlier Node step). On macOS
# with nvm-managed node (common for contributors and some customer setups),
# pnpm lives in the nvm bin dir. Without this, the pnpm --filter call below
# can fail with "command not found" even if the user had a working pnpm in
# their interactive shell. This is Mac/Linux sh path only; Windows ps1 has
# its own pnpm + hardware detection logic and is unaffected.
if ! command -v pnpm >/dev/null 2>&1; then
  _nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$_nvm_sh" ]; then
    # shellcheck source=/dev/null
    . "$_nvm_sh" 2>/dev/null || true
    nvm use default 2>/dev/null || nvm use node 2>/dev/null || true
  fi
fi

if DPF_HOST_PROFILE_JSON="$(pnpm --filter @dpf/db exec -- tsx "$REPO_ROOT/scripts/detect-hardware-host.ts" 2>/dev/null)"; then
  export DPF_HOST_PROFILE="$DPF_HOST_PROFILE_JSON"
  DPF_SELECTED_MODEL="$(printf '%s' "$DPF_HOST_PROFILE_JSON" | sed -nE 's/.*"selectedModel"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  if [ -n "$DPF_SELECTED_MODEL" ]; then
    ok "Hardware profile detected — selected AI model (pull form): $DPF_SELECTED_MODEL"
    info "  (Will register under short form for runtime references; normalized after pull.)"
  else
    ok "Hardware profile detected (will be passed to portal-init via DPF_HOST_PROFILE)"
  fi
else
  warn "Host hardware detection failed (non-fatal); portal-init will skip the profile step."
fi

# 8b. Set up Docker Model Runner and pull the selected chat model.
#     Mirrors install-dpf.ps1 §Step 7 (lines 1895-1985). Docker Model
#     Runner is DISABLED by default on fresh Docker Desktop installs; without
#     enabling it first, `docker model pull` fails with "Docker Model Runner
#     is not running" and the portal silently degrades to "AI provider is
#     temporarily unavailable" on first load.
step "AI Coworker setup (Docker Model Runner)"
if [ "$DPF_PLATFORM" = "darwin" ] && command -v docker >/dev/null 2>&1; then
  info "Enabling Docker Model Runner..."
  if docker desktop enable model-runner >/dev/null 2>&1; then
    ok "Docker Model Runner enabled"

    # Wait for Model Runner to be ready before pulling.
    mr_ready=0
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if docker model list >/dev/null 2>&1; then mr_ready=1; break; fi
      sleep 2
    done
    if [ "$mr_ready" -ne 1 ]; then
      # Distinguish "Model Runner CLI absent" (Docker Desktop too old) from
      # "present but not ready yet" so we give the right guidance and never
      # leak the raw `docker: 'model' is not a docker command` error by
      # attempting a pull that cannot succeed (#1767). The portal still
      # installs either way; AI features activate once a model is available.
      if docker model --help >/dev/null 2>&1; then
        warn "Docker Model Runner isn't running yet; skipping the AI model download."
        info "  Pull it later once it's ready: docker model pull ${DPF_SELECTED_MODEL:-<model>}"
      else
        warn "Docker Model Runner isn't available (requires Docker Desktop 4.40+); skipping the AI model download."
        info "  Update Docker Desktop, then re-run install-dpf.sh. The portal still works without it."
      fi
    elif [ -n "$DPF_SELECTED_MODEL" ]; then
      # Skip pull if the EXACT selected model (family + tag/quant) is on
      # disk. The earlier loose check stripped `ai/` and everything after
      # `:`, so any pre-existing qwen3 quant satisfied the grep and the
      # detector's recommendation never got pulled. That left users with
      # whatever they happened to pull manually instead of the strong-tier
      # model their hardware can run.
      #
      # `docker model list` prints rows like `qwen3:30B-A3B-Q4_K_M` (no
      # `ai/` prefix; tag with quant suffix preserved). Match the full
      # family:tag pair so 8B ≠ 14B ≠ 30B-A3B.
      #
      # Name accuracy note: we PULL using the `ai/...` form (Docker Hub repo
      # path), but the model registers under the short form shown by
      # `docker model list`. We capture the *listed* name and normalize
      # DPF_HOST_PROFILE.selectedModel (and DPF_SELECTED_MODEL) to it so that
      # portal discovery, /v1/models, and inference "get model by reference"
      # calls use the exact string the model-runner knows. This prevents the
      # "failed to get model: model not found" seen in inference.model-manager
      # logs even when the pull command itself was issued.
      _pull_name="$DPF_SELECTED_MODEL"
      _runtime_model="$(printf '%s' "$_pull_name" | sed 's|^ai/||')"
      if docker model list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$_runtime_model"; then
        ok "Model $_runtime_model already on disk"
        DPF_SELECTED_MODEL="$_runtime_model"
      else
        # Print expected size upfront (user request for time estimation given
        # internet speed). Uses cheap manifest inspect (no blob download).
        _size_mb=0
        if command -v python3 >/dev/null 2>&1; then
          _size_mb=$(docker manifest inspect "$_pull_name" 2>/dev/null | python3 -c '
import sys, json
try:
  d = json.load(sys.stdin)
  t = 0
  for l in d.get("layers", []): t += l.get("size", 0)
  cfg = d.get("config") or {}
  t += cfg.get("size", 0)
  print(int(t / 1024 / 1024))
except Exception:
  print(0)
' 2>/dev/null || echo 0)
        fi
        if [ "$_size_mb" -gt 0 ]; then
          info "  Expected download size: ~${_size_mb}MB. If you know your internet speed you can estimate how long the pull will take."
        fi
        info "Pulling AI model $_pull_name via Docker Model Runner..."
        info "  This may take several minutes depending on your internet speed."
        # Stream (filtered) pull output; || true so a pull hiccup does not
        # abort the whole installer under set -euo pipefail. Ground truth for
        # "actually ready" is the post-pull list check, not the pull exit or
        # the old grep -v pipeline status (which could misclassify).
        docker model pull "$_pull_name" 2>&1 | grep -v "^Downloaded" || true
        if docker model list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$_runtime_model"; then
          ok "AI Coworker model ready: $_runtime_model"
          DPF_SELECTED_MODEL="$_runtime_model"
        else
          warn "Model pull may have failed. You can retry later: docker model pull $_pull_name"
        fi
      fi
      # Normalize the host profile JSON (passed via compose to portal-init
      # and saved to PlatformConfig.host_profile) so its selectedModel is the
      # *runtime* reference the model-runner exposes via /v1/models and
      # accepts for inference. Using the ai/ form here was the source of
      # "model not found" on get-by-reference even after pull.
      if [ -n "${DPF_HOST_PROFILE:-}" ]; then
        export DPF_HOST_PROFILE=$(printf '%s' "$DPF_HOST_PROFILE" | sed -E 's/("selectedModel"[[:space:]]*:[[:space:]]*")[^"]*"/\1'"$_runtime_model"'"/' )
      fi
    else
      warn "No model selected by hardware detection; skipping chat-model pull."
    fi
  else
    warn "Could not enable Docker Model Runner automatically."
    warn "  Requires Docker Desktop 4.40+. Enable via Settings → AI → Enable Docker Model Runner,"
    warn "  then re-run install-dpf.sh."
  fi
else
  info "Skipping Model Runner setup (non-Darwin platform or docker unavailable)."
fi

# 9. Generate / ensure root .env exists. Mirrors scripts/setup.sh's
#    env-generation logic (Phase 2). If .env already exists we leave
#    it alone — operators editing secrets shouldn't have them clobbered.
step "Environment file"
if [ ! -f .env ]; then
  cp .env.docker.example .env
  AUTH_SECRET_VAL="$(dpf_random_secret_b64 32)"
  ENC_KEY_VAL="$(dpf_random_secret_hex 32)"
  ADMIN_PW_VAL="$(dpf_random_secret_hex 16)"
  dpf_sed_inplace "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET_VAL|" .env
  dpf_sed_inplace "s|<generate with: openssl rand -hex 32>|$ENC_KEY_VAL|" .env
  dpf_sed_inplace "s|<set a strong password>|$ADMIN_PW_VAL|" .env
  dpf_sed_inplace "s|<set to absolute path of this directory on the host>|$REPO_ROOT|" .env
  # Backups live OUTSIDE the install root by design so a future repo-tree wipe
  # cannot destroy operator backup history. Append DPF_BACKUPS_HOST_PATH if it
  # isn't already in the file (it isn't in .env.docker.example today).
  if ! grep -q "^DPF_BACKUPS_HOST_PATH=" .env 2>/dev/null; then
    printf '\n# Backups host path (relocation lives outside install root by design — see\n' >> .env
    printf '# docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §5.3).\n' >> .env
    printf 'DPF_BACKUPS_HOST_PATH=%s-backups\n' "$REPO_ROOT" >> .env
  fi
  # Runtime state dir (/dpf-state mount). Pin to an ABSOLUTE host path so the
  # self-upgrade promoter — which runs as root, HOME=/root — does NOT fall back to
  # ${HOME}/.dpf = /root/.dpf and fail the migrate step with "mounts denied" (#3262).
  # ~/.dpf is under the operator home, which Docker Desktop shares by default.
  if ! grep -q "^DPF_STATE_DIR=" .env 2>/dev/null; then
    printf '\n# Runtime state dir — capability-transition receipts + install-state (compose\n' >> .env
    printf '# mounts it read-only at /dpf-state). ABSOLUTE so the root-run promoter does\n' >> .env
    printf '# not fall back to /root/.dpf and fail with "mounts denied" (#3262).\n' >> .env
    printf 'DPF_STATE_DIR=%s/.dpf\n' "$HOME" >> .env
  fi
  ok ".env created with generated secrets"
  # Never print the generated password. The install log is the first thing an
  # operator pastes into a public install-verification issue, and the issue
  # template asks for exactly that paste -- so echoing the value here publishes
  # it. Point at .env instead, matching the final summary below (#1767).
  info "  Admin password: see ADMIN_PASSWORD in .env"
  info "  (Change it before any non-local deployment)"
else
  ok ".env already exists; preserving operator edits"
  # Even on an existing .env, ensure DPF_BACKUPS_HOST_PATH is set — operators
  # upgrading from a pre-relocation install need this added so the new compose
  # bind mount resolves correctly. Append only; never clobber an existing value.
  if ! grep -q "^DPF_BACKUPS_HOST_PATH=" .env 2>/dev/null; then
    printf '\n# Backups host path (added by installer 2026-05-24 — backups now live\n' >> .env
    printf '# OUTSIDE install root so repo wipes cannot destroy them).\n' >> .env
    printf 'DPF_BACKUPS_HOST_PATH=%s-backups\n' "$REPO_ROOT" >> .env
    info "Added DPF_BACKUPS_HOST_PATH=$REPO_ROOT-backups to existing .env"
  fi
  # Existing installs upgrading past #3262 need DPF_STATE_DIR added, else the
  # self-upgrade promoter (root, HOME=/root) hits /root/.dpf → "mounts denied" at
  # step=migrate. Append only; never clobber an operator-set value.
  if ! grep -q "^DPF_STATE_DIR=" .env 2>/dev/null; then
    printf '\n# Runtime state dir (added by installer — #3262). ABSOLUTE + Docker-shared so\n' >> .env
    printf '# the root-run self-upgrade promoter does not fall back to /root/.dpf.\n' >> .env
    printf 'DPF_STATE_DIR=%s/.dpf\n' "$HOME" >> .env
    info "Added DPF_STATE_DIR=$HOME/.dpf to existing .env"
  fi
fi

# Persist the same canonical host identity written to install-state.json. These
# installer-owned values are the portal/promoter authority; container OS is not.
dpf_platform
dpf_arch
for _host_identity in "DPF_HOST_PLATFORM=$DPF_PLATFORM" "DPF_HOST_ARCH=$DPF_ARCH"; do
  _host_key="${_host_identity%%=*}"
  if grep -q "^${_host_key}=" .env 2>/dev/null; then
    dpf_sed_inplace "s|^${_host_key}=.*|${_host_identity}|" .env
  else
    printf '%s\n' "$_host_identity" >> .env
  fi
done

# Record the platform-correct compose chain for the self-upgrade promoter. The
# orchestrator reads DPF_SELF_UPGRADE_COMPOSE_FILES and passes it to promote.sh as
# PROMOTE_COMPOSE_FILES so the portal is recreated with THIS install's own
# overlays (docker-compose.linux.yml / .macos.yml / .edge.yml). Without it the
# promoter falls back to base-only and would force the wrong substrate's portal
# env — e.g. the macOS TTS sidecar (mlx, :8771) on a Windows/Linux host, which
# breaks voice; or drop the linux ollama LLM_BASE_URL. Mirrors composeFiles in
# install-state.json (the array form) as the space-separated env form the portal
# consumes. Re-run rewrites it so a platform/edge/mode change is always reflected.
_self_upgrade_chain=""
for _tok in "${DPF_COMPOSE_FILES[@]}"; do
  [ "$_tok" = "-f" ] && continue
  _self_upgrade_chain="${_self_upgrade_chain:+$_self_upgrade_chain }$_tok"
done
if grep -q "^DPF_SELF_UPGRADE_COMPOSE_FILES=" .env 2>/dev/null; then
  dpf_sed_inplace "s|^DPF_SELF_UPGRADE_COMPOSE_FILES=.*|DPF_SELF_UPGRADE_COMPOSE_FILES=$_self_upgrade_chain|" .env
else
  printf '\n# Self-upgrade promoter compose chain — see install-dpf.sh for why this\n' >> .env
  printf '# must match the install platform (prevents wrong-substrate portal env).\n' >> .env
  printf 'DPF_SELF_UPGRADE_COMPOSE_FILES=%s\n' "$_self_upgrade_chain" >> .env
fi

# BI-0856A4CE Phase 1 — record DPF_DEV_WORKSPACE_PATH when the contributor
# passed --dev-workspace-path. This is the path where 'git worktree add' will
# create feature branches; distinct from the install path so the dev tree and
# the production install never collide. When unset, single-tree mode persists
# (current behavior) and dev-loop scripts fall back to REPO_ROOT.
if [ "$DPF_INSTALL_MODE" = "contributor" ] && [ -n "$DPF_DEV_WORKSPACE_PATH_ARG" ]; then
  # Resolve to an absolute path (caller may have passed a relative path or ~/).
  case "$DPF_DEV_WORKSPACE_PATH_ARG" in
    \~*) DPF_DEV_WORKSPACE_PATH_ABS="${HOME}${DPF_DEV_WORKSPACE_PATH_ARG#\~}" ;;
    /*)  DPF_DEV_WORKSPACE_PATH_ABS="$DPF_DEV_WORKSPACE_PATH_ARG" ;;
    *)   DPF_DEV_WORKSPACE_PATH_ABS="$(cd "$DPF_DEV_WORKSPACE_PATH_ARG" 2>/dev/null && pwd)" \
           || DPF_DEV_WORKSPACE_PATH_ABS="$(pwd)/$DPF_DEV_WORKSPACE_PATH_ARG" ;;
  esac
  if [ "$DPF_DEV_WORKSPACE_PATH_ABS" = "$REPO_ROOT" ]; then
    info "--dev-workspace-path resolves to the install path; single-tree mode (skipping)."
  else
    if grep -q "^DPF_DEV_WORKSPACE_PATH=" .env 2>/dev/null; then
      dpf_sed_inplace "s|^DPF_DEV_WORKSPACE_PATH=.*|DPF_DEV_WORKSPACE_PATH=$DPF_DEV_WORKSPACE_PATH_ABS|" .env
    else
      printf '\n# Contributor dev workspace (BI-0856A4CE Phase 1) — where git worktrees\n' >> .env
      printf '# branch from. Distinct from DPF_HOST_INSTALL_PATH (the production install)\n' >> .env
      printf '# so the dev tree never collides with the running portal or self-upgrade.\n' >> .env
      printf 'DPF_DEV_WORKSPACE_PATH=%s\n' "$DPF_DEV_WORKSPACE_PATH_ABS" >> .env
    fi
    dpf_state_write devWorkspacePath "$DPF_DEV_WORKSPACE_PATH_ABS" 2>/dev/null || true
    ok "Dev workspace path: $DPF_DEV_WORKSPACE_PATH_ABS (distinct from install $REPO_ROOT)"
  fi
fi

# Record the resolved LLM provider and image tag from the generated .env
# into install-state.json so lifecycle scripts read them from one place
# instead of re-parsing .env. An empty DPF_LLM_PROVIDER means "use the
# platform default" (model-runner on macOS, ollama on Linux) per the
# deployment LLM-provider contract.
_dpf_env_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
DPF_RESOLVED_LLM_PROVIDER="$(_dpf_env_value DPF_LLM_PROVIDER)"
if [ -z "$DPF_RESOLVED_LLM_PROVIDER" ]; then
  case "$DPF_PLATFORM" in
    darwin) DPF_RESOLVED_LLM_PROVIDER="model-runner" ;;
    linux)  DPF_RESOLVED_LLM_PROVIDER="ollama" ;;
  esac
fi
[ -n "$DPF_RESOLVED_LLM_PROVIDER" ] && \
  dpf_state_write llmProvider "$DPF_RESOLVED_LLM_PROVIDER" 2>/dev/null || true
DPF_RESOLVED_IMAGE_TAG="$(_dpf_env_value DPF_IMAGE_TAG)"
[ -n "$DPF_RESOLVED_IMAGE_TAG" ] && \
  dpf_state_write imageTag "$DPF_RESOLVED_IMAGE_TAG" 2>/dev/null || true

# Ensure the backups host directory exists. Docker refuses to start the
# service if a bind-mount source is missing, and the source now lives
# OUTSIDE the repo so install-time creation is the right place.
BACKUPS_HOST_DIR="${REPO_ROOT}-backups"
if [ ! -d "$BACKUPS_HOST_DIR" ]; then
  mkdir -p "$BACKUPS_HOST_DIR"
  ok "Created backups directory at $BACKUPS_HOST_DIR (outside install root by design)"
fi

# One-time migration: pre-relocation installs wrote backups inside
# ${REPO_ROOT}/backups/. Move them out so the new bind mount sees them.
LEGACY_BACKUPS_DIR="${REPO_ROOT}/backups"
if [ -d "$LEGACY_BACKUPS_DIR" ] && [ -n "$(ls -A "$LEGACY_BACKUPS_DIR" 2>/dev/null)" ]; then
  info "Migrating legacy in-tree backups from $LEGACY_BACKUPS_DIR to $BACKUPS_HOST_DIR"
  for entry in "$LEGACY_BACKUPS_DIR"/* "$LEGACY_BACKUPS_DIR"/.[!.]*; do
    [ -e "$entry" ] || continue
    base="$(basename "$entry")"
    if [ -e "$BACKUPS_HOST_DIR/$base" ]; then
      warn "  Skipped $base: already exists in $BACKUPS_HOST_DIR"
    else
      mv "$entry" "$BACKUPS_HOST_DIR/$base"
    fi
  done
  if [ -z "$(ls -A "$LEGACY_BACKUPS_DIR" 2>/dev/null)" ]; then
    rmdir "$LEGACY_BACKUPS_DIR"
    ok "Legacy in-tree backups migrated to $BACKUPS_HOST_DIR"
  else
    warn "Some entries left in $LEGACY_BACKUPS_DIR (collisions) — review by hand."
  fi
fi

# 9b. Kernel-commandment shell guard (BI-43F95F77).
#     Probe for real-binary paths BEFORE adding safety-bin to PATH, then
#     symlink the guard under each tool name and prepend safety-bin to
#     the operator's shell PATH. Idempotent: re-running the installer
#     does not duplicate PATH entries or symlinks.
step "Kernel-commandment shell guard"
SAFETY_BIN="$REPO_ROOT/safety-bin"
mkdir -p "$SAFETY_BIN"

# Probe each shimmed binary's real path BEFORE PATH manipulation.
{
  echo "# Generated by install-dpf.sh; do not edit. Sourced by dpf-shell-guard.sh."
  for tool in docker git prisma; do
    real="$(command -v "$tool" 2>/dev/null || true)"
    if [ -n "$real" ]; then
      varname="DPF_REAL_$(echo "$tool" | tr '[:lower:]' '[:upper:]')"
      printf '%s=%s\n' "$varname" "$real"
    fi
  done
} > "$SAFETY_BIN/real-binaries.env"

# Copy the guard + static fallback patterns; symlink under each tool name.
cp "$REPO_ROOT/scripts/safety/dpf-shell-guard.sh" "$SAFETY_BIN/"
cp "$REPO_ROOT/scripts/safety/dpf-shell-guard-fallback-patterns.json" "$SAFETY_BIN/"
chmod +x "$SAFETY_BIN/dpf-shell-guard.sh"
for tool in docker git prisma; do
  ln -sf dpf-shell-guard.sh "$SAFETY_BIN/$tool"
done

# Prepend safety-bin to PATH via an idempotent marker block in shell rc files.
PROFILE_MARKER_BEGIN="# >>> dpf-safety-bin >>>"
PROFILE_MARKER_END="# <<< dpf-safety-bin <<<"
PROFILE_BLOCK="$PROFILE_MARKER_BEGIN
export PATH=\"$SAFETY_BIN:\$PATH\"
$PROFILE_MARKER_END"

for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -e "$rc" ] || continue
  if ! grep -q "$PROFILE_MARKER_BEGIN" "$rc" 2>/dev/null; then
    printf '\n%s\n' "$PROFILE_BLOCK" >> "$rc"
    info "Added dpf-safety-bin marker block to $rc"
  fi
done

# Export for the current installer process AND child docker-compose etc.
export PATH="$SAFETY_BIN:$PATH"

ok "Shell guard installed at $SAFETY_BIN"
info "  Open a new terminal for the PATH change to take effect in other shells."

# 9c. Customer mode pulls pre-built GHCR images (parity with the Windows
#     consumer path). During early access those images may require a (free)
#     GitHub login. Probe once and point the operator at `docker login`
#     rather than letting `compose up` fail with an opaque manifest error.
#     We never create accounts or store credentials on the operator's behalf.
if [ "$DPF_INSTALL_MODE" = "customer" ]; then
  step "Release image availability"
  if docker pull ghcr.io/opendigitalproductfactory/dpf-portal:latest >/dev/null 2>&1; then
    ok "Release images reachable"
    dpf_report_image_identity ghcr.io/opendigitalproductfactory/dpf-portal:latest
  else
    warn "Could not pull the pre-built platform image."
    info "  During early access the images need a free GitHub login:"
    info "    docker login ghcr.io"
    info "  Then re-run install-dpf.sh. (Contributor mode builds from source instead.)"
  fi
fi

# 10. Bring up the platform-aware compose stack. Per the doctrine's
#     Contract 9: the entrypoint is provider-aware, so model pulls
#     happen inside portal-init using whatever DPF_LLM_PROVIDER
#     resolves to (Docker Model Runner on Docker Desktop; Ollama on
#     Linux native Docker via docker-compose.linux.yml).
if [ -n "$DPF_ORGANIZATION_JOIN_PACKAGE" ]; then
  step "Organization trust"
  bash "$REPO_ROOT/scripts/bootstrap-organization-pki.sh" \
    --mode join --join-package "$DPF_ORGANIZATION_JOIN_PACKAGE" --no-start-tls
  export DPF_ORGANIZATION_TRUST_ENABLED=1
  dpf_compose_files "$DPF_MODE"
  ok "Organization HTTPS trust configured; the one-time package was consumed"
fi

step "Bringing up the platform"
# Stamp the build with the current commit so /ops/self-upgrade can compare the
# running image to the upgrade target. Contributor mode builds from local
# source; without this the Dockerfile falls back to a content hash that can
# never match a git-SHA target, leaving freshness checks inert. Customer mode
# pulls CI-stamped images, so we leave DPF_VERSION unset there (the host
# checkout SHA is unrelated to the pulled image and would mislabel DEPLOYED_SHA).
if [ "$DPF_INSTALL_MODE" = "contributor" ] && [ -d .git ]; then
  if DPF_VERSION="$(git rev-parse HEAD 2>/dev/null)" && [ -n "$DPF_VERSION" ]; then
    export DPF_VERSION
    ok "Stamping local build with DPF_VERSION=$DPF_VERSION"
  fi
  # Real platform version from git release tags (e.g. "5.6.0"); shown in the
  # portal instead of the stale version.json baseline.
  # BI-145214F0 — refresh tags first. A long-running install whose local tag
  # cache stopped at e.g. v5.6.0 while upstream cut v6.0..v6.4 will otherwise
  # silently bake the wrong release-line label into the portal image (the SHA
  # stamp above stays honest; only the human-readable describe falls back to
  # the nearest old tag and counts every new commit forward). Best-effort: an
  # offline / network fetch failure must not abort the install.
  git fetch --tags --force origin 2>/dev/null || true
  if DPF_PLATFORM_VERSION="$(git describe --tags --always 2>/dev/null | sed 's/^v//')" && [ -n "$DPF_PLATFORM_VERSION" ]; then
    export DPF_PLATFORM_VERSION
    ok "Stamping local build with DPF_PLATFORM_VERSION=$DPF_PLATFORM_VERSION"
  fi
fi
# Non-critical sidecars (e.g. dpf-stt voice STT) pull from third-party
# registries whose mutable tags get pruned upstream: hwdsl2/whisper-server
# re-pushes :latest and prunes the prior index digest, so a pinned digest
# eventually 404s ("manifest unknown"). A single such failure would otherwise
# abort the WHOLE `docker compose up`, taking the portal/db/redis down with it
# (#1767). Pre-pull them with failure tolerated and, if one is unavailable,
# scale it to 0 so the core platform still comes up — voice degrades, the
# install does not. Nothing depends_on these sidecars, so scaling to 0 is safe.
_noncritical_sidecars="dpf-stt"
_scale_args=()
for _svc in $_noncritical_sidecars; do
  if dpf_capability_service_required "$_svc" && ! docker compose "${DPF_COMPOSE_FILES[@]}" pull "$_svc" >/dev/null 2>&1; then
    warn "Optional sidecar '$_svc' image is unavailable upstream; bringing up the platform without it."
    info "  Voice features needing '$_svc' stay inactive until its image returns; re-run install-dpf.sh to retry."
    _scale_args+=(--scale "$_svc=0")
  fi
done
if [ "${#_scale_args[@]}" -gt 0 ]; then
  docker compose "${DPF_COMPOSE_FILES[@]}" up -d "${_scale_args[@]}"
else
  docker compose "${DPF_COMPOSE_FILES[@]}" up -d
fi
ok "docker compose up returned"

# 10b. Voice / TTS sidecar (Linux hosts with an NVIDIA GPU).
#      Spoken output uses the bundled dpf-tts container, but it's behind the
#      `tts` compose profile (and carries an NVIDIA deploy reservation), so a
#      plain `up` never starts it — leaving voice silent out of the box. Start
#      it here so a fresh customer install speaks, per
#      bundled-services-active-by-default. We only enable it when an NVIDIA GPU
#      with >=6 GB VRAM is detected: the deploy reservation would fail on a
#      GPU-less host, and the CPU tier is ~10-30x slower (no fast CPU path like
#      the Mac's native MPS sidecar). Guarded + non-fatal so a missing
#      nvidia-container runtime can't abort the install (set -euo pipefail).
#      Skipped on macOS, which uses the native-host sidecar above.
if [ "$DPF_PLATFORM" != "darwin" ]; then
  _tts_vram="$(printf '%s' "${DPF_HOST_PROFILE:-}" | sed -nE 's/.*"vramGB"[[:space:]]*:[[:space:]]*([0-9]+(\.[0-9]+)?).*/\1/p')"
  if dpf_capability_service_required dpf-tts && [ -n "$_tts_vram" ] && awk 'BEGIN{exit !('"$_tts_vram"' >= 6)}' 2>/dev/null; then
    step "Voice / TTS sidecar (NVIDIA GPU)"
    if docker compose "${DPF_COMPOSE_FILES[@]}" up -d dpf-tts; then
      ok "Voice TTS container started (dpf-tts) — spoken output works out of the box"
    else
      warn "dpf-tts failed to start (NVIDIA container runtime / GPU issue?); voice output will stay silent."
      info "  Inspect: docker compose ${DPF_COMPOSE_FILES[*]} logs dpf-tts"
    fi
  elif dpf_capability_service_required dpf-tts; then
    info "Voice TTS sidecar skipped (no NVIDIA GPU >=6 GB VRAM detected); STT still works."
    info "  Enable later (CPU tier or managed API): see docs/install/linux.md → Voice."
  else
    info "Voice TTS is inactive by capability selection."
  fi
fi

# 11. Wait for /api/health (or DPF_HEALTH_TIMEOUT seconds, default 300).
step "Health check"
HEALTH_TIMEOUT="${DPF_HEALTH_TIMEOUT:-300}"
HEALTH_URL="${DPF_HEALTH_URL:-http://localhost:3000/api/health}"
elapsed=0
interval=5
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
  if curl --silent --max-time 5 --output /dev/null --fail "$HEALTH_URL" 2>/dev/null; then
    ok "Portal is healthy at $HEALTH_URL (took ${elapsed}s)"
    HEALTH_OK=1
    break
  fi
  sleep "$interval"
  elapsed=$((elapsed + interval))
  if [ "$((elapsed % 30))" = "0" ]; then
    info "  Still waiting for $HEALTH_URL ... (${elapsed}s / ${HEALTH_TIMEOUT}s)"
  fi
done

if [ "${HEALTH_OK:-0}" != "1" ]; then
  warn "Portal did not become healthy within ${HEALTH_TIMEOUT}s."
  info "  Inspect: bash install-dpf.sh doctor"
  info "  Or:      docker compose ${DPF_COMPOSE_FILES[*]} logs portal --tail 100"
  exit 1
fi

# 12. Edge Node bootstrap. Mint an auto-approve bootstrap token, wire
#     it into .env, and restart the edge-node container so it enrolls.
#     Per spec § Approval policy: tokens issued by the local installer
#     auto-approve at enrollment, so the operator doesn't have to click
#     Approve in Admin > Platform Development for the host's own node.
dpf_native_edge_converge() {
  local token="${1:-}"
  if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
    dpf_native_edge_install "$REPO_ROOT" "$token" "${HOSTNAME:-$(hostname -s 2>/dev/null || echo dpf-macos)}"
  else
    docker compose "${DPF_COMPOSE_FILES[@]}" up -d --no-deps --force-recreate edge-node >/dev/null 2>&1
  fi
}

if [ "$DPF_INCLUDE_EDGE" = "1" ]; then
  step "Edge Node convergence"

  # Machine identity lives in the protected native state directory. Once it
  # exists, upgrades reuse it and never mint another one-time enrollment token.
  # A missing state file is the only condition that enters bootstrap issuance.
  EDGE_NATIVE_STATE="${DPF_STATE_DIR:-$HOME/.dpf}/edge-node/state.json"
  if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && [ -f "$EDGE_NATIVE_STATE" ]; then
    if dpf_native_edge_converge ""; then
      if [ -f "$REPO_ROOT/docker-compose.edge.yml" ]; then
        docker compose -f docker-compose.yml -f docker-compose.edge.yml stop edge-node >/dev/null 2>&1 || true
      fi
      ok "Native Edge Node converged; existing machine identity preserved"
      info "  Check this installation's readiness in Platform > Edge Nodes."
    else
      warn "Native Edge Node convergence failed; the portal remains healthy."
    fi
  else

  # Mint a single-use auto-approve token. The script connects to
  # DATABASE_URL=postgresql://...@postgres:5432/dpf, which is only
  # resolvable from inside the docker compose network — postgres is NOT
  # published to the host on customer installs (docker-compose.dev.yml is
  # the only overlay that publishes 5432, and it's contributor-only). So
  # we run the script INSIDE the portal-init container via `docker compose
  # run --rm`, which shares the network and has the full workspace +
  # tsx available at /workspace.
  #
  # The portal-init container's normal entrypoint runs migrations; we
  # override with `sh -c '<tsx invocation>'` to run just the token script.
  # Stderr is captured into a logfile (NOT swallowed with 2>/dev/null) so
  # the next install diagnosis bundle has the actual failure reason
  # instead of an opaque "output not recognized" warn line.
  #
  # History: prior versions ran `pnpm --filter web exec tsx ...` from the
  # HOST, which always failed with ECONNREFUSED on customer installs (no
  # exposed postgres port). The error was hidden by `2>/dev/null`, causing
  # the edge-node container to crashloop indefinitely with an empty
  # DPF_BOOTSTRAP_TOKEN. See edge-node Phase 0 first-mac postmortem.
  EDGE_TOKEN_LOG="${TMPDIR:-/tmp}/dpf-edge-token-$$.log"
  if EDGE_TOKEN="$(docker compose "${DPF_COMPOSE_FILES[@]}" run --rm --no-deps \
       --entrypoint "" portal-init \
       sh -c 'cd /workspace/apps/web && /workspace/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve' \
       2>"$EDGE_TOKEN_LOG" | grep -E '^dpfboot_' | tail -1)"; then
    if [ -z "$EDGE_TOKEN" ] || [[ "$EDGE_TOKEN" != dpfboot_* ]]; then
      warn "Edge Node bootstrap-token issuance produced no token. Stderr captured at $EDGE_TOKEN_LOG"
      info "  Last 5 lines:"
      tail -5 "$EDGE_TOKEN_LOG" 2>/dev/null | sed 's|^|    |' >&2 || true
      info "  You can re-issue manually via Admin > Platform Development > Edge Nodes."
    else
      # Append (or replace) DPF_BOOTSTRAP_TOKEN in .env so the
      # edge-node container picks it up on next restart. Idempotent:
      # successive installer runs replace the prior token.
      if grep -q "^DPF_BOOTSTRAP_TOKEN=" .env 2>/dev/null; then
        dpf_sed_inplace "s|^DPF_BOOTSTRAP_TOKEN=.*|DPF_BOOTSTRAP_TOKEN=$EDGE_TOKEN|" .env
      else
        printf '\n# Edge Node bootstrap token — installer-issued, auto-approve.\n' >> .env
        printf 'DPF_BOOTSTRAP_TOKEN=%s\n' "$EDGE_TOKEN" >> .env
      fi
      # Same for the operator-friendly node name so the admin UI shows
      # something descriptive instead of the container hostname.
      if ! grep -q "^DPF_EDGE_NODE_NAME=" .env 2>/dev/null; then
        printf 'DPF_EDGE_NODE_NAME=%s\n' "${HOSTNAME:-$(hostname 2>/dev/null || echo edge-node-local)}" >> .env
      fi

      # Docker Desktop does not expose macOS host multicast interfaces to the
      # Linux VM. Install the Go Edge Node as a supervised host process there;
      # Linux retains the container runtime.
      if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
        if dpf_native_edge_converge "$EDGE_TOKEN"; then
          if [ -f "$REPO_ROOT/docker-compose.edge.yml" ]; then
            docker compose -f docker-compose.yml -f docker-compose.edge.yml stop edge-node >/dev/null 2>&1 || true
          fi
          ok "Native Edge Node bootstrapped on the macOS host"
          info "  The node enrolls within ~10s; check Platform > Connections."
        else
          warn "Native Edge Node installation failed; the portal remains healthy."
        fi
      elif dpf_native_edge_converge "$EDGE_TOKEN"; then
        ok "Edge Node bootstrapped — auto-approve token wired into .env"
        info "  The node enrolls within ~10s; check Admin > Platform Development > Edge Nodes."
      else
        warn "edge-node container restart failed; node may not have enrolled."
        info "  Inspect: docker compose ${DPF_COMPOSE_FILES[*]} logs edge-node --tail 50"
      fi
    fi
  else
    warn "Edge Node bootstrap-token issuance command failed. Stderr captured at $EDGE_TOKEN_LOG"
    info "  Last 5 lines:"
    tail -5 "$EDGE_TOKEN_LOG" 2>/dev/null | sed 's|^|    |' >&2 || true
    info "  You can re-issue manually via Admin > Platform Development > Edge Nodes."
  fi
  # Clean up the stderr capture on the happy path; the warn branches above
  # already printed the relevant tail so the logfile's diagnostic value is
  # exhausted.
  if [ -n "${EDGE_TOKEN:-}" ] && [[ "$EDGE_TOKEN" == dpfboot_* ]]; then
    rm -f "$EDGE_TOKEN_LOG" 2>/dev/null || true
  fi
  fi
else
  info "Edge Node not bundled (opt-in; pass --with-edge to add a local node). Map a network from another machine via Admin > Platform Development > Edge Nodes (docker-compose.edge-standalone.yml)."
fi

# 13. Voice / TTS sidecar (Apple Silicon only).
#     Spoken output (text-to-speech) needs hardware-accelerated synthesis, but
#     Docker Desktop on macOS can't reach the Apple Neural Engine — so on Apple
#     Silicon the TTS engine runs as a native-host sidecar (port 8771) instead
#     of in a container. The docker-compose.macos.yml overlay is already wired
#     to talk to it (TTS_PROVIDER=mlx, DPF_TTS_URL=host.docker.internal:8771);
#     we just provision the sidecar here so a fresh customer install speaks out
#     of the box (zero-click-provider-setup / bundled-services-active-by-default)
#     rather than transcribing silently until the user runs the script by hand.
#     Mirrors the contributor path in scripts/setup.sh. Idempotent — safe to
#     re-run. Failure is non-fatal: the rest of the install still completes and
#     we point the operator at the manual command. Linux/Windows installs use
#     the dpf-tts Docker container instead, so skip there.
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  step "Voice / TTS sidecar (Apple Silicon)"
  # Invoke via `bash <script>` (never execute the .sh directly — Windows git
  # drops the exec bit and the script's own shebang can't be relied on across
  # clones). Stderr is intentionally NOT swallowed so a failure leaves a
  # diagnosable trail, matching the Edge Node bootstrap above.
  if bash "$REPO_ROOT/scripts/tts/setup-chatterbox-tts-macos.sh" \
       --data-root "$REPO_ROOT/data/uploads"; then
    # The script provisions the launchd sidecar; wire the matching .env values
    # the portal container needs to reach it, only if not already present
    # (idempotent — successive installer runs don't duplicate the keys).
    if ! grep -qE "^TTS_PROVIDER=" .env 2>/dev/null; then
      printf '\n# Voice / TTS (Apple Silicon — written by install-dpf.sh)\n' >> .env
      printf 'TTS_PROVIDER=mlx\n' >> .env
      printf 'DPF_TTS_URL=http://host.docker.internal:8771\n' >> .env
      printf 'DPF_TTS_REFERENCE_HOST_ROOT=%s/data/uploads\n' "$REPO_ROOT" >> .env
      # Keep UPLOAD_STORAGE_PATH in sync so the DB seed (seedPlatformVoice) and
      # portal resolve the same final host-visible uploads root that the TTS
      # sidecar was provisioned against. This ensures the "voice profile in the
      # build" (the bundled founder clip for mark-dpf-platform) lands in the
      # exact location the sidecar will read via DPF_TTS_REFERENCE_HOST_ROOT.
      if ! grep -qE "^UPLOAD_STORAGE_PATH=" .env 2>/dev/null; then
        printf 'UPLOAD_STORAGE_PATH=%s/data/uploads\n' "$REPO_ROOT" >> .env
      fi
    fi
    ok "Voice TTS sidecar provisioned — spoken output works out of the box (port 8771)"
  else
    warn "TTS sidecar setup failed; coworkers will transcribe but stay silent until you run:"
    info "  bash scripts/tts/setup-chatterbox-tts-macos.sh"
  fi
else
  info "Voice TTS sidecar skipped (Linux/Windows uses the bundled dpf-tts Docker container)."
fi

# 14. Persist successful install state.
dpf_state_write lastSuccessfulInstallVersion "$DPF_INSTALLER_VERSION" 2>/dev/null || true
dpf_state_write lastHealthCheck "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null || true
node "$REPO_ROOT/scripts/installer/validate-install-state.mjs" "$(dpf_state_path)" || fail "Install state is not upgrade-ready"

# 15. Autostart unit (LaunchAgent on macOS, systemd-user unit on Linux).
#     Gated by --no-autostart for operators who manage their own.
if [ "$DPF_AUTOSTART" = "1" ]; then
  step "Autostart"
  dpf_autostart_install "$REPO_ROOT" "${DPF_COMPOSE_FILES[*]}" "$REPO_ROOT/scripts/installer"
else
  info "Skipping autostart install (--no-autostart)."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
printf '%b  Install complete!%b\n' "${DPF_GREEN:-}" "${DPF_NC:-}"
echo ""
echo "  Portal:        $HEALTH_URL"
echo "  Login:         admin@dpf.local"
echo "  Password:      see ADMIN_PASSWORD in .env"
echo ""
echo "  Lifecycle:"
echo "    bash install-dpf.sh doctor         Generate a diagnostic bundle"
echo "    bash dpf-start.sh                   Start the stack"
echo "    bash dpf-stop.sh                    Stop the stack"
echo "    bash dpf-reinstall.sh              Clean reinstall (destructive)"
echo "    bash dpf-release.sh --bump minor   Tag and push a release"
echo "    docker compose ${DPF_COMPOSE_FILES[*]} logs -f"
echo "    docker compose ${DPF_COMPOSE_FILES[*]} down"
echo ""
echo "  Autostart: $(if [ "$DPF_AUTOSTART" = "1" ]; then echo "enabled (will start at login / boot)"; else echo "DISABLED (run install-dpf.sh again without --no-autostart to enable)"; fi)"
echo ""
exit 0
