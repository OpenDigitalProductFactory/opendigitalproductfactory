import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationSecret, resolveMigrationEnvelope } from "./promoter-migration-envelope.mjs";

test("the separate default mount takes precedence over the state secret", async () => {
  const paths = [];
  const secret = await readMigrationSecret({ env: {}, read: async (path) => {
    paths.push(path);
    return "separate-secret\n";
  } });
  assert.equal(secret, "separate-secret");
  assert.deepEqual(paths, ["/run/secrets/dpf-runtime-transition"]);
});

test("only absent default mounts use the existing state secret", async () => {
  for (const stateDir of [undefined, "/custom-state"]) {
    const paths = [];
    const secret = await readMigrationSecret({ env: { DPF_PROMOTER_STATE_DIR: stateDir }, read: async (path) => {
      paths.push(path);
      if (path === "/run/secrets/dpf-runtime-transition") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return "state-secret\n";
    } });
    assert.equal(secret, "state-secret");
    assert.deepEqual(paths, ["/run/secrets/dpf-runtime-transition", `${stateDir ?? "/dpf-state"}/runtime-transition.secret`]);
  }
});

test("explicit paths and non-ENOENT errors cannot fall back", async () => {
  for (const [env, code] of [
    [{ DPF_RUNTIME_TRANSITION_SECRET_FILE: "/bad-explicit" }, "ENOENT"],
    [{ DPF_RUNTIME_TRANSITION_SECRET_FILE: "" }, "ENOENT"],
    [{}, "EACCES"],
    [{}, "EISDIR"],
  ]) {
    let reads = 0;
    const failure = Object.assign(new Error(code), { code });
    await assert.rejects(readMigrationSecret({ env, read: async () => { reads++; throw failure; } }), (error) => error === failure);
    assert.equal(reads, 1);
  }
});

test("both missing secret locations remain a refusal", async () => {
  await assert.rejects(readMigrationSecret({ env: {}, read: async (path) => {
    throw Object.assign(new Error(path), { code: "ENOENT" });
  } }), { code: "ENOENT", message: "/dpf-state/runtime-transition.secret" });
});

// End-to-end through the promoter entrypoint: an N-1 caller sends no handoff at
// all, so the CLI must self-issue from the mounted state instead of exiting 78.
for (const stateMountedSecret of [false, true]) test(`CLI self-issues with ${stateMountedSecret ? "only the state-mounted secret (prebuild caller)" : "an explicit secret path"}`, async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { computeCapabilityStateVersion } = await import("./lib/capability-state-hash.mjs");

  const root = mkdtempSync(join(tmpdir(), "dpf-self-issue-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalog = JSON.parse(readFileSync(new URL("./capability-service-catalog.generated.json", import.meta.url), "utf8"));
  writeFileSync(join(root, "install-state.json"), JSON.stringify({
    schemaVersion: 1, installerVersion: "n-minus-one", platform: "linux", arch: "amd64", installPath: "/opt/dpf", stateDir: root,
    composeProjectName: "dpf", enabledRuntimeCapabilities: ["runtime:core"],
    capabilityCatalogHash: catalog.catalogHash,
    capabilityStateVersion: computeCapabilityStateVersion(
      catalog.catalogHash,
      ["runtime:core"],
      catalog.capabilities.map(({ capabilityId }) => capabilityId),
    ),
  }));
  writeFileSync(join(root, "runtime-transition.secret"), "s".repeat(32));

  const env = { ...process.env };
  delete env.DPF_RUNTIME_TRANSITION_SECRET_FILE;
  if (!stateMountedSecret) env.DPF_RUNTIME_TRANSITION_SECRET_FILE = join(root, "runtime-transition.secret");

  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL("./promoter-migration-envelope.mjs", import.meta.url))], {
    encoding: "utf8",
    env: {
      ...env,
      DPF_PROMOTER_STATE_DIR: root,
      PROMOTE_TARGET_SHA: "a".repeat(40),
      DPF_INSTALL_STATE_MIGRATION_ENVELOPE: "",
      DPF_INSTALL_STATE_MIGRATION_SIGNATURE: "",
    },
  });

  const envelope = JSON.parse(stdout);
  assert.equal(envelope.issuer, "candidate-self");
  assert.equal(envelope.kind, "install-state-migration");
  assert.match(envelope.projectionHash, /^[a-f0-9]{64}$/);
  assert.equal(envelope.hostIdentity.provenance, "install-state");

  // Exercise the same entrypoint with a carried handoff. The fallback must not
  // change signature checking or recover from a wrong explicit signing key.
  const { signTransitionPayload } = await import("./lib/transition-signing.mjs");
  const handoffEnv = {
    ...env,
    DPF_PROMOTER_STATE_DIR: root,
    DPF_INSTALL_STATE_MIGRATION_ENVELOPE: Buffer.from(JSON.stringify(envelope)).toString("base64url"),
    DPF_INSTALL_STATE_MIGRATION_SIGNATURE: signTransitionPayload(envelope, "s".repeat(32)),
    DPF_SELF_UPGRADE_RUN_ID: envelope.runId,
    DPF_PROMOTER_DIGEST: envelope.promoterDigest,
  };
  assert.deepEqual(await resolveMigrationEnvelope({ env: handoffEnv }), envelope);
  await assert.rejects(resolveMigrationEnvelope({ env: { ...handoffEnv, DPF_INSTALL_STATE_MIGRATION_SIGNATURE: "0".repeat(64) } }), /runtime_transition_payload_tampered/);
  const wrongSecret = join(root, "wrong.secret");
  writeFileSync(wrongSecret, "w".repeat(32));
  await assert.rejects(resolveMigrationEnvelope({ env: { ...handoffEnv, DPF_RUNTIME_TRANSITION_SECRET_FILE: wrongSecret } }), /runtime_transition_payload_tampered/);
  await assert.rejects(resolveMigrationEnvelope({ env: { ...handoffEnv, DPF_RUNTIME_TRANSITION_SECRET_FILE: join(root, "absent.secret") } }), { code: "ENOENT" });
});

test("refuses exactly one half of a handoff — a broken caller, not a legacy one", async () => {
  const { resolveMigrationEnvelope } = await import("./promoter-migration-envelope.mjs");
  for (const half of [
    { DPF_INSTALL_STATE_MIGRATION_ENVELOPE: "ZXlKaGF6b2lJbjA9", DPF_INSTALL_STATE_MIGRATION_SIGNATURE: "" },
    { DPF_INSTALL_STATE_MIGRATION_ENVELOPE: "", DPF_INSTALL_STATE_MIGRATION_SIGNATURE: "f".repeat(64) },
  ]) {
    await assert.rejects(
      () => resolveMigrationEnvelope({ env: { ...half, DPF_PROMOTER_STATE_DIR: "/nonexistent", DPF_RUNTIME_TRANSITION_SECRET_FILE: "/nonexistent" } }),
      /install_state_migration_handoff_incomplete/,
    );
  }
});
