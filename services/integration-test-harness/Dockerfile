FROM node:20-alpine AS deps
WORKDIR /app
COPY services/integration-test-harness/package.json ./
RUN corepack enable && pnpm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/integration-test-harness/package.json services/integration-test-harness/tsconfig.json ./
COPY services/integration-test-harness/src ./src
COPY services/integration-test-harness/vendors ./vendors
RUN corepack enable && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY services/integration-test-harness/vendors ./dist/vendors
COPY services/integration-test-harness/package.json ./
USER node
EXPOSE 8700
CMD ["node", "dist/src/harness.js"]
