import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"));

test("readiness contract is non-mutating and reports every required dependency", async () => {
  const script = await readFile(resolve(root, "scripts/promote.sh"), "utf8");
  const block = script.slice(script.indexOf("if [[ $_readiness -eq 1 ]]"), script.indexOf("[[ $_self_upgrade -eq 1 ]]"));
  for (const code of [
    "contract_unreadable", "entrypoint_unavailable", "docker_unavailable",
    "source_mount_unreadable", "target_sha_missing", "health_url_missing",
    "state_mount_unreadable", "install_state_invalid",
    "capability_projection_failed", "compose_identity_missing",
    "recovery_parent_unavailable", "transition_secret_parent_unavailable",
    "promoter_build_context_incomplete", "release_identity_invalid",
  ]) assert.match(block, new RegExp(code));
  assert.match(block, /"quiescenceBegan":false/);
  assert.match(block, /validate-install-state\.mjs.*\$_state_file/s);
  assert.match(block, /DPF_PROMOTER_DOCKER_PREFLIGHT/);
  assert.match(block, /command -v docker/);
  assert.match(block, /docker --version/);
  assert.doesNotMatch(block, /-w "\$_state_dir"/);
  assert.doesNotMatch(block, /docker compose (?:down|up)|docker stop|docker rm|cp .*install-state/);
});

test("the build-context probe reads COPY sources from the candidate's own Dockerfile", async () => {
  // Hard-coding the list would go stale the first time someone adds a COPY, and
  // the failure mode of a stale list is silence — the probe would pass while the
  // build fails on the file it did not know to check.
  const script = await readFile(resolve(root, "scripts/promote.sh"), "utf8");
  assert.match(script, /PROMOTE_SOURCE.*Dockerfile\.promoter/s);
  assert.match(script, /awk .*\/\^COPY \//);
  // It must name EVERY missing path, not stop at the first: BuildKit reports one
  // per attempt, so a first-only probe just moves the guessing game.
  assert.match(script, /_missing_context\[\*\]/);
});

test("the probe's COPY parser sees every COPY source in Dockerfile.promoter", async () => {
  const dockerfile = await readFile(resolve(root, "Dockerfile.promoter"), "utf8");
  // Mirror of the awk in promote.sh: every whitespace-separated argument of a
  // COPY except the flags and the final destination.
  const parsed = dockerfile
    .split(/\r?\n/)
    .filter((line) => line.startsWith("COPY "))
    .flatMap((line) => line.split(/\s+/).slice(1, -1).filter((a) => !a.startsWith("--")));

  // Dockerfile.promoter intentionally copies the scripts closure as one
  // directory so an N-1 caller does not have to predict candidate file names.
  // promoter-build-context.test.mjs separately proves that closure contains
  // every contract-required file.
  assert.deepEqual(parsed, ["promoter-contract.json", "Dockerfile", "scripts/"]);
  for (const source of parsed) {
    assert.doesNotMatch(source, /^--/, `flag leaked into COPY sources: ${source}`);
    assert.doesNotMatch(source, /^\//, `destination leaked into COPY sources: ${source}`);
  }
});
