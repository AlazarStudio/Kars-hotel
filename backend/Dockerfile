# syntax=docker/dockerfile:1
# Kars Hotel PMS — API. Контекст сборки: каталог backend.
#   docker build -f backend/Dockerfile -t karshotel/api ./backend
ARG NODE_VERSION=22-alpine

# --- сборка: полный набор зависимостей, компиляция, клиент Prisma ---
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# --dangerously-allow-all-builds: свежий pnpm блокирует postinstall-скрипты
# (Prisma без них не скачает движок) и считает это ошибкой сборки.
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds
COPY . .
# Клиент генерируется НА СБОРКЕ и уезжает в образ: генерация на старте
# контейнера требовала бы прав на запись в node_modules и добавляла отказ в
# путь, где его быть не должно.
RUN pnpm exec prisma generate
RUN pnpm run build

# --- запуск: только собранное и рабочие зависимости ---
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
# Движку Prisma на Alpine нужны системные библиотеки — без них
# libquery_engine-linux-musl не загружается (поймано первым запуском).
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --dangerously-allow-all-builds
# Схема нужна в образе: миграции накатываются `prisma migrate deploy` при
# развёртывании, и без неё команда не соберёт историю.
COPY prisma ./prisma
# Клиент генерируется здесь же, в runner: под pnpm сгенерированный клиент
# живёт внутри виртуального стора (.pnpm/…), и копирование node_modules/.prisma
# из builder-стадии — npm-раскладка, которой у pnpm просто нет.
RUN pnpm exec prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 3001
# Вход — dist/src/main.js: tsconfig захватывает prisma/ и scripts/, поэтому
# rootDir поднимается до корня и сборка вкладывается в dist/src.
CMD ["node", "dist/src/main"]
