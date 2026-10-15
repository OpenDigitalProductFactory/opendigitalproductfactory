import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePatchedDependencies,
  isDockerignored,
  parseStages,
  checkPatchContext,
  isDockerfileName,
  findDockerfiles,
  findUnfrozenInstalls,
  checkFrozenLockfile,
  ROOT_CONTEXT_DOCKERFILES,
} from "./check-docker-patch-context.mjs";

const WORKSPACE_WITH_PATCH = `packages:
  - apps/*
patchedDependencies:
  image-size@1.2.1: patches/image-size@1.2.1.patch
overrides:
  lodash: 4.17.21
`;

function scaffold(files) {
  const root = mkdtempSync(join(tmpdir(), "patch-context-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

test("parses patchedDependencies and stops at the next top-level key", () => {
  const entries = parsePatchedDependencies(WORKSPACE_WITH_PATCH);
  assert.deepEqual(entries, [
    { spec: "image-size@1.2.1", patchPath: "patches/image-size@1.2.1.patch" },
  ]);
});

test("returns empty when no patchedDependencies block exists", () => {
  assert.deepEqual(parsePatchedDependencies("packages:\n  - apps/*\n"), []);
});

test("dockerignore matching understands prefixes, globs and negations", () => {
  assert.equal(isDockerignored("patches/a.patch", "node_modules\n"), false);
  assert.equal(isDockerignored("patches/a.patch", "patches\n"), true);
  assert.equal(isDockerignored("patches/a.patch", "patches/\n"), true);
  assert.equal(isDockerignored("patches/a.patch", "**/*.patch\n"), true);
  assert.equal(
    isDockerignored("patches/a.patch", "patches\n!patches/\n"),
    false,
  );
});

test("stage parsing records inheritance, workdir, copies and installs", () => {
  const stages = parseStages(`FROM node:24-alpine AS base
WORKDIR /app
FROM base AS deps
COPY pnpm-workspace.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile
FROM deps AS build
RUN pnpm install --frozen-lockfile
`);
  assert.deepEqual(
    stages.map((s) => s.name),
    ["base", "deps", "build"],
  );
  assert.equal(stages[1].parent, "base");
  assert.equal(stages[1].runsPnpmInstall, true);
  assert.equal(stages[2].copies.length, 0);
  assert.equal(stages[2].runsPnpmInstall, true);
});

test("line continuations do not hide a pnpm install", () => {
  const stages = parseStages(`FROM node AS a
WORKDIR /app
RUN pnpm \\
  install --frozen-lockfile
`);
  assert.equal(stages[0].runsPnpmInstall, true);
});

// --- End-to-end: the exact regression from PR #4321 -------------------------

const DOCKERFILE_MISSING_COPY = `FROM node:24-alpine AS base
WORKDIR /app
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile
`;

const DOCKERFILE_FIXED = `FROM node:24-alpine AS base
WORKDIR /app
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile
FROM deps AS build
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile
`;

test("fails when an installing stage never COPYs the patch directory", () => {
  const root = scaffold({
    "pnpm-workspace.yaml": WORKSPACE_WITH_PATCH,
    "patches/image-size@1.2.1.patch": "diff --git a b\n",
    ".dockerignore": "node_modules\n",
    Dockerfile: DOCKERFILE_MISSING_COPY,
  });
  try {
    const result = checkPatchContext(root);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /stage `deps` runs `pnpm install`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("passes once deps COPYs patches, and credits inheriting stages", () => {
  const root = scaffold({
    "pnpm-workspace.yaml": WORKSPACE_WITH_PATCH,
    "patches/image-size@1.2.1.patch": "diff --git a b\n",
    ".dockerignore": "node_modules\n",
    Dockerfile: DOCKERFILE_FIXED,
  });
  try {
    const result = checkPatchContext(root);
    assert.equal(result.ok, true, result.problems.join("\n"));
    // `build` is FROM deps and inherits /app/patches — it must not be flagged.
    assert.ok(result.checkedStages.includes("Dockerfile:build"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when the patch file is declared but absent", () => {
  const root = scaffold({
    "pnpm-workspace.yaml": WORKSPACE_WITH_PATCH,
    ".dockerignore": "",
    Dockerfile: DOCKERFILE_FIXED,
  });
  try {
    const result = checkPatchContext(root);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when .dockerignore excludes the patch directory", () => {
  const root = scaffold({
    "pnpm-workspace.yaml": WORKSPACE_WITH_PATCH,
    "patches/image-size@1.2.1.patch": "diff\n",
    ".dockerignore": "node_modules\npatches\n",
    Dockerfile: DOCKERFILE_FIXED,
  });
  try {
    const result = checkPatchContext(root);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /excluded by \.dockerignore/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when the runtime bootstrap installs without carrying patches", () => {
  const root = scaffold({
    "pnpm-workspace.yaml": WORKSPACE_WITH_PATCH,
    "patches/image-size@1.2.1.patch": "diff\n",
    ".dockerignore": "",
    Dockerfile: DOCKERFILE_FIXED,
    "docker-entrypoint.sh":
      'cp /app/pnpm-workspace.yaml "$WORKSPACE/"\ncd "$WORKSPACE" && pnpm install --frozen-lockfile\n',
  });
  try {
    const result = checkPatchContext(root);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /never copies patches\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("passes when the runtime bootstrap copies patches alongside the manifests", () => {
  const root = scaffold({
    "pnpm-workspace.yaml": WORKSPACE_WITH_PATCH,
    "patches/image-size@1.2.1.patch": "diff\n",
    ".dockerignore": "",
    Dockerfile: DOCKERFILE_FIXED,
    "docker-entrypoint.sh":
      'cp -r /app/patches "$WORKSPACE/"\ncp /app/pnpm-workspace.yaml "$WORKSPACE/"\ncd "$WORKSPACE" && pnpm install --frozen-lockfile\n',
  });
  try {
    const result = checkPatchContext(root);
    assert.equal(result.ok, true, result.problems.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Frozen lockfile in every image install -----------------------------------

test("recognises Dockerfile names and skips their dockerignore files", () => {
  assert.equal(isDockerfileName("Dockerfile"), true);
  assert.equal(isDockerfileName("Dockerfile.promoter"), true);
  assert.equal(isDockerfileName("Dockerfile.probe"), true);
  assert.equal(isDockerfileName("tools.Dockerfile"), true);
  assert.equal(isDockerfileName("Dockerfile.promoter.dockerignore"), false);
  assert.equal(isDockerfileName(".dockerignore"), false);
  assert.equal(isDockerfileName("docker-compose.yml"), false);
});

test("flags --no-frozen-lockfile, including across a line continuation", () => {
  const problems = findUnfrozenInstalls(
    "FROM node:24-alpine\nRUN corepack enable && pnpm install --filter dpf-edge-node... \\\n    --no-frozen-lockfile --ignore-scripts\n",
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /turns frozen-lockfile off/);
});

test("flags every spelling that switches frozen-lockfile off", () => {
  for (const line of [
    "RUN pnpm install --frozen-lockfile=false",
    "RUN pnpm install --config.frozen-lockfile=false",
    "ENV npm_config_frozen_lockfile=false",
    "ENV PNPM_FROZEN_LOCKFILE false",
  ]) {
    assert.equal(findUnfrozenInstalls(`FROM x\n${line}\n`).length, 1, line);
  }
});

test("flags a bare pnpm install and a pnpm i without --frozen-lockfile", () => {
  assert.equal(findUnfrozenInstalls("FROM x\nRUN pnpm install\n").length, 1);
  assert.equal(findUnfrozenInstalls("FROM x\nRUN corepack enable && pnpm i --prod\n").length, 1);
});

test("checks each && segment on its own", () => {
  const problems = findUnfrozenInstalls(
    "FROM x\nRUN pnpm install --frozen-lockfile && cd tools && pnpm install\n",
  );
  assert.equal(problems.length, 1);
});

test("passes frozen installs and ignores comments and non-install pnpm commands", () => {
  const text = [
    "FROM node:24-alpine AS build",
    "# It used to run `pnpm install --no-frozen-lockfile` here.",
    "RUN pnpm install --filter dpf-adp-mcp... --frozen-lockfile --ignore-scripts",
    "RUN pnpm install --frozen-lockfile --offline --filter \"@dpf/db...\" --config.confirmModulesPurge=false",
    "RUN pnpm --filter dpf-adp-mcp build",
    "RUN pnpm --config.allowUnusedPatches=true deploy --filter dpf-adp-mcp --prod --legacy /app/deploy",
    "RUN npm install -g some-cli",
  ].join("\n");
  assert.deepEqual(findUnfrozenInstalls(text), []);
});

test("walks nested Dockerfiles, skipping node_modules", () => {
  const root = scaffold({
    Dockerfile: "FROM x\nRUN pnpm install --frozen-lockfile\n",
    "services/svc/Dockerfile": "FROM x\nRUN pnpm install --no-frozen-lockfile\n",
    "services/svc/Dockerfile.dockerignore": "node_modules\n",
    "node_modules/pkg/Dockerfile": "FROM x\nRUN pnpm install\n",
  });
  try {
    assert.deepEqual(findDockerfiles(root), ["Dockerfile", "services/svc/Dockerfile"]);
    const result = checkFrozenLockfile(root);
    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /^services\/svc\/Dockerfile turns frozen-lockfile off/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the patch check covers the service images built from the repo root", () => {
  for (const dockerfile of [
    "services/adp/Dockerfile",
    "services/edge-node/Dockerfile",
    "services/integration-test-harness/Dockerfile",
  ]) {
    assert.ok(ROOT_CONTEXT_DOCKERFILES.includes(dockerfile), dockerfile);
  }
});

test("every Dockerfile in the repository installs with a frozen lockfile", () => {
  const result = checkFrozenLockfile(process.cwd());
  assert.ok(result.checked.includes("services/edge-node/Dockerfile"));
  assert.equal(result.ok, true, result.problems.join("\n"));
});

// --- The live repo must satisfy its own guard ------------------------------

test("the repository as committed passes the guard", () => {
  const result = checkPatchContext(process.cwd());
  assert.equal(result.ok, true, result.problems.join("\n"));
});
