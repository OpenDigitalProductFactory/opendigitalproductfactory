import { describe, expect, it } from "vitest";

import {
  issueTeardownChallenge,
  verifyTeardownChallenge,
  type TeardownChallengePayload,
} from "./challenge";

const payload: Omit<TeardownChallengePayload, "schemaVersion" | "kind" | "issuedAt" | "expiresAt"> = {
  runId: "TDR-ABC12345",
  actorRef: "user-1",
  scope: "everything",
  installPath: "D:\\DPF",
  backupsPath: "D:\\DPF-backups",
  composeProject: "dpf",
  composeFiles: ["docker-compose.yml"],
  previewDigest: "a".repeat(64),
  salvageDigest: "b".repeat(64),
};

describe("teardown UI confirmation challenge", () => {
  it("cannot be consumed before the pointer-hold interval and expires after five minutes", () => {
    const secret = "s".repeat(64);
    const issued = Date.parse("2026-08-22T12:00:00.000Z");
    const token = issueTeardownChallenge(payload, secret, issued);
    expect(verifyTeardownChallenge(token, secret, "user-1", issued + 1_999)).toMatchObject({ valid: false, code: "teardown_hold_incomplete" });
    expect(verifyTeardownChallenge(token, secret, "user-1", issued + 2_000)).toMatchObject({ valid: true });
    expect(verifyTeardownChallenge(token, secret, "user-1", issued + 300_001)).toMatchObject({ valid: false, code: "teardown_challenge_expired" });
  });

  it("binds the actor and rejects mutation", () => {
    const secret = "s".repeat(64);
    const issued = Date.parse("2026-08-22T12:00:00.000Z");
    const token = issueTeardownChallenge(payload, secret, issued);
    expect(verifyTeardownChallenge(token, secret, "user-2", issued + 2_000)).toMatchObject({ valid: false, code: "teardown_challenge_actor_mismatch" });
    const [body, signature] = token.split(".");
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), scope: "containers" })).toString("base64url");
    expect(verifyTeardownChallenge(`${changed}.${signature}`, secret, "user-1", issued + 2_000)).toMatchObject({ valid: false, code: "teardown_challenge_signature_invalid" });
  });

  it("allows the non-destructive container scope without a hold delay", () => {
    const secret = "s".repeat(64);
    const issued = Date.parse("2026-08-22T12:00:00.000Z");
    const token = issueTeardownChallenge({ ...payload, scope: "containers" }, secret, issued);
    expect(verifyTeardownChallenge(token, secret, "user-1", issued)).toMatchObject({ valid: true });
  });
});
