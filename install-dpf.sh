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

# Installer version (semver-ish; bump per release).
DPF_INSTALLER_VERSION="2026.05.11-phase10a"

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
  --no-edge     Skip bundling the Edge Node container alongside the
                Authority Core. Use this for cloud / Authority-only
                deployments where Edge Nodes will be added later from
                separate hosts (docker-compose.edge-standalone.yml).
                Default: Edge Node IS bundled for single-host installs.
                The bundled node auto-approves at enrollment per spec
                § Approval policy.
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
DPF_INCLUDE_EDGE="${DPF_INCLUDE_EDGE:-1}"   # 1 = bundle Edge Node; 0 = skip
SUBCOMMAND=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)              DPF_DRY_RUN=1 ;;
    --headless)             DPF_HEADLESS=1; export DPF_HEADLESS ;;
    --release)              DPF_MODE="release"; DPF_MODE_EXPLICIT=1 ;;
    --dev)                  DPF_MODE="dev"; DPF_MODE_EXPLICIT=1 ;;
    --customer)             DPF_INSTALL_MODE="customer" ;;
    --contributor)          DPF_INSTALL_MODE="contributor" ;;
    --no-autostart)         DPF_AUTOSTART=0 ;;
    --no-edge)              DPF_INCLUDE_EDGE=0 ;;
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
  2) info "No prior install state; initializing $(dpf_state_path)"
     dpf_state_init "$DPF_INSTALLER_VERSION" "$REPO_ROOT" ;;
  3) warn "Install state is from an older installer; running forward migration"
     dpf_state_migrate ;;
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
if DPF_HOST_PROFILE_JSON="$(pnpm --filter @dpf/db exec tsx scripts/detect-hardware-host.ts 2>/dev/null)"; then
  export DPF_HOST_PROFILE="$DPF_HOST_PROFILE_JSON"
  DPF_SELECTED_MODEL="$(printf '%s' "$DPF_HOST_PROFILE_JSON" | sed -nE 's/.*"selectedModel"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  if [ -n "$DPF_SELECTED_MODEL" ]; then
    ok "Hardware profile detected — selected AI model: $DPF_SELECTED_MODEL"
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
      warn "Docker Model Runner did not become ready within 30s. The model pull may fail."
    fi

    if [ -n "$DPF_SELECTED_MODEL" ]; then
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
      _selected_repo_tag="$(printf '%s' "$DPF_SELECTED_MODEL" | sed 's|^ai/||')"
      if docker model list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$_selected_repo_tag"; then
        ok "Model $DPF_SELECTED_MODEL already on disk"
      else
        info "Pulling AI model $DPF_SELECTED_MODEL via Docker Model Runner..."
        info "  This may take several minutes depending on your internet speed."
        if docker model pull "$DPF_SELECTED_MODEL" 2>&1 | grep -v "^Downloaded"; then
          ok "AI Coworker model ready: $DPF_SELECTED_MODEL"
        else
          warn "Model pull may have failed. You can retry later: docker model pull $DPF_SELECTED_MODEL"
        fi
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
  ok ".env created with generated secrets"
  info "  Admin password: $ADMIN_PW_VAL"
  info "  (Stored in .env; change before any non-local deployment)"
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
fi
docker compose "${DPF_COMPOSE_FILES[@]}" up -d
ok "docker compose up returned"

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
if [ "$DPF_INCLUDE_EDGE" = "1" ]; then
  step "Edge Node bootstrap"

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

      # Restart the edge-node service so it picks up the new env. The
      # service was started in step 10 but enrolled with no token (or
      # a stale one); recreate-without-deps avoids touching the portal.
      if docker compose "${DPF_COMPOSE_FILES[@]}" up -d --no-deps --force-recreate edge-node >/dev/null 2>&1; then
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
else
  info "Edge Node bundling skipped (--no-edge). Add Edge Nodes later from separate hosts via docker-compose.edge-standalone.yml."
fi

# 13. Persist successful install state.
dpf_state_write lastSuccessfulInstallVersion "$DPF_INSTALLER_VERSION" 2>/dev/null || true
dpf_state_write lastHealthCheck "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null || true

# 14. Autostart unit (LaunchAgent on macOS, systemd-user unit on Linux).
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
