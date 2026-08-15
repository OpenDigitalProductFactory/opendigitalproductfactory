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

// --- The live repo must satisfy its own guard ------------------------------

test("the repository as committed passes the guard", () => {
  const result = checkPatchContext(process.cwd());
  assert.equal(result.ok, true, result.problems.join("\n"));
});
