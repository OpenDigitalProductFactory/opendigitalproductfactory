// GPP Phase 2, PR-D — AC-FORGERY.
// A permit carries a MAC over its claims. A row that was edited after minting,
// or invented without the key, fails verification and is recorded as
// `mac_invalid`. With no key configured, permits are minted unsigned and the
// verdict is `unsigned`: a recorded state, never an error and never a refusal.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-D).
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GPP_BINDINGS } from "./bindings";
import { mintShadowPermit, shadowPermitClaims } from "./permit-mint";
import {
  canSignPermits,
  formatPermitHandle,
  parsePermitHandle,
  signPermit,
  verifyPermitMac,
} from "./permit-handle";
import { setGppPermitStoreOverrideForTests, type GppPermitStore, type PermitRow } from "./permit-store";
import { resolveMonitorPermit, type MonitorPermitInput } from "./permit-verdict";

const SECRET = "test-permit-secret-0123456789abcdef";
const NOW = new Date("2026-10-01T12:00:00Z");
const binding = GPP_BINDINGS.find((b) => b.bindingId === "tak-alignment-admit")!;

let rows: PermitRow[];

function store(): GppPermitStore {
  return {
    createPermit: async (claims, signature) => {
      const row: PermitRow = {
        ...claims, id: `row-${rows.length + 1}`, useCount: 0, revokedAt: null,
        keyId: signature?.keyId ?? null, mac: signature?.mac ?? null,
      };
      rows.push(row);
      return row;
    },
    findPermitByPermitId: async (permitId) => rows.find((row) => row.permitId === permitId) ?? null,
    consumePermit: async () => undefined,
    createObservation: async () => undefined,
    findLineage: async () => ({ found: true, sealed: true }),
  };
}

function useKey(secret: string | undefined, keyId?: string) {
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", secret ?? "");
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", keyId ?? "");
}

const replay = (handle: string, patch: Partial<MonitorPermitInput> = {}) =>
  resolveMonitorPermit({
    toolName: "create_portal_pr", tool: { consequential: true }, alignmentApproved: false,
    alignmentInteractionId: null, approvedEnvelopeId: null, authorityDecisionId: null,
    actorUserId: "u1", actorAgentId: null, workroomId: null, permitHandle: handle,
    params: { title: "t" }, now: NOW, ...patch,
  });

async function mint() {
  const minted = await mintShadowPermit({
    binding, toolName: "create_portal_pr", actorUserId: "u1", gateDecisionId: "DI-ALIGN-1",
    params: { title: "t" }, now: NOW,
  });
  if (!minted) throw new Error("mint failed");
  return minted;
}

beforeEach(() => {
  rows = [];
  setGppPermitStoreOverrideForTests(store());
  useKey(SECRET, "k1");
});

afterEach(() => {
  setGppPermitStoreOverrideForTests(null);
  vi.unstubAllEnvs();
});

describe("permit handle format", () => {
  it("round-trips gpp1.<permitId>.<keyId>.<mac>", () => {
    const handle = formatPermitHandle({ permitId: "GPM-1234", keyId: "k1", mac: "A".repeat(43) });
    expect(handle).toBe(`gpp1.GPM-1234.k1.${"A".repeat(43)}`);
    expect(parsePermitHandle(handle)).toEqual({ permitId: "GPM-1234", keyId: "k1", mac: "A".repeat(43) });
  });

  it.each([
    ["a bare permit id", "GPM-1234"],
    ["another version", `gpp2.GPM-1234.k1.${"A".repeat(43)}`],
    ["a missing part", "gpp1.GPM-1234.k1"],
    ["an extra part", `gpp1.GPM-1234.k1.x.${"A".repeat(43)}`],
    ["a short mac", "gpp1.GPM-1234.k1.AAAA"],
    ["a non-base64url mac", `gpp1.GPM-1234.k1.${"+".repeat(43)}`],
  ])("does not parse %s as a signed handle", (_label, value) => {
    expect(parsePermitHandle(value)).toBeNull();
  });
});

