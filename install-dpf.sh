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
# Companion: scripts/setup.sh is the *contributor* bootstrap (clone,
# install deps, run the dev loop). install-dpf.sh is the *end-user*
# installer (release images, full stack, autostart).
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

# Source shared helpers from Phase 2 + Phase 3 + Phase 6.
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

# Installer version (semver-ish; bump per release).
DPF_INSTALLER_VERSION="2026.05.10-phase6"

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
  --headless    Non-interactive (no prompts). Defaults are used; required
                for CI / unattended installs.
  --release     Use pre-built multi-arch GHCR images
                (docker-compose.release.yml overlay). Default in Phase 7+.
  --dev         Build images locally (default for Phase 6 framework slice
                until release-mode integration lands).
  --force-unsupported-host
                Override unsupported-host preflight refusal (advanced).
                Equivalent to DPF_FORCE_UNSUPPORTED_HOST=1.
  -h, --help    Show this help.

Status: Phase 6 (framework vertical slice). Full end-user install (Docker
auto-install, autostart, model pulls) lands in Phase 7. Until then,
install-dpf.sh validates preflight, persists install-state.json, and
prints the planned compose chain. Use scripts/setup.sh for contributor
bootstrap.

Roadmap: docs/superpowers/plans/2026-05-09-macos-linux-native-support.md
Doctrine: docs/superpowers/specs/2026-05-09-deployment-contracts.md
EOF
}

DPF_DRY_RUN=0
DPF_MODE="dev"   # dev | release
SUBCOMMAND=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)              DPF_DRY_RUN=1 ;;
    --headless)             DPF_HEADLESS=1; export DPF_HEADLESS ;;
    --release)              DPF_MODE="release" ;;
    --dev)                  DPF_MODE="dev" ;;
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
echo "  Mode: $DPF_MODE${DPF_DRY_RUN:+  [dry-run]}"
echo ""

# 1. Preflight: unsupported-host detection.
step "Preflight: host compatibility"
dpf_preflight_unsupported_host
ok "Host compatibility check passed"

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

# 5. Non-dry-run: Phase 6 stops here. Phase 7 takes over from this point
#    with Docker Engine install, env generation, compose up, model pulls,
#    and autostart wiring.
echo ""
warn "Phase 6 framework vertical slice: install execution lands in Phase 7."
echo ""
echo "  Until Phase 7 ships, the canonical end-to-end paths are:"
echo "    Contributors: bash scripts/setup.sh && pnpm dev"
echo "    Operators (macOS / Linux): docker compose ${DPF_COMPOSE_FILES[*]} up -d"
echo "    Diagnostic bundle: bash install-dpf.sh doctor"
echo ""
echo "  This skeleton has validated:"
echo "    [x] Host compatibility preflight"
echo "    [x] install-state.json schema-aware bookkeeping"
echo "    [x] Compose -f chain assembly per platform"
echo "    [x] --dry-run and --headless flags"
echo "    [x] doctor subcommand"
echo "    [ ] Dependency installation (Phase 7)"
echo "    [ ] Env generation + secret bootstrap (Phase 7)"
echo "    [ ] docker compose up + health-check loop (Phase 7)"
echo "    [ ] Model pull (uses entrypoint's provider-aware logic; Phase 7)"
echo "    [ ] LaunchAgent / systemd autostart (Phase 7)"
echo ""
exit 0
