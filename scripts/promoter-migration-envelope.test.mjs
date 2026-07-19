import assert from "node:assert/strict";
import test from "node:test";

// End-to-end through the promoter entrypoint: an N-1 caller sends no handoff at
// all, so the CLI must self-issue from the mounted state instead of exiting 78.
test("CLI self-issues when the caller sends no handoff", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { computeCapabilityStateVersion } = await import("./lib/capability-state-hash.mjs");

  const root = mkdtempSync(join(tmpdir(), "dpf-self-issue-"));
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
  writeFileSync(join(root, "secret"), "s".repeat(32));

  const stdout = execFileSync(process.execPath, [new URL("./promoter-migration-envelope.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], {
    encoding: "utf8",
    env: {
      ...process.env,
      DPF_PROMOTER_STATE_DIR: root,
      DPF_RUNTIME_TRANSITION_SECRET_FILE: join(root, "secret"),
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
