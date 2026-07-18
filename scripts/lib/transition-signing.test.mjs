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
  hostIdentity: { platform: "windows", arch: "amd64", provenance: "installer-environment" },
  promoterDigest: `sha256:${"c".repeat(64)}`,
};

test("shared signing preserves the existing sorted top-level JSON/HMAC bytes", () => {
  const payload = canonicalTransitionPayload(envelope);
  assert.equal(payload, JSON.stringify(envelope, Object.keys(envelope).sort()));
  assert.equal(signTransitionPayload(envelope, secret), createHmac("sha256", secret).update(payload).digest("hex"));
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
