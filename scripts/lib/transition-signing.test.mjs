import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  canonicalTransitionPayload,
  signTransitionPayload,
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
