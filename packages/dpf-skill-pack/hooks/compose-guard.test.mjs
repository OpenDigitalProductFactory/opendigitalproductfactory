import assert from "node:assert/strict";
import { test } from "node:test";

import { decide, findComposeArgs, parseComposeArgs } from "./compose-guard.mjs";

// ── the incident vector ──────────────────────────────────────────────────────

test("blocks a bare root-project `docker compose up -d` (the 2026-06-23 vector)", () => {
  const v = decide({ command: "docker compose up -d", env: {} });
  assert.equal(v.block, true);
  assert.match(v.reason, /data revert|stale or wrong volume/i);
});

test("blocks `docker compose up -d postgres` on the root project", () => {
  assert.equal(decide({ command: "docker compose up -d postgres", env: {} }).block, true);
});

test("blocks the docker-compose v1 form too", () => {
  assert.equal(decide({ command: "docker-compose up -d", env: {} }).block, true);
});

test("blocks even inside a compound command", () => {
  assert.equal(decide({ command: "cd /d/DPF && docker compose up -d", env: {} }).block, true);
});

// ── governed / isolated paths stay allowed ───────────────────────────────────

test("allows the redeploy/promoter path (--no-deps portal portal-init)", () => {
  const cmd = "docker compose up -d --no-deps --force-recreate portal-init portal";
  assert.equal(decide({ command: cmd, env: {} }).block, false);
});

test("allows an explicit isolated project via -p", () => {
  assert.equal(decide({ command: "docker compose -p dpf-routing-fix up -d", env: {} }).block, false);
});

test("allows an inline COMPOSE_PROJECT_NAME assignment for a worktree", () => {
  assert.equal(decide({ command: "COMPOSE_PROJECT_NAME=dpf-topic docker compose up -d", env: {} }).block, false);
});

test("allows when the ambient env already isolates the project", () => {
  assert.equal(decide({ command: "docker compose up -d", env: { COMPOSE_PROJECT_NAME: "dpf-topic" } }).block, false);
});

test("allows build / plain down / ps on the root project (not the revert vector)", () => {
  assert.equal(decide({ command: "docker compose build portal", env: {} }).block, false);
  assert.equal(decide({ command: "docker compose down", env: {} }).block, false);
  assert.equal(decide({ command: "docker compose ps", env: {} }).block, false);
});

// ── destructive down ─────────────────────────────────────────────────────────

test("blocks `docker compose down -v` on the root project", () => {
  assert.equal(decide({ command: "docker compose down -v", env: {} }).block, true);
  assert.equal(decide({ command: "docker compose down --volumes", env: {} }).block, true);
});

// ── bypass overrides ─────────────────────────────────────────────────────────

test("inline recovery override unblocks a root `up`", () => {
  assert.equal(decide({ command: "DPF_ALLOW_ROOT_COMPOSE_UP=1 docker compose up -d", env: {} }).block, false);
});

test("env recovery override unblocks a root `up`", () => {
  assert.equal(decide({ command: "docker compose up -d", env: { DPF_ALLOW_ROOT_COMPOSE_UP: "1" } }).block, false);
});

test("DPF_ALLOW_DESTRUCTIVE_COMPOSE unblocks down -v", () => {
  assert.equal(
    decide({ command: "DPF_ALLOW_DESTRUCTIVE_COMPOSE=1 docker compose down -v", env: {} }).block,
    false,
  );
});

// ── non-compose / noise ──────────────────────────────────────────────────────

test("ignores non-compose commands", () => {
  assert.equal(decide({ command: "docker ps", env: {} }).block, false);
  assert.equal(decide({ command: "ls -la && echo done", env: {} }).block, false);
  assert.equal(decide({ command: "", env: {} }).block, false);
});

// ── parser units ─────────────────────────────────────────────────────────────

test("findComposeArgs skips leading env assignments and sudo", () => {
  assert.deepEqual(findComposeArgs(["FOO=bar", "docker", "compose", "up"]), ["up"]);
  assert.deepEqual(findComposeArgs(["sudo", "docker-compose", "down"]), ["down"]);
  assert.equal(findComposeArgs(["ls", "-la"]), null);
});

test("parseComposeArgs extracts project, command, and args", () => {
  const i = parseComposeArgs(["-p", "dpf-x", "-f", "a.yml", "up", "-d", "postgres"]);
  assert.equal(i.projectName, "dpf-x");
  assert.equal(i.command, "up");
  assert.deepEqual(i.commandArgs, ["-d", "postgres"]);
});
