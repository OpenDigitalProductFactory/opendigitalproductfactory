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
#   5. Brings up the contributor PostgreSQL dependency
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

# The portal only reads this key through its read-only /dpf-state mount. The
# one-shot promoter receives the host path separately. Rotate only when there
# are no live transition envelopes, because durable receipts are signed by it.
DPF_STATE_DIR_VALUE="${DPF_STATE_DIR:-$HOME/.dpf}"
node scripts/rotate-runtime-transition-secret.mjs --state-dir "$DPF_STATE_DIR_VALUE" --initialize >/dev/null || fail "Runtime transition signing key initialization failed"
ok "Runtime transition signing key is present with owner-only permissions"

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

# PostgreSQL owns relational, vector, and graph persistence.
step "Starting contributor compose stack (Postgres)"
docker compose up -d postgres

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

# ── Edge Node bootstrap ──────────────────────────────────────────────────────
# Mirrors install-dpf.sh's auto-approve flow for contributors. Mints a
# single-use bootstrap token, wires it into .env, force-recreates the
# edge-node service so it enrolls. Spec § Approval policy permits the local
# installer to auto-approve the host's own Edge Node.
#
# Opt-in (BI-72CFF89D / edge-topology design §5): contributor setup no longer
# bundles a local Edge Node by default. Set DPF_INCLUDE_EDGE=1 to bundle +
# auto-enroll one. DPF_SKIP_EDGE_BOOTSTRAP=1 still force-skips even when opted in.
if [ "${DPF_INCLUDE_EDGE:-0}" = "1" ] && [ "${DPF_SKIP_EDGE_BOOTSTRAP:-0}" != "1" ]; then
  step "Edge Node bootstrap"

  # Bring up the Edge Node container alongside whatever overlay is in use.
  # docker-compose.yml + docker-compose.edge.yml is the minimum chain.
  EDGE_COMPOSE_ARGS=("-f" "docker-compose.yml" "-f" "docker-compose.edge.yml")

  # The portal must be reachable for the token mint (Prisma → Postgres) to
  # succeed. We brought up PostgreSQL above but not the portal,
  # so do that now (best-effort; warns instead of failing).
  if docker compose "${EDGE_COMPOSE_ARGS[@]}" up -d portal edge-node >/dev/null 2>&1; then
    HEALTH_URL="http://localhost:3000/api/health"
    HEALTH_OK=0
    for _ in $(seq 1 60); do
      if curl --silent --max-time 5 --fail "$HEALTH_URL" -o /dev/null 2>/dev/null; then
        HEALTH_OK=1
        break
      fi
      sleep 5
    done

    if [ "$HEALTH_OK" = "1" ]; then
      # Run the token-issuing script inside the portal container instead of
      # via host pnpm. The container always has a Prisma client that matches
      # the just-migrated schema, and consumer installs without host Node/pnpm
      # still reach the same code path.
      PORTAL_CONTAINER="$(docker compose "${EDGE_COMPOSE_ARGS[@]}" ps -q portal 2>/dev/null | head -1)"
      if [ -z "$PORTAL_CONTAINER" ]; then PORTAL_CONTAINER="dpf-portal-1"; fi
      if EDGE_TOKEN="$(docker exec "$PORTAL_CONTAINER" sh -c \
           'cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve' \
           2>/dev/null | tail -1)"; then
        if [ -n "$EDGE_TOKEN" ] && [[ "$EDGE_TOKEN" == dpfboot_* ]]; then
          if grep -q "^DPF_BOOTSTRAP_TOKEN=" .env 2>/dev/null; then
            dpf_sed_inplace "s|^DPF_BOOTSTRAP_TOKEN=.*|DPF_BOOTSTRAP_TOKEN=$EDGE_TOKEN|" .env
          else
            printf '\n# Edge Node bootstrap token -- installer-issued, auto-approve.\n' >> .env
            printf 'DPF_BOOTSTRAP_TOKEN=%s\n' "$EDGE_TOKEN" >> .env
          fi
          if ! grep -q "^DPF_EDGE_NODE_NAME=" .env 2>/dev/null; then
            printf 'DPF_EDGE_NODE_NAME=%s\n' "${HOSTNAME:-$(hostname 2>/dev/null || echo edge-node-local)}" >> .env
          fi

          if docker compose "${EDGE_COMPOSE_ARGS[@]}" up -d --no-deps --force-recreate edge-node >/dev/null 2>&1; then
            ok "Edge Node bootstrapped (auto-approve token wired into .env)"
          else
            warn "edge-node container restart failed; check: docker compose ${EDGE_COMPOSE_ARGS[*]} logs edge-node --tail 50"
          fi
        else
          warn "Bootstrap token output not recognized; skipping Edge Node enrollment."
          warn "Re-issue via Admin > Platform Development > Edge Nodes."
        fi
      else
        warn "Bootstrap token issuance failed; skipping Edge Node enrollment."
      fi
    else
      warn "Portal did not become healthy within 5 minutes; skipping Edge Node enrollment."
      warn "Bring it up later: bash scripts/setup.sh (this step is idempotent)."
    fi
  else
    warn "docker compose up -d portal edge-node failed; skipping Edge Node enrollment."
  fi
