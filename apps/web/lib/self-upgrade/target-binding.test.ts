import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSelfUpgradeTargetBinding,
  matchesSignedSelfUpgradeTargetBinding,
  verifySelfUpgradeTargetBinding,
} from "./target-binding";

const NOW = new Date("2026-08-29T08:00:00.000Z");
const TARGET = {
  targetKind: "release-artifact" as const,
  targetSha: "a".repeat(40),
  targetTag: "v2026.08.29-test.1",
};

describe("self-upgrade target binding", () => {
  const originalSecrets = {
    binding: process.env.DPF_SELF_UPGRADE_TARGET_BINDING_SECRET,
    auth: process.env.AUTH_SECRET,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };

  beforeEach(() => {
    process.env.AUTH_SECRET = "self-upgrade-target-binding-test-secret";
  });

  afterEach(() => {
    if (originalSecrets.binding === undefined) delete process.env.DPF_SELF_UPGRADE_TARGET_BINDING_SECRET;
    else process.env.DPF_SELF_UPGRADE_TARGET_BINDING_SECRET = originalSecrets.binding;
    if (originalSecrets.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecrets.auth;
    if (originalSecrets.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalSecrets.nextAuth;
  });

  it("round-trips the exact server-rendered immutable release target", () => {
    const token = createSelfUpgradeTargetBinding(TARGET, { now: NOW });

    expect(verifySelfUpgradeTargetBinding(token, { now: NOW })).toEqual({
      ok: true,
      data: TARGET,
    });
  });

  it("rejects forged, malformed, expired, and wrong-secret bindings", () => {
    const token = createSelfUpgradeTargetBinding(TARGET, { now: NOW, ttlMs: 1_000 });
    const [payload, signature] = token.split(".");

    expect(verifySelfUpgradeTargetBinding(`${payload}x.${signature}`, { now: NOW })).toEqual({
      ok: false,
      error: "signature-mismatch",
    });
    expect(verifySelfUpgradeTargetBinding("not-a-binding", { now: NOW })).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(
      verifySelfUpgradeTargetBinding(token, { now: new Date(NOW.getTime() + 1_001) }),
    ).toEqual({ ok: false, error: "expired" });
    expect(
      matchesSignedSelfUpgradeTargetBinding(token, TARGET),
    ).toBe(true);
    expect(
      matchesSignedSelfUpgradeTargetBinding(
        token,
        { ...TARGET, targetSha: "b".repeat(40) },
      ),
    ).toBe(false);
    expect(
      verifySelfUpgradeTargetBinding(token, { now: NOW, secret: "different-secret" }),
    ).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("fails closed when signing authority is unavailable", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DPF_SELF_UPGRADE_TARGET_BINDING_SECRET;

    expect(() => createSelfUpgradeTargetBinding(TARGET, { now: NOW })).toThrow(
      /signing secret/i,
    );
    expect(verifySelfUpgradeTargetBinding("payload.signature", { now: NOW })).toEqual({
      ok: false,
      error: "signature-mismatch",
    });
  });
});
