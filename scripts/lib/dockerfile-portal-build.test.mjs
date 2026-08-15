import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const dockerignore = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");

test("portal image build uses the default Next builder under Docker", () => {
  assert.match(dockerfile, /pnpm --filter web exec next build/);
  assert.doesNotMatch(dockerfile, /pnpm --filter web exec next build --webpack/);
  assert.doesNotMatch(dockerfile, /NEXT_TURBOPACK_USE_WORKER=0/);
});

test("portal image build reserves enough heap for Next production tracing", () => {
  assert.match(dockerfile, /NODE_OPTIONS="--max-old-space-size=8192"/);
});

test("portal dependency stage includes repository-owned pnpm patches before install", () => {
  assert.match(workspace, /^patchedDependencies:/m, "fixture requires at least one repository-owned patch");
  const patchCopy = dockerfile.indexOf("COPY patches/ ./patches/");
  const frozenInstall = dockerfile.indexOf("RUN pnpm install --frozen-lockfile");

  assert.ok(patchCopy >= 0, "Dockerfile must copy patches/ into the dependency stage");
  assert.ok(patchCopy < frozenInstall, "patches/ must be available before pnpm install reads patchedDependencies");
});

test("runner image carries profession corpus seed assets", () => {
  assert.match(
    dockerfile,
    /COPY --from=init \/app\/docs\/professions \.\/docs\/professions/,
  );
});

test("docker build context includes profession corpus markdown", () => {
  assert.match(dockerignore, /!docs\/professions\/\*\*\/\*\.md/);
});

test("source content hash includes bundled profession corpus assets", () => {
  assert.match(dockerfile, /find \/app\/apps\/web-src \/app\/packages-src \/app\/scripts \/app\/docs\/professions -type f/);
});
