import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  deriveWorktreeComposeProjectName,
  validateComposeSafety,
} from "./compose-safety.mjs";

test("docker-compose project name is environment-scoped with dpf as the root fallback", () => {
  const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");

  assert.match(compose, /^name:\s+\$\{COMPOSE_PROJECT_NAME:-dpf\}\s*$/m);
});

test("integration-test profile refuses the default dpf project", () => {
  const result = validateComposeSafety({
    args: ["--profile", "integration-test", "up", "-d", "--wait", "integration-test-harness"],
    env: {},
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /COMPOSE_PROJECT_NAME/);
});

test("integration-test profile accepts a unique CI project name", () => {
  const result = validateComposeSafety({
    args: ["--profile", "integration-test", "up", "-d", "--wait", "integration-test-harness"],
    env: { COMPOSE_PROJECT_NAME: "dpf-ci-12345-1" },
  });

  assert.equal(result.ok, true);
});

test("down --volumes refuses the default dpf project", () => {
  const result = validateComposeSafety({
    args: ["--profile", "integration-test", "down", "--volumes"],
    env: { COMPOSE_PROJECT_NAME: "dpf" },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /would delete volumes/);
});

test("down -v accepts a named isolated project", () => {
  const result = validateComposeSafety({
    args: ["down", "-v"],
    env: { COMPOSE_PROJECT_NAME: "dpf-worktree-routing-fix" },
  });

  assert.equal(result.ok, true);
});

test("explicit override can run destructive cleanup against the root project", () => {
  const result = validateComposeSafety({
    args: ["down", "--volumes"],
    env: { COMPOSE_PROJECT_NAME: "dpf", DPF_ALLOW_DESTRUCTIVE_COMPOSE: "1" },
  });

  assert.equal(result.ok, true);
});

test("worktree Compose project names are deterministic and dpf-prefixed", () => {
  assert.equal(
    deriveWorktreeComposeProjectName("D:/DPF/.worktrees/runtime-data-safety-guards"),
    "dpf-runtime-data-safety-guards",
  );
  assert.equal(
    deriveWorktreeComposeProjectName("/home/mark/dpf-worktrees/Feature: Capsule Phase 4"),
    "dpf-feature-capsule-phase-4",
  );
});
