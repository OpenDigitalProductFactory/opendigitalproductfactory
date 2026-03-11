.PHONY: setup dev build test typecheck db-seed db-reset db-studio help

# Default target
.DEFAULT_GOAL := help

setup: ## Full first-time setup (install, env, docker, migrate, seed)
	@echo "Installing dependencies..."
	pnpm install
	@if [ ! -f apps/web/.env.local ]; then \
		cp .env.example apps/web/.env.local; \
		echo "Created apps/web/.env.local — edit AUTH_SECRET before deploying."; \
	fi
	@if [ ! -f packages/db/.env ]; then \
		cp .env.example packages/db/.env; \
	fi
	@echo "Starting databases..."
	docker compose up -d
	@echo "Waiting for PostgreSQL to be ready..."
	@until docker compose exec -T postgres pg_isready -U dpf -q; do sleep 1; done
	@echo "Running migrations..."
	pnpm db:migrate
	@echo "Seeding database..."
	pnpm db:seed
	@echo ""
	@echo "Setup complete!"
	@echo "Run 'make dev' to start, then open http://localhost:3000"
	@echo "Default login: admin@dpf.local / changeme123"

dev: ## Start Docker databases and Next.js dev server
	docker compose up -d
	pnpm dev

build: ## Production build
	pnpm build

test: ## Run Vitest test suite
	pnpm test

typecheck: ## TypeScript type check (no emit)
	pnpm typecheck

db-seed: ## Re-seed the database (does not drop existing data)
	pnpm db:seed

db-reset: ## Drop and recreate database, then re-seed
	docker compose down -v
	docker compose up -d
	@until docker compose exec -T postgres pg_isready -U dpf -q; do sleep 1; done
	pnpm db:migrate
	pnpm db:seed

db-studio: ## Open Prisma Studio (visual database browser)
	pnpm db:studio

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
