FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile --filter mathboard-backend...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
RUN pnpm --filter mathboard-backend build
RUN pnpm deploy --filter mathboard-backend --prod --legacy /prod/backend

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /prod/backend ./
EXPOSE 3001
CMD ["node", "dist/main.js"]
