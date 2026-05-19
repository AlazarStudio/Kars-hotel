# kars-hotel — Backend

NestJS 10 + TypeScript (strict) + Prisma 5 + PostgreSQL 16 + Redis 7. Multi-tenant SaaS PMS.

## Стек (на этапе фазы A)

- **NestJS 10** — modular framework
- **TypeScript 5** strict mode
- **Prisma 5** — ORM (init на шаге A.5)
- **PostgreSQL 16** + **Redis 7** + **MinIO** + **Mailhog** — через `docker-compose.dev.yml` (на шаге A.4)
- ESLint + Prettier
- Jest для unit/e2e тестов

## Структура

```
backend/
├── src/
│   ├── main.ts                 (entry: NestFactory, listen :3001)
│   ├── app.module.ts           (root module)
│   ├── app.controller.ts       (placeholder, заменим на HealthController в A.3)
│   └── app.service.ts
├── test/
│   └── jest-e2e.json
├── package.json
├── tsconfig.json               (strict)
├── tsconfig.build.json
├── nest-cli.json
├── .eslintrc.cjs
├── .prettierrc
└── .gitignore
```

## Команды

```bash
pnpm install           # установка зависимостей
pnpm run start:dev     # dev режим с hot reload, http://localhost:3001
pnpm run build         # production build
pnpm run start:prod    # запуск из dist/
pnpm run lint          # ESLint
pnpm run format        # Prettier
pnpm run test          # unit-тесты
pnpm run test:e2e      # E2E тесты
pnpm run test:cov      # coverage
```

## Прогресс фазы A (Bootstrap backend)

- [x] **A.1**: Scaffold NestJS 10 + TypeScript strict + ESLint + Prettier
- [ ] **A.2**: Зависимости (config, swagger, pino, zod, helmet, class-validator)
- [ ] **A.3**: HealthController + Swagger /api/docs
- [ ] **A.4**: docker-compose.dev.yml (Postgres, Redis, MinIO, Mailhog)
- [ ] **A.5**: Prisma init (datasource + generator)
- [ ] **A.6**: .env.example, Makefile
- [ ] **A.7**: запуск стека + проверка /health = 200