fi

# ── Voice / TTS sidecar (Apple Silicon only) ─────────────────────────────────
# Provisions the native-host Chatterbox TTS sidecar so voice cloning works
# on macOS without a GPU. Idempotent — safe to re-run. Linux/Windows installs
# use the dpf-tts Docker container instead; skip this step there.

if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  step "Provisioning Chatterbox TTS sidecar (Apple Silicon)"
  if bash scripts/tts/setup-chatterbox-tts-macos.sh \
       --data-root "$(pwd)/data/uploads" 2>/dev/null; then
    # The script prints the .env values it needs; wire them in if not set.
    if ! grep -qE "^TTS_PROVIDER=" .env 2>/dev/null; then
      printf '\n# Voice / TTS (Apple Silicon — written by setup.sh)\n' >> .env
      printf 'TTS_PROVIDER=mlx\n' >> .env
      printf 'DPF_TTS_URL=http://host.docker.internal:8771\n' >> .env
      printf 'DPF_TTS_REFERENCE_HOST_ROOT=%s/data/uploads\n' "$(pwd)" >> .env
    fi
    ok "Chatterbox TTS sidecar provisioned (port 8771)"
  else
    warn "TTS sidecar setup failed. Voice cloning will not work until you run:"
    warn "  bash scripts/tts/setup-chatterbox-tts-macos.sh"
  fi
else
  ok "TTS sidecar (skipped — Linux/Windows uses the dpf-tts Docker container)"
fi

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

# ── Worktree hygiene defaults (BI-5F4F0146) ───────────────────────────────────
# Register the worktree janitor on a schedule so merged+clean worktrees are reaped
# automatically. Unreaped, they accumulate into the hundreds; each carries a real
# node_modules tree, and the OS file indexer (Spotlight on macOS) then thrashes the
# host — starving the portal/inference VM. On macOS, also keep the worktree base
# out of Spotlight. All best-effort: a hygiene step must never fail contributor setup.
WT_BASE="$(cd "$REPO_ROOT/.." && pwd)/dpf-worktrees"
mkdir -p "$WT_BASE" 2>/dev/null || true
if bash "$SCRIPT_DIR/install-worktree-janitor-schedule.sh" --live --tier-a-only >/dev/null 2>&1; then
  ok "Worktree janitor scheduled (daily, merged+clean only)"
else
  warn "Could not schedule the worktree janitor (non-fatal): bash scripts/install-worktree-janitor-schedule.sh --live --tier-a-only"
fi
if [ "$(uname -s)" = "Darwin" ]; then
  # mdutil -i off does not work on a subfolder; the .metadata_never_index hint is
  # the no-privilege mechanism, and the Privacy list is the authoritative one.
  touch "$WT_BASE/.metadata_never_index" 2>/dev/null || true
  ok "Placed a Spotlight no-index hint at the worktree base"
  warn "For a full Spotlight exclusion (needs admin): add '$WT_BASE' under System Settings > Spotlight > Privacy."
fi

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
echo "    On Linux native Docker:  Ollama, cadvisor, and node-exporter in compose:"
echo "        docker compose -f docker-compose.yml -f docker-compose.linux.yml up -d"
echo "    On any host: point LLM_BASE_URL at an external endpoint via .env."
echo "    See docs/superpowers/specs/2026-05-09-deployment-contracts.md"
echo ""
echo "  Change the admin password before any non-local deployment."
echo ""
