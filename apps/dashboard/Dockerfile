FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/convex/package.json packages/convex/
COPY apps/dashboard/package.json apps/dashboard/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/convex/ packages/convex/
COPY apps/dashboard/ apps/dashboard/

ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}

RUN pnpm --filter @carrier-sales/shared build && \
    pnpm --filter @carrier-sales/dashboard build

FROM nginx:1.27-alpine AS runner

COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

LABEL org.opencontainers.image.title="Carrier Sales Dashboard" \
      org.opencontainers.image.description="React analytics dashboard for HappyRobot carrier sales automation"
