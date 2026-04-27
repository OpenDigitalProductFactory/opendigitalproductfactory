# ADP MCP server — standalone Node 24 service.
# The runtime ships as its own container, but it consumes
# packages/integration-shared as a local file dependency during the image build.
#
# Node 24 is required: undici@8.x calls webidl.util.markAsUncloneable, which
# was added in Node 22. Keep this aligned with the portal/promoter/sandbox
# images so a single Node major governs the whole stack.

FROM node:24-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/adp ./services/adp
COPY packages/integration-shared ./packages/integration-shared
WORKDIR /app/packages/integration-shared
RUN node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); pkg.main = './dist/index.js'; pkg.types = './dist/index.d.ts'; pkg.scripts = { ...(pkg.scripts ?? {}), build: 'tsc' }; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');" \
  && corepack enable \
  && pnpm install --no-frozen-lockfile \
  && pnpm build
WORKDIR /app/services/adp
RUN node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); pkg.dependencies['@dpf/integration-shared'] = 'file:../../packages/integration-shared'; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');" \
  && corepack enable \
  && pnpm install --no-frozen-lockfile \
  && pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/adp/dist ./dist
COPY --from=build /app/services/adp/node_modules ./node_modules
COPY services/adp/package.json ./package.json
USER node
EXPOSE 8600
CMD ["node", "dist/server.js"]
