#!/usr/bin/env bash
# Open Digital Product Factory — first-time setup script (Mac / Linux)
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ! $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}→ $1${NC}"; }

echo ""
echo "  Open Digital Product Factory — Setup"
echo "  ====================================="

# ── Prerequisites ───────────────────────────────────────────────────────────

step "Checking prerequisites"

if ! command -v docker &>/dev/null; then
  fail "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
fi
ok "Docker found: $(docker --version | cut -d' ' -f3 | tr -d ',')"

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Download from https://nodejs.org/ (v20 or newer)"
fi
NODE_VERSION=$(node -v | tr -d 'v' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js v20+ required. Current: $(node -v). Download from https://nodejs.org/"
fi
ok "Node.js found: $(node -v)"

if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Installing..."
  npm install -g pnpm
fi
ok "pnpm found: $(pnpm -v)"

# ── Dependencies ─────────────────────────────────────────────────────────────

step "Installing dependencies"
pnpm install
ok "Dependencies installed"

# ── Environment ───────────────────────────────────────────────────────────────

step "Setting up environment"

if [ ! -f apps/web/.env.local ]; then
  cp .env.example apps/web/.env.local
  # Generate AUTH_SECRET
  AUTH_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change-me-$(date +%s)")
  sed -i "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET|" apps/web/.env.local
  # Generate CREDENTIAL_ENCRYPTION_KEY
  ENC_KEY=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change-me-$(date +%s)")
  sed -i "s|<generate with: openssl rand -hex 32>|$ENC_KEY|" apps/web/.env.local
  # Enable Docker internal URL for Ollama
  echo "OLLAMA_INTERNAL_URL=http://ollama:11434" >> apps/web/.env.local
  ok "Created apps/web/.env.local with generated secrets"
else
  ok "apps/web/.env.local already exists -- skipping"
fi

if [ ! -f packages/db/.env ]; then
  cp .env.example packages/db/.env
  ok "Created packages/db/.env"
fi

# Ensure root .env has real secrets for Docker Compose
if [ ! -f .env ]; then
  cp .env.docker.example .env
  AUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())" 2>/dev/null)
  ENC_KEY=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null)
  sed -i "s|<generate with: openssl rand -base64 32>|$AUTH_SECRET|" .env
  sed -i "s|<generate with: openssl rand -hex 32>|$ENC_KEY|" .env
  ok "Created root .env with generated secrets"
fi

# ── Databases ─────────────────────────────────────────────────────────────────

step "Starting services (PostgreSQL + Neo4j + Ollama)"
docker compose up -d

echo "  Building promoter image (for autonomous deployments)..."
if docker compose --profile promote build promoter >/dev/null 2>&1; then
  ok "Promoter image built"
else
  warn "Promoter image build failed (non-fatal -- can be built later)"
fi

echo "  Waiting for PostgreSQL to be ready..."
RETRIES=30
until docker compose exec -T postgres pg_isready -U dpf -q 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -eq 0 ]; then
    fail "PostgreSQL did not start in time. Check: docker compose logs postgres"
  fi
  sleep 2
done
ok "PostgreSQL is ready"

echo "  Waiting for Ollama... (first run may take a few minutes to download default model)"
RETRIES=90
until docker compose exec -T ollama curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -eq 0 ]; then
    fail "Ollama did not start in time. Check: docker compose logs ollama"
  fi
  sleep 2
done
ok "Ollama is ready"

# ── Database Setup ────────────────────────────────────────────────────────────

step "Running database migrations"
pnpm db:migrate
ok "Migrations complete"

step "Seeding database"
pnpm db:seed
ok "Database seeded with roles, agents, and default admin user"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}  Setup complete!${NC}"
echo ""
echo "  Start the app:  pnpm dev   (or: make dev)"
echo "  Open:           http://localhost:3000"
echo ""
echo "  Default login:"
echo "    Email:    admin@dpf.local"
echo "    Password: changeme123"
echo ""
echo "  Change the password before any non-local deployment."
echo ""