describe("AC-FORGERY: MAC verification", () => {
  it("signs at mint, and the minted handle verifies", async () => {
    const minted = await mint();
    expect(minted.row.keyId).toBe("k1");
    expect(minted.row.mac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted.handle).toBe(`gpp1.${minted.row.permitId}.k1.${minted.row.mac}`);
    expect(verifyPermitMac(minted.row, parsePermitHandle(minted.handle))).toEqual({ result: "ok" });
    expect((await replay(minted.handle)).detail.checks).toMatchObject({ mac: "ok" });
  });

  it.each([
    ["capabilities", { capabilities: [{ tool: "contribute_to_hive" }] }],
    ["expiresAt", { expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000) }],
    ["paramHash", { paramHash: "0".repeat(64) }],
    ["maxUses", { maxUses: 1000 }],
    ["gateDecisionId", { gateDecisionId: "DI-SOMETHING-ELSE" }],
  ])("a permit whose row was edited (%s) fails MAC verification and is recorded as forged", async (_label, patch) => {
    const minted = await mint();
    Object.assign(rows[0]!, patch);

    const outcome = await replay(minted.handle);

    expect(outcome.verdict).toBe("mac_invalid");
    expect(outcome.permitRowId).toBe(minted.row.id);
    // Without the presented handle (the row cited by its bare id), the
    // stored MAC no longer matches either.
    expect((await replay(minted.row.permitId)).verdict).toBe("mac_invalid");
  });

  it("an invented row with a guessed handle fails", async () => {
    const claims = shadowPermitClaims({ binding, toolName: "create_portal_pr", actorUserId: "u1", now: NOW });
    const guessedMac = randomBytes(32).toString("base64url");
    rows.push({ ...claims, id: "row-forged", useCount: 0, revokedAt: null, keyId: "k1", mac: guessedMac });

    const outcome = await replay(formatPermitHandle({ permitId: claims.permitId, keyId: "k1", mac: guessedMac }));

    expect(outcome.verdict).toBe("mac_invalid");
    expect(outcome.detail.checks).toMatchObject({ mac: "invalid", macReason: "mac-mismatch" });
  });

  it("an invented row with no MAC, cited by bare id on a keyed install, fails", async () => {
    const claims = shadowPermitClaims({ binding, toolName: "create_portal_pr", actorUserId: "u1", now: NOW });
    rows.push({ ...claims, id: "row-forged", useCount: 0, revokedAt: null, keyId: null, mac: null });

    const outcome = await replay(claims.permitId);

    expect(outcome.verdict).toBe("mac_invalid");
    expect(outcome.detail.checks).toMatchObject({ macReason: "row-unsigned-while-key-configured" });
  });

  it("a missing key mints unsigned and never throws", async () => {
    useKey(undefined);
    expect(canSignPermits()).toBe(false);
    expect(signPermit(shadowPermitClaims({ binding, toolName: "t", actorUserId: "u1" }))).toBeNull();

    const minted = await mint();

    expect(minted.row).toMatchObject({ keyId: null, mac: null });
    expect(minted.handle).toBe(minted.row.permitId);
    const outcome = await replay(minted.handle);
    expect(outcome.verdict).toBe("unsigned");
    expect(outcome.detail.checks).toMatchObject({ mac: "unsigned", macReason: "no-key-configured" });
  });

  it("a key id that cannot travel in the handle disables signing rather than minting a bad handle", () => {
    useKey(SECRET, "has.a.dot");
    expect(canSignPermits()).toBe(false);
  });

  it("key-id rotation: a handle signed under an old keyId verifies only while that key is configured", async () => {
    const minted = await mint();

    useKey("a-different-secret-for-the-new-key", "k2");
    const rotated = await replay(minted.handle);
    expect(rotated.verdict).toBe("mac_invalid");
    expect(rotated.detail.checks).toMatchObject({ macReason: "key-not-configured" });

    useKey(SECRET, "k1");
    expect((await replay(minted.handle)).detail.checks).toMatchObject({ mac: "ok" });
  });

  it("the same key id with a different secret does not verify", async () => {
    const minted = await mint();
    useKey("same-id-but-another-secret", "k1");
    expect((await replay(minted.handle)).verdict).toBe("mac_invalid");
  });
});
