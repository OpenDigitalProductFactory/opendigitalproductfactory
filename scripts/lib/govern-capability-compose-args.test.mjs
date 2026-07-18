import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { governCapabilityComposeArgs } from "./govern-capability-compose-args.mjs";

const resolved = (runtimeProfiles) => ({ runtimeProfiles });

for (const profile of ["runtime-local-speech", "tts"]) {
  test(`rejects disabled local-speech profile ${profile}`, () => {
    assert.throws(
      () => governCapabilityComposeArgs({ args: ["--profile", profile, "up", "-d"], projection: resolved([]) }),
      { message: `capability_profile_not_enabled:${profile}` },
    );
  });

  test(`canonicalizes enabled local-speech profile ${profile}`, () => {
    assert.deepEqual(
      governCapabilityComposeArgs({ args: ["--profile", profile, "up", "-d"], projection: resolved(["runtime-local-speech"]) }),
      ["--profile", "runtime-local-speech", "up", "-d"],
    );
  });
}

for (const profile of ["runtime-deep-observability", "observability-ui"]) {
  test(`rejects disabled deep-observability profile ${profile}`, () => {
    assert.throws(
      () => governCapabilityComposeArgs({ args: [`--profile=${profile}`, "up"], projection: resolved([]) }),
      { message: `capability_profile_not_enabled:${profile}` },
    );
  });

  test(`canonicalizes enabled deep-observability profile ${profile}`, () => {
    assert.deepEqual(
      governCapabilityComposeArgs({ args: [`--profile=${profile}`, "up"], projection: resolved(["runtime-deep-observability"]) }),
      ["--profile", "runtime-deep-observability", "up"],
    );
  });
}

test("preserves explicit lifecycle and host overlays after governed runtime profiles", () => {
  assert.deepEqual(
    governCapabilityComposeArgs({ args: ["--profile", "promote", "--profile=linux-monitoring", "build"], projection: resolved(["runtime-build"]) }),
    ["--profile", "runtime-build", "--profile", "promote", "--profile=linux-monitoring", "build"],
  );
});

test("rejects an ungoverned arbitrary profile", () => {
  assert.throws(
    () => governCapabilityComposeArgs({ args: ["--profile", "mystery", "up"], projection: resolved([]) }),
    { message: "explicit_compose_profile_not_allowed:mystery" },
  );
});

test("dpf-compose emits the exact disabled-profile failure before Docker", async () => {
  const root = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const catalog = JSON.parse(await readFile(join(root, "scripts", "capability-service-catalog.generated.json"), "utf8"));
  const enabled = new Set(["runtime:core"]);
  const lines = catalog.capabilities.map(({ capabilityId }) => `${capabilityId}=${enabled.has(capabilityId) ? "active" : "disabled"}`).sort().join("\n");
  const dir = await mkdtemp(join(tmpdir(), "dpf-compose-profile-"));
  const statePath = join(dir, "install-state.json");
  try {
    await writeFile(statePath, JSON.stringify({
      installPath: root,
      platform: "win32",
      enabledRuntimeCapabilities: [...enabled],
      capabilityCatalogHash: catalog.catalogHash,
      capabilityStateVersion: createHash("sha256").update(`${catalog.catalogHash}\n${lines}`).digest("hex"),
    }));
    const result = spawnSync(process.execPath, [join(root, "scripts", "dpf-compose.mjs"), "--profile", "tts", "config"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DPF_INSTALL_STATE_PATH: statePath },
    });
    assert.equal(result.status, 2);
    assert.equal(result.stderr.trim(), "capability_profile_not_enabled:tts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
