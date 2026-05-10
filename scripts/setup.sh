#!/usr/bin/env bash
# Open Digital Product Factory — contributor setup (macOS / Linux).
#
# Brings a fresh clone up to "ready to run pnpm dev / make dev" on macOS
# or Linux. Companion to scripts/setup.ps1 (Windows). Per the deployment
# doctrine (Contract 3: lifecycle), this is the **contributor bootstrap**
# surface — distinct from `install-dpf.sh` (the end-user release installer
# that lands in installer-parity Phase 6/7).
#
# What this script does:
#   1. Verifies prerequisites (Docker, Node 20+, pnpm)
#   2. Configures in-repo git hooks
#   3. Installs pnpm workspace dependencies
#   4. Generates apps/web/.env.local and root .env from examples (with
#      portable in-place sed and openssl/python3 secret generation)
#   5. Brings up the contributor compose stack (Postgres + Neo4j + Qdrant)
#   6. Waits for Postgres readiness and runs Prisma migrations + seed
#   7. Verifies the agent rulebook (AGENTS.md + pointer files) is intact
#
# What this script does NOT do:
#   - Install Docker, Node, or pnpm. Manual prereqs (per the contributor
#     contract); fully-automated host bootstrap is install-dpf.sh's job
#     when Phase 6/7 lands.
#   - Wait for Ollama. The LLM provider contract (Doctrine Contract 9 +
#     installer-parity Phase 4) is provider-aware: Docker Model Runner
#     by default on Mac/Windows Docker Desktop; Ollama-in-compose only
#     on Linux native Docker once docker-compose.linux.yml lands in
#     Phase 3. Today's compose has no `ollama` service — waiting for
#     it would deadlock on a fresh install.
#   - Configure auto-start, hardware detection, install-state.json, or
#     dpf doctor — those are install-dpf.sh territory.

set -euo pipefail

# Resolve the repo root from this script's location so it works regardless
# of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Source shared helpers.
# shellcheck source=installer/lib/logging.sh
. "$SCRIPT_DIR/installer/lib/logging.sh"
# shellcheck source=installer/lib/platform.sh
. "$SCRIPT_DIR/installer/lib/platform.sh"
# shellcheck source=installer/lib/prompts.sh
. "$SCRIPT_DIR/installer/lib/prompts.sh"

dpf_platform
dpf_arch

echo ""
echo "  Open Digital Product Factory - Contributor Setup"
echo "  ================================================="
echo "  Platform: $DPF_PLATFORM ($DPF_ARCH)"

# ── Prerequisites ───────────────────────────────────────────────────────────

step "Checking prerequisites"

if [ "$DPF_PLATFORM" = "unsupported" ]; then
  fail "Unsupported OS: $(uname -s). This script targets macOS and Linux. Use scripts/setup.ps1 on Windows."
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is not installed. Install Docker Desktop (macOS) or Docker Engine (Linux)."
fi
ok "Docker found: $(docker --version | cut -d' ' -f3 | tr -d ',')"

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Install Node 20+ from https://nodejs.org/"
fi
NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js v20+ required. Current: $(node -v). Install from https://nodejs.org/"
fi
ok "Node.js found: $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found. Installing via npm..."
  npm install -g pnpm
fi
ok "pnpm found: $(pnpm -v)"

# ── Git hooks ────────────────────────────────────────────────────────────────

step "Configuring in-repo git hooks (.githooks/)"
if git config core.hooksPath .githooks; then
  ok "Git hooks path set to .githooks (Prisma migration guard enabled)"
else
  warn "Could not set core.hooksPath. Run 'git config core.hooksPath .githooks' manually."
fi

# ── Dependencies ─────────────────────────────────────────────────────────────

step "Installing pnpm workspace dependencies"
pnpm install
ok "Dependencies installed"

# ── Environment ───────────────────────────────────────────────────────────────

step "Generating environment files"

if [ ! -f apps/web/.env.local ]; then
  cp .env.example apps/web/.env.local
  AUTH_SECRET_VAL="$(dpf_random_secret_hex 32)"
  ENC_KEY_VAL="$(dpf_random_secret_hex 32)"
  dpf_sed_inplace "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET_VAL|" apps/web/.env.local
  dpf_sed_inplace "s|<generate with: openssl rand -hex 32>|$ENC_KEY_VAL|" apps/web/.env.local
  ok "Created apps/web/.env.local with generated secrets"
