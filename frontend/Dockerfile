# syntax=docker/dockerfile:1
# Kars Hotel PMS — кабинет. Контекст сборки: каталог frontend.
#   docker build -f frontend/Dockerfile -t karshotel/web ./frontend
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# --dangerously-allow-all-builds: свежий pnpm блокирует postinstall-скрипты
# (Prisma без них не скачает движок) и считает это ошибкой сборки.
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds
COPY . .
# Адрес API вшивается в СБОРКУ: Vite подставляет переменные на этапе сборки, а
# не в браузере. На своём VPS кабинет и API живут на одном домене, поэтому
# умолчание относительное — тогда смена домена не требует пересборки.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm run build

# --- раздача статики. Caddy и так стоит перед контуром, поэтому здесь он же:
#     один веб-сервер на весь стек, а не второй вида nginx рядом.
FROM caddy:2-alpine AS runner
COPY --from=builder /app/dist /srv
COPY Caddyfile.static /etc/caddy/Caddyfile
EXPOSE 8080
