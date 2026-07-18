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
    "state_mount_unwritable", "install_state_invalid",
    "capability_projection_failed", "compose_identity_missing",
    "recovery_parent_unavailable", "transition_secret_parent_unavailable",
  ]) assert.match(block, new RegExp(code));
  assert.match(block, /"quiescenceBegan":false/);
  assert.doesNotMatch(block, /docker compose (?:down|up)|docker stop|docker rm|cp .*install-state/);
});