else
  ok "apps/web/.env.local already exists -- skipping"
fi

if [ ! -f .env ]; then
  cp .env.docker.example .env
  AUTH_SECRET_VAL="$(dpf_random_secret_b64 32)"
  ENC_KEY_VAL="$(dpf_random_secret_hex 32)"
  ADMIN_PW_VAL="$(dpf_random_secret_hex 16)"
  dpf_sed_inplace "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET_VAL|" .env
  dpf_sed_inplace "s|<generate with: openssl rand -hex 32>|$ENC_KEY_VAL|" .env
  dpf_sed_inplace "s|<set a strong password>|$ADMIN_PW_VAL|" .env
  # Default the host-install path to the repo root so docker-compose
  # bind-mounts resolve. Operator can override post-setup.
  dpf_sed_inplace "s|<set to absolute path of this directory on the host>|$REPO_ROOT|" .env
  ok "Created root .env with generated secrets"
else
  ok "root .env already exists -- skipping"
fi

# ── Compose services ─────────────────────────────────────────────────────────

step "Starting contributor compose stack (Postgres + Neo4j + Qdrant)"
docker compose up -d postgres neo4j qdrant

echo "  Waiting for Postgres to be ready..."
RETRIES=30
until docker compose exec -T postgres pg_isready -U dpf -q 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    fail "Postgres did not become ready in time. Check: docker compose logs postgres"
  fi
  sleep 2
done
ok "Postgres is ready"

# ── Database migrations and seed ─────────────────────────────────────────────

step "Running database migrations"
pnpm db:migrate
ok "Migrations complete"

step "Seeding database"
pnpm db:seed
ok "Database seeded with roles, agents, and default admin user"

# ── Agent rulebook conformance ───────────────────────────────────────────────
# Per AGENTS.md: every install must ship the canonical AGENTS.md plus pointer
# files for each supported AI tool. Fail the install if any are missing or
# have drifted.

step "Verifying agent rulebook"

if [ ! -f AGENTS.md ]; then
  fail "Canonical agent rulebook missing: AGENTS.md. This install is broken; do not proceed."
fi
ok "Canonical rulebook: AGENTS.md"

POINTERS="CLAUDE.md .cursor/rules/000-load-agents.mdc .clinerules/000-load-agents.md .github/copilot-instructions.md CONVENTIONS.md .continue/rules/000-load-agents.md"
POINTER_COUNT=0
for p in $POINTERS; do
  if [ ! -f "$p" ]; then
    fail "Pointer file missing: $p. Re-clone or restore from main."
  fi
  if ! grep -q "AGENTS.md" "$p"; then
    fail "Pointer file does not reference AGENTS.md: $p. Drift detected."
  fi
  POINTER_COUNT=$((POINTER_COUNT + 1))
done
ok "Pointer files intact: $POINTER_COUNT tools wired to AGENTS.md"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
printf '%b  Setup complete!%b\n' "$DPF_GREEN" "$DPF_NC"
echo ""
echo "  Start the app:  pnpm dev   (or: make dev)"
echo "  Open:           http://localhost:3000"
echo ""
echo "  Default login:"
echo "    Email:    admin@dpf.local"
echo "    Password: see ADMIN_PASSWORD in .env (generated above)"
echo ""
echo "  LLM provider note:"
echo "    The LLM provider contract (Doctrine Contract 9) is provider-aware."
echo "    On macOS Docker Desktop: Docker Model Runner (built-in, 4.40+)."
echo "      bring up the full stack:"
echo "        docker compose -f docker-compose.yml -f docker-compose.macos.yml up -d"
echo "    On Linux native Docker:  Ollama in compose (this overlay also enables"
echo "      cadvisor + node-exporter via the linux-monitoring profile):"
echo "        docker compose -f docker-compose.yml -f docker-compose.linux.yml \\\\"
echo "          --profile linux-monitoring up -d"
echo "    On any host: point LLM_BASE_URL at an external endpoint via .env."
echo "    See docs/superpowers/specs/2026-05-09-deployment-contracts.md"
echo ""
echo "  Change the admin password before any non-local deployment."
echo ""
