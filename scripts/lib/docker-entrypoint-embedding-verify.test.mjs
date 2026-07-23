// BI-A95A4CB7 regression guard.
//
// The post-init embedding-model setup used to echo "OK Embedding model pulled"
// on the pull REQUEST's exit code, which returns 0 even when the download later
// fails or times out. That false success is how an install booted "healthy" with
// no embedding model and the governance kernel silently ran on commandments only
// (BI-512FBD20). The fix re-lists the provider's models after the pull and only
// claims success when the model is actually present.
//
// Static assertions on docker-entrypoint.sh, matching the style of
// docker-entrypoint-source-volume.test.mjs (the entrypoint is a POSIX sh script
// with no runnable unit harness).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const entrypoint = readFileSync(
  new URL("../../docker-entrypoint.sh", import.meta.url),
  "utf8",
);

function functionBody(name) {
  const match = entrypoint.match(new RegExp(`${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} function should exist`);
  return match[1];
}

test("a verify-after-pull helper re-lists the provider's models", () => {
  const body = functionBody("verify_embedding_present");
  // Re-fetches the models listing and greps it — that is what makes success
  // conditional on the model existing rather than on the pull request's exit.
  assert.match(body, /wget/);
  assert.match(body, /grep -q/);
});

test("the false-success echoes are gone — success is never claimed on the pull request's exit code", () => {
  // The old model-runner and ollama branches chained `&& echo OK` directly to
  // the create/pull wget. If either string returns, the regression is back.
  assert.doesNotMatch(
    entrypoint,
    /&&\s*echo\s+"\s*OK Embedding model pulled"/,
    "model-runner branch must verify presence, not echo OK on the create request's exit",
  );
  assert.doesNotMatch(
    entrypoint,
    /&&\s*echo\s+"\s*OK Embedding model pulled \(Ollama\)"/,
    "ollama branch must verify presence, not echo OK on the pull request's exit",
  );
});

test("both auto-pull branches gate their success on verify_embedding_present", () => {
  // Every place that pulls (POSTs to /models/create or /api/pull) must be
  // followed by a verify_embedding_present check before claiming success.
  const pullSites = [...entrypoint.matchAll(/\/(models\/create|api\/pull)"/g)].length;
  assert.ok(pullSites >= 2, "expected the model-runner and ollama pull sites");
  const verifyCalls = [...entrypoint.matchAll(/if verify_embedding_present /g)].length;
  assert.ok(
    verifyCalls >= 2,
    `expected each pull branch to verify presence; found ${verifyCalls} verify calls`,
  );
});

test("the degraded path names the runtime symptom and the fix, and never hard-exits boot", () => {
  // Fail loud, but graceful: the platform surfaces the degradation at query time
  // (BI-512FBD20), so a missing model must not brick container boot.
  assert.match(entrypoint, /STILL NOT present after the pull attempt/);
  assert.match(entrypoint, /docker model pull \$\{EMB_MODEL\}/);
  assert.match(entrypoint, /ollama pull \$\{EMB_MODEL\}/);
});
