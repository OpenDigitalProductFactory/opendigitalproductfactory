# ADP MCP server — standalone Node 20 service.
# Not a pnpm-workspace member; has its own dep tree so it stays portable for Hive publication.

FROM node:20-alpine AS deps
WORKDIR /app
COPY services/adp/package.json ./
RUN corepack enable && pnpm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/adp/package.json services/adp/tsconfig.json ./
COPY services/adp/src ./src
RUN corepack enable && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY services/adp/package.json ./
USER node
EXPOSE 8600
CMD ["node", "dist/server.js"]
