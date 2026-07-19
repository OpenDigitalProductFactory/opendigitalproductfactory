import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  canonicalTransitionPayload,
  signTransitionPayload,
  issueSelfSignedMigrationEnvelope,
  verifyInstallStateMigrationEnvelope,
} from "./transition-signing.mjs";

const secret = "s".repeat(32);
const envelope = {
  version: 1,
  kind: "install-state-migration",
  runId: "SUR-test",
  issuedAt: "2026-07-18T00:00:00.000Z",
  expiresAt: "2026-07-18T00:10:00.000Z",
  sourceHash: "a".repeat(64),
  projectionHash: "b".repeat(64),
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  hostIdentity: { platform: "win32", arch: "amd64", provenance: "explicit" },
  promoterDigest: `sha256:${"c".repeat(64)}`,
};

test("shared signing preserves the existing sorted top-level JSON/HMAC bytes", () => {
  const legacy = { version: 1, transitionId: "RCT-test", issuedAt: "a", expiresAt: "b", previousKeys: ["runtime:core"] };
  const payload = canonicalTransitionPayload(legacy);
  assert.equal(payload, JSON.stringify(legacy, Object.keys(legacy).sort()));
  assert.equal(signTransitionPayload(legacy, secret), createHmac("sha256", secret).update(payload).digest("hex"));
});

test("every nested host identity field is authenticated by install-state canonicalization", () => {
  const signature = signTransitionPayload(envelope, secret);
  for (const [field, value] of [["platform", "linux"], ["arch", "arm64"], ["provenance", "legacy-windows-paths"]]) {
    const changed = { ...envelope, hostIdentity: { ...envelope.hostIdentity, [field]: value } };
    assert.notEqual(signTransitionPayload(changed, secret), signature);
    assert.throws(() => verifyInstallStateMigrationEnvelope(changed, signature, secret, {
      runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash,
      hostIdentity: changed.hostIdentity, now: Date.parse(envelope.issuedAt),
    }), /tampered/);
  }
});

test("install-state envelope binds run, digest, time, and observed source state", () => {
  const signature = signTransitionPayload(envelope, secret);
  assert.deepEqual(verifyInstallStateMigrationEnvelope(envelope, signature, secret, {
    runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, now: Date.parse(envelope.issuedAt),
  }), envelope);
  for (const expected of [
    { runId: "SUR-other", promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, now: Date.parse(envelope.issuedAt) },
    { runId: envelope.runId, promoterDigest: `sha256:${"d".repeat(64)}`, sourceHash: envelope.sourceHash, now: Date.parse(envelope.issuedAt) },
    { runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: "d".repeat(64), now: Date.parse(envelope.issuedAt) },
    { runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, now: Date.parse(envelope.expiresAt) + 1 },
  ]) assert.throws(() => verifyInstallStateMigrationEnvelope(envelope, signature, secret, expected));
  assert.throws(() => verifyInstallStateMigrationEnvelope({ ...envelope, projectionHash: "d".repeat(64) }, signature, secret, {
    runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, now: Date.parse(envelope.issuedAt),
  }), /tampered/);
});

test("signed but incomplete install-state envelopes are rejected", () => {
  for (const field of ["projectionHash", "fromSchemaVersion", "toSchemaVersion", "hostIdentity"]) {
    const incomplete = { ...envelope };
    delete incomplete[field];
    assert.throws(() => verifyInstallStateMigrationEnvelope(incomplete, signTransitionPayload(incomplete, secret), secret, {
      runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, hostIdentity: envelope.hostIdentity, now: Date.parse(envelope.issuedAt),
    }), /invalid/);
  }
  for (const field of ["platform", "arch", "provenance"]) {
    const incomplete = { ...envelope, hostIdentity: { ...envelope.hostIdentity } };
    delete incomplete.hostIdentity[field];
    assert.throws(() => verifyInstallStateMigrationEnvelope(incomplete, signTransitionPayload(incomplete, secret), secret, {
      runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, hostIdentity: envelope.hostIdentity, now: Date.parse(envelope.issuedAt),
    }), /invalid/);
  }
});

test("host identity is bound to the authoritative portal identity", () => {
  const signature = signTransitionPayload(envelope, secret);
  assert.throws(() => verifyInstallStateMigrationEnvelope(envelope, signature, secret, {
    runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash,
    hostIdentity: { ...envelope.hostIdentity, arch: "arm64" }, now: Date.parse(envelope.issuedAt),
  }), /identity/);
});

