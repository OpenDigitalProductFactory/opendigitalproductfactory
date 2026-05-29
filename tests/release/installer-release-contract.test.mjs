import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const RETIRED_STT_DIGEST =
  "hwdsl2/whisper-server@sha256:4b4f3747242bc4be9c7a0a6d2160fef0a957813cf08574e0058841aba630dbd7";
const CURRENT_STT_DIGEST =
  "hwdsl2/whisper-server@sha256:de379f0727e4c6b64bfb1be5c0c1c66bda215beb6a3e8e0c5d63061c73e9ec3b";
const MANIFEST_GUARD =
  "node scripts/release/verify-compose-image-manifests.mjs --mode release --platform linux --only digest-pinned";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("default STT sidecar uses the current reachable multi-arch image digest", () => {
  const compose = read("docker-compose.yml");

  assert.match(compose, new RegExp(CURRENT_STT_DIGEST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(compose, new RegExp(RETIRED_STT_DIGEST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("release gates verify digest-pinned compose images before release install reaches compose up", () => {
  const releaseGates = read(".github/workflows/release-gates.yml");
  const publishImage = read(".github/workflows/publish-image.yml");

  assert.match(releaseGates, new RegExp(MANIFEST_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(publishImage, new RegExp(MANIFEST_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("CI doctor bundle uploads include the hidden .dpf directory", () => {
  for (const path of [".github/workflows/install-verification.yml", ".github/workflows/publish-image.yml"]) {
    const workflow = read(path);

    assert.match(workflow, /path:\s+\/home\/runner\/\.dpf\/doctor-\*\.tar\.gz/);
    assert.match(workflow, /include-hidden-files:\s+true/);
  }
});

test("autostart persists install-state.autostart as a JSON object, not a quoted string", () => {
  const autostart = read("scripts/installer/lib/autostart.sh");

  // dpf_state_write quotes its value, so writing the autostart object
  // through it yields autostart="{...}" (a string). All five sites must
  // use the object-aware dpf_state_write_json so the field stays an object.
  assert.doesNotMatch(autostart, /dpf_state_write\s+autostart\s/);
  assert.match(autostart, /dpf_state_write_json\s+autostart\s+"\{\\"enabled\\":true,\\"kind\\":\\"launchagent\\"\}"/);
  assert.match(autostart, /dpf_state_write_json\s+autostart\s+"\{\\"enabled\\":true,\\"kind\\":\\"systemd-user\\"\}"/);
});

test("installer populates the previously-null install-state fields", () => {
  const installer = read("install-dpf.sh");

  // These were left at their init defaults (null / []) on macOS because
  // the install flow never wrote them. Each must now be persisted.
  assert.match(installer, /dpf_state_write\s+dockerContext\s+"\$\(dpf_docker_context\)"/);
  assert.match(installer, /dpf_state_write_json\s+composeFiles\s+"\$\(dpf_compose_files_json\)"/);
  assert.match(installer, /dpf_state_write\s+llmProvider\s+"\$DPF_RESOLVED_LLM_PROVIDER"/);
  assert.match(installer, /dpf_state_write\s+imageTag\s+"\$DPF_RESOLVED_IMAGE_TAG"/);
});

test("install-state helper functions backing the new fields are defined", () => {
  assert.match(read("scripts/installer/lib/docker.sh"), /dpf_docker_context\(\)\s*\{/);
  assert.match(read("scripts/installer/lib/compose.sh"), /dpf_compose_files_json\(\)\s*\{/);
});
