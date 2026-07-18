import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { governCapabilityComposeArgs, governCapabilityComposeEnvironment } from "./govern-capability-compose-args.mjs";

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

test("environment profiles are normalized through the same capability authority", () => {
  assert.deepEqual(
    governCapabilityComposeEnvironment({ args: ["config"], projection: resolved(["runtime-local-speech"]), composeProfiles: "tts,integration-test" }),
    {
      args: ["--profile", "runtime-local-speech", "--profile", "integration-test", "config"],
      composeProfiles: ["runtime-local-speech", "integration-test"],
    },
  );
});

test("disabled environment aliases fail closed", () => {
  assert.throws(
    () => governCapabilityComposeEnvironment({ args: ["config"], projection: resolved([]), composeProfiles: "tts" }),
    { message: "capability_profile_not_enabled:tts" },
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

test("dpf-compose governs profile and topology environment before fake Docker", async () => {
  const root = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const catalog = JSON.parse(await readFile(join(root, "scripts", "capability-service-catalog.generated.json"), "utf8"));
  const dir = await mkdtemp(join(tmpdir(), "dpf-compose-env-"));
  const statePath = join(dir, "install-state.json");
  const trace = join(dir, "trace.json");
  const fakeDocker = join(dir, "compose");
  const alternate = join(dir, "alternate");
  await mkdir(alternate);
  await writeFile(join(alternate, "docker-compose.yml"), "name: alternate\nservices: {}\n");
  await writeFile(join(dir, ".env"), `COMPOSE_FILE=${join(alternate, "docker-compose.yml")}\n`);
  const maliciousEnvFile = join(dir, "malicious.env");
  await writeFile(maliciousEnvFile, `COMPOSE_FILE=${join(alternate, "docker-compose.yml")}\nCOMPOSE_PATH_SEPARATOR=|\n`);
  await writeFile(fakeDocker, `require("node:fs").writeFileSync(process.env.DPF_TEST_TRACE, JSON.stringify({ argv: process.argv.slice(2), profiles: process.env.COMPOSE_PROFILES, file: process.env.COMPOSE_FILE, separator: process.env.COMPOSE_PATH_SEPARATOR }));\n`);
  const writeState = async (enabledValues) => {
    const enabled = new Set(enabledValues);
    const lines = catalog.capabilities.map(({ capabilityId }) => `${capabilityId}=${enabled.has(capabilityId) ? "active" : "disabled"}`).sort().join("\n");
    await writeFile(statePath, JSON.stringify({
      installPath: root,
      platform: "win32",
      enabledRuntimeCapabilities: [...enabled],
      capabilityCatalogHash: catalog.catalogHash,
      capabilityStateVersion: createHash("sha256").update(`${catalog.catalogHash}\n${lines}`).digest("hex"),
    }));
  };
  const invoke = (extraEnv, args = ["-f", join(root, "docker-compose.yml"), "config"]) => spawnSync(process.execPath, [join(root, "scripts", "dpf-compose.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, DPF_INSTALL_STATE_PATH: statePath, DPF_DOCKER_BIN: process.execPath, DPF_TEST_TRACE: trace, ...extraEnv },
  });
  try {
    await writeState(["runtime:core"]);
    for (const profile of ["tts", "runtime-local-speech"]) {
      const disabled = invoke({ COMPOSE_PROFILES: profile, COMPOSE_PROJECT_NAME: "dpf-env-test" });
      assert.equal(disabled.status, 2);
      assert.match(disabled.stderr, new RegExp(`capability_profile_not_enabled:${profile}`));
    }
    await assert.rejects(readFile(trace), { code: "ENOENT" });

    const unsafeIntegration = invoke({ COMPOSE_PROFILES: "integration-test", COMPOSE_PROJECT_NAME: "dpf" });
    assert.equal(unsafeIntegration.status, 2);
    assert.match(unsafeIntegration.stderr, /COMPOSE_PROJECT_NAME/);
    await assert.rejects(readFile(trace), { code: "ENOENT" });

    const mismatchedFile = invoke({ COMPOSE_FILE: join(alternate, "docker-compose.yml"), COMPOSE_PROJECT_NAME: "dpf-env-test" });
    assert.equal(mismatchedFile.status, 2);
    assert.match(mismatchedFile.stderr, /compose_file_sources_mismatch/);
    await assert.rejects(readFile(trace), { code: "ENOENT" });

    await writeState(["runtime:core", "runtime:local-speech"]);
    const validFiles = [join(root, "docker-compose.yml"), join(root, "docker-compose.release.yml")];
    const valid = invoke(
      { COMPOSE_PROFILES: "tts,integration-test", COMPOSE_FILE: validFiles.join(delimiter), COMPOSE_PATH_SEPARATOR: "|", COMPOSE_PROJECT_NAME: "dpf-env-test" },
      ["--env-file", maliciousEnvFile, "-f", validFiles[0], "-f", validFiles[1], "config"],
    );
    assert.equal(valid.status, 0, valid.stderr);
    const forwarded = JSON.parse(await readFile(trace, "utf8"));
    assert.equal(forwarded.profiles, "runtime-local-speech,integration-test");
    assert.deepEqual(forwarded.argv.slice(0, 4), ["-f", validFiles[0], "-f", validFiles[1]]);
    assert.equal(forwarded.file, validFiles.join(delimiter));
    assert.equal(forwarded.separator, delimiter);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
