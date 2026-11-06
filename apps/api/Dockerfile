FROM node:22-alpine
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @cartographie/api...
COPY . .
RUN pnpm --filter @cartographie/api exec prisma generate
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
