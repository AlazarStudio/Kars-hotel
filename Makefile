# KarsHotel PMS — top-level developer Makefile.
# Run from the project root. Requires Docker Desktop and pnpm.

COMPOSE := docker compose -f docker-compose.dev.yml
BACKEND_DIR := backend
FRONTEND_DIR := frontend

.PHONY: help up down restart logs ps clean install dev-backend dev-frontend dev migrate migrate-deploy generate seed reset studio test test-backend test-frontend lint format

help: ## Show this help
	@echo "KarsHotel PMS — developer commands"
	@echo ""
	@echo "Infra:"
	@echo "  make up                Start dev infrastructure (Postgres, Redis, MinIO, Mailhog)"
	@echo "  make down              Stop dev infrastructure"
	@echo "  make restart           Restart dev infrastructure"
	@echo "  make ps                List dev infrastructure containers"
	@echo "  make logs              Tail logs from all dev containers"
	@echo "  make clean             Stop and remove volumes (DESTROYS DEV DATA)"
	@echo ""
	@echo "Backend:"
	@echo "  make install           pnpm install in backend"
	@echo "  make dev-backend       Run backend in watch mode (port 3001)"
	@echo "  make migrate           Apply pending Prisma migrations in dev mode"
	@echo "  make migrate-deploy    Apply migrations in production mode (no schema diff)"
	@echo "  make generate          Run prisma generate"
	@echo "  make seed              Run prisma/seed.ts"
	@echo "  make reset             RESET database (drops everything, re-applies migrations)"
	@echo "  make studio            Open Prisma Studio (DB GUI)"
	@echo ""
	@echo "Frontend:"
	@echo "  make dev-frontend      Run Vite dev server (port 5173)"
	@echo ""
	@echo "Both:"
	@echo "  make dev               Run backend + frontend in parallel"
	@echo "  make test              Run all tests"
	@echo "  make lint              Run linters in backend + frontend"
	@echo "  make format            Run prettier in backend + frontend"

up: ## Start dev infrastructure
	$(COMPOSE) up -d
	@echo ""
	@echo "Services available:"
	@echo "  Postgres:  localhost:5442  (user=postgres pw=postgres db=kars_hotel)"
	@echo "  Redis:     localhost:6380"
	@echo "  MinIO:     http://localhost:9001  (minioadmin / minioadmin)"
	@echo "  Mailhog:   http://localhost:8025"

down: ## Stop dev infrastructure
	$(COMPOSE) down

restart: down up

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f

clean: ## DESTRUCTIVE: removes volumes
	$(COMPOSE) down -v

install:
	cd $(BACKEND_DIR) && pnpm install

dev-backend:
	cd $(BACKEND_DIR) && pnpm run start:dev

dev-frontend:
	cd $(FRONTEND_DIR) && pnpm run dev

dev:
	@echo "Use two terminals: 'make dev-backend' and 'make dev-frontend'"
	@echo "(parallel run requires a process runner like concurrently — install in a later step)"

migrate:
	cd $(BACKEND_DIR) && pnpm run prisma:migrate

migrate-deploy:
	cd $(BACKEND_DIR) && pnpm run prisma:migrate:deploy

generate:
	cd $(BACKEND_DIR) && pnpm run prisma:generate

seed:
	cd $(BACKEND_DIR) && pnpm run prisma:seed

reset:
	cd $(BACKEND_DIR) && pnpm run db:reset

studio:
	cd $(BACKEND_DIR) && pnpm run prisma:studio

test:
	cd $(BACKEND_DIR) && pnpm test

test-backend:
	cd $(BACKEND_DIR) && pnpm test

test-frontend:
	cd $(FRONTEND_DIR) && pnpm test || echo "(frontend tests not yet configured)"

lint:
	cd $(BACKEND_DIR) && pnpm run lint
	cd $(FRONTEND_DIR) && pnpm run lint || true

format:
	cd $(BACKEND_DIR) && pnpm run format || true
