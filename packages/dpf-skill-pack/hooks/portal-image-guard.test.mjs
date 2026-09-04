import assert from "node:assert/strict";
import test from "node:test";

import { decide, writtenTags } from "./portal-image-guard.mjs";

const blocks = (command, env) => decide({ command, env }).block;

// ── the commands that actually happened ──────────────────────────────────────

test("blocks the exact hand-rebuild that overwrote the canonical image", () => {
  // 2026-08-22: run three times, destroying the previous dpf-portal:latest.
  assert.equal(blocks("docker build -t dpf-portal:latest ."), true);
});

test("blocks retagging an existing image onto the canonical name", () => {
  // The same destruction without a build — only the TARGET tag matters.
  assert.equal(blocks("docker tag dpf-portal:scratch dpf-portal:latest"), true);
  assert.equal(blocks("docker image tag abc123 dpf-portal:latest"), true);
});

test("blocks a compose build that writes the canonical tag without naming it", () => {
  // The tag lives in the compose file, so the command never says dpf-portal.
  assert.equal(blocks("docker compose -p dpf build portal"), true);
  assert.equal(blocks("docker compose -p dpf build"), true, "no operand builds everything");
});

test("blocks regardless of quoting", () => {
  assert.equal(blocks('docker build -t "dpf-portal:latest" .'), true);
  assert.equal(blocks("docker build --tag='dpf-portal:latest' ."), true);
  assert.equal(blocks("docker build --tag=dpf-portal:latest ."), true);
});

// ── what must stay possible: the diagnostic loop ─────────────────────────────

test("allows building under a non-canonical tag — inspection is not the harm", () => {
  assert.equal(blocks("docker build -t dpf-portal:scratch ."), false);
  assert.equal(blocks("docker build -t dpf-portal:my-experiment ."), false);
  assert.equal(blocks("docker build -t portal-test ."), false);
});

test("allows any build on an isolated compose project", () => {
  assert.equal(blocks("docker compose -p dpf-mytopic build portal"), false);
  assert.equal(blocks("COMPOSE_PROJECT_NAME=dpf-mytopic docker compose build portal"), false);
});

test("allows compose builds of other services on the root project", () => {
  assert.equal(blocks("docker compose -p dpf build sandbox"), false);
});

test("allows reads and non-build docker work", () => {
  for (const cmd of [
    "docker ps",
    "docker logs dpf-portal-1",
    "docker images | grep portal",
    "docker pull dpf-portal:latest",
  ]) {
    assert.equal(blocks(cmd), false, cmd);
  }
});

// ── the governed path must never be blocked ──────────────────────────────────

test("never blocks the sanctioned scripts — they ARE the governed path", () => {
  for (const cmd of [
    "sh scripts/promote.sh",
    "bash scripts/redeploy-portal.sh",
    "node scripts/self-upgrade/run.mjs",
  ]) {
    assert.equal(blocks(cmd), false, cmd);
  }
});

test("honours the recorded install/recovery bypass", () => {
  assert.equal(
    blocks("docker build -t dpf-portal:latest .", { DPF_ALLOW_PORTAL_IMAGE_BUILD: "1" }),
    false,
  );
});

// ── failing safe ─────────────────────────────────────────────────────────────

test("an empty or junk command is allowed, never wedged", () => {
  assert.equal(blocks(""), false);
  assert.equal(blocks(undefined), false);
  assert.equal(blocks("echo hello"), false);
});

test("the deny carries the governed alternative, not just a refusal", () => {
  const { reason } = decide({ command: "docker build -t dpf-portal:latest ." });
  assert.match(reason, /self-upgrade/, "must name the sanctioned path");
  assert.match(reason, /dev-portal-lease\.sh claim/, "must offer the preview route");
  assert.match(reason, /non-canonical tag|NON-canonical/i, "must offer the local-inspect route");
});

// ── tag extraction ───────────────────────────────────────────────────────────

test("writtenTags reads -t, --tag and docker tag targets", () => {
  assert.deepEqual(writtenTags("docker build -t a:1 ."), ["a:1"]);
  assert.deepEqual(writtenTags("docker build --tag b:2 ."), ["b:2"]);
  assert.deepEqual(writtenTags("docker build -t a:1 -t b:2 ."), ["a:1", "b:2"]);
  assert.deepEqual(writtenTags("docker tag src:1 dst:2"), ["dst:2"], "source is not written");
});
