# syntax=docker/dockerfile:1
# Kars Hotel PMS — API. Контекст сборки: каталог backend.
#   docker build -f backend/Dockerfile -t karshotel/api ./backend
ARG NODE_VERSION=22-alpine

# --- сборка: полный набор зависимостей, компиляция, клиент Prisma ---
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Клиент генерируется НА СБОРКЕ и уезжает в образ: генерация на старте
# контейнера требовала бы прав на запись в node_modules и добавляла отказ в
# путь, где его быть не должно.
RUN pnpm exec prisma generate
RUN pnpm run build

# --- запуск: только собранное и рабочие зависимости ---
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
# Схема нужна в образе: миграции накатываются `prisma migrate deploy` при
# развёртывании, и без неё команда не соберёт историю.
COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main"]
