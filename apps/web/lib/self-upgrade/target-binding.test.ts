import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// BI-231A4BC7: the dedicated key separates self-upgrade target bindings from
// the session secret. These pin the runtime half of the fix: blank-as-unset
// (compose passes `${KEY:-}`), and a bounded AUTH_SECRET grace window so a
// binding the pre-upgrade portal rendered still admits after the key appears.
describe("self-upgrade target binding — dedicated signing key (BI-231A4BC7)", () => {
  const SESSION = "session-secret-shared-with-auth";
  const DEDICATED = "dedicated-target-binding-secret";
  const AFTER_CUTOFF = new Date("2026-11-09T00:00:00.001Z");

  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", SESSION);
    vi.stubEnv("NEXTAUTH_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs with the dedicated key when it is set, not the session secret", () => {
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", DEDICATED);
    const token = createSelfUpgradeTargetBinding(TARGET, { now: NOW });

    expect(verifySelfUpgradeTargetBinding(token, { now: NOW, secret: DEDICATED })).toEqual({ ok: true, data: TARGET });
    expect(verifySelfUpgradeTargetBinding(token, { now: NOW, secret: SESSION })).toEqual({
      ok: false,
      error: "signature-mismatch",
    });
  });

  it("treats a blank dedicated key as unset, as docker-compose passes it to an install whose .env lacks it", () => {
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", "");
    const token = createSelfUpgradeTargetBinding(TARGET, { now: NOW });

    expect(verifySelfUpgradeTargetBinding(token, { now: NOW })).toEqual({ ok: true, data: TARGET });
  });

  it("still admits a binding the pre-upgrade portal signed with AUTH_SECRET once the key is provisioned, until the grace cutoff", () => {
    // Rendered by the old portal (no dedicated key), submitted to the upgraded portal.
    const inFlight = createSelfUpgradeTargetBinding(TARGET, { now: NOW, secret: SESSION });
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", DEDICATED);

    expect(verifySelfUpgradeTargetBinding(inFlight, { now: NOW })).toEqual({ ok: true, data: TARGET });
    expect(matchesSignedSelfUpgradeTargetBinding(inFlight, TARGET)).toBe(true);
  });

  it("refuses an AUTH_SECRET-signed binding after the cutoff, or one claiming more than the binding TTL", () => {
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", DEDICATED);
    const late = createSelfUpgradeTargetBinding(TARGET, { now: AFTER_CUTOFF, secret: SESSION });
    expect(verifySelfUpgradeTargetBinding(late, { now: AFTER_CUTOFF })).toEqual({ ok: false, error: "signature-mismatch" });

    const overlong = createSelfUpgradeTargetBinding(TARGET, { now: NOW, secret: SESSION, ttlMs: 24 * 60 * 60 * 1_000 });
    expect(verifySelfUpgradeTargetBinding(overlong, { now: NOW }).ok).toBe(false);
  });

  it("refuses an AUTH_SECRET-signed binding issued in the future", () => {
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", DEDICATED);
    const futureDated = createSelfUpgradeTargetBinding(TARGET, { now: new Date(NOW.getTime() + 60_000), secret: SESSION });
    expect(verifySelfUpgradeTargetBinding(futureDated, { now: NOW })).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("logs each grace-window use without the secret or the token", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const inFlight = createSelfUpgradeTargetBinding(TARGET, { now: NOW, secret: SESSION });
      vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", DEDICATED);
      verifySelfUpgradeTargetBinding(inFlight, { now: NOW });
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain("self-upgrade-target-binding");
      expect(line).not.toContain(SESSION);
      expect(line).not.toContain(inFlight);

      warn.mockClear();
      verifySelfUpgradeTargetBinding(createSelfUpgradeTargetBinding(TARGET, { now: NOW }), { now: NOW });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