// BI-D47955AF widened resolve-host-identity to derive an installer-owned identity
// from install-state when the caller sends no DPF_HOST_* env. The verifier's
// provenance whitelist did not follow, so a portal on an install whose .env
// predates those keys would build a valid envelope the promoter then rejected.
test("accepts the install-state provenance the resolver can now produce", () => {
  const derived = { ...envelope, hostIdentity: { platform: "win32", arch: "amd64", provenance: "install-state" } };
  assert.doesNotThrow(() => verifyInstallStateMigrationEnvelope(derived, signTransitionPayload(derived, secret), secret, {
    runId: derived.runId, promoterDigest: derived.promoterDigest, sourceHash: derived.sourceHash,
    hostIdentity: derived.hostIdentity, now: Date.parse(derived.issuedAt),
  }));
});

test("still refuses a provenance outside the closed set", () => {
  const bogus = { ...envelope, hostIdentity: { ...envelope.hostIdentity, provenance: "guessed" } };
  assert.throws(() => verifyInstallStateMigrationEnvelope(bogus, signTransitionPayload(bogus, secret), secret, {
    runId: bogus.runId, promoterDigest: bogus.promoterDigest, sourceHash: bogus.sourceHash, now: Date.parse(bogus.issuedAt),
  }), /identity/);
});

// BI-76651B7B. promote.sh requires a signed migration handoff, but an N-1 caller
// (a portal predating the protocol) cannot produce one — the same trapdoor that
// wedged readiness, one gate later. The candidate self-issues from its own
// projection so those installs can still be promoted.
test("self-issued envelope verifies under the same validator", () => {
  const now = Date.parse("2026-07-19T00:00:00.000Z");
  const { envelope: issued, signature } = issueSelfSignedMigrationEnvelope({
    secret, promoterDigest: `sha256:${"d".repeat(64)}`, now,
    sourceHash: "e".repeat(64), projectionHash: "f".repeat(64),
    fromSchemaVersion: 1, toSchemaVersion: 2,
    hostIdentity: { platform: "win32", arch: "amd64", provenance: "install-state" },
  });
  assert.equal(issued.issuer, "candidate-self");
  assert.doesNotThrow(() => verifyInstallStateMigrationEnvelope(issued, signature, secret, {
    runId: issued.runId, promoterDigest: issued.promoterDigest, sourceHash: issued.sourceHash,
    hostIdentity: issued.hostIdentity, now,
  }));
});

test("self-issued envelope is still tamper-evident", () => {
  const now = Date.parse("2026-07-19T00:00:00.000Z");
  const { envelope: issued, signature } = issueSelfSignedMigrationEnvelope({
    secret, promoterDigest: `sha256:${"d".repeat(64)}`, now,
    sourceHash: "e".repeat(64), projectionHash: "f".repeat(64),
    fromSchemaVersion: 1, toSchemaVersion: 2,
    hostIdentity: { platform: "linux", arch: "amd64", provenance: "install-state" },
  });
  const tampered = { ...issued, projectionHash: "0".repeat(64) };
  assert.throws(() => verifyInstallStateMigrationEnvelope(tampered, signature, secret, {
    runId: issued.runId, promoterDigest: issued.promoterDigest, sourceHash: issued.sourceHash, now,
  }), /tampered/);
});

test("a caller-issued envelope carries no issuer and stays accepted", () => {
  assert.equal(envelope.issuer, undefined);
  assert.doesNotThrow(() => verifyInstallStateMigrationEnvelope(envelope, signTransitionPayload(envelope, secret), secret, {
    runId: envelope.runId, promoterDigest: envelope.promoterDigest, sourceHash: envelope.sourceHash, now: Date.parse(envelope.issuedAt),
  }));
});

// End-to-end through the promoter entrypoint: an N-1 caller sends no handoff at
// all, so the CLI must self-issue from the mounted state instead of exiting 78.
test("CLI self-issues when the caller sends no handoff", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { computeCapabilityStateVersion } = await import("./capability-state-hash.mjs");

  const root = mkdtempSync(join(tmpdir(), "dpf-self-issue-"));
  const catalog = JSON.parse(readFileSync(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));
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

  const stdout = execFileSync(process.execPath, [new URL("./transition-signing.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], {
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
