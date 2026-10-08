// BI-54469E18 — AC-OBSERVE-STORE: coalesced cross-process observation writes,
// server-derived credential identity, and the per-credential roll-up.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OBSERVATION_COALESCE_MS,
  _resetObservationMemo,
  readClientInfo,
  recordToolchainObservation,
  resolveCredentialRef,
} from "./connection-observation";
import { rollUpToolchainCopies, type ToolchainObservationRow } from "./fleet-readiness";

/** A fake table shared by two "processes" (two memo resets). */
function fakeTable() {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (where: { credentialRef: string; loadedDigest: string }) => `${where.credentialRef}|${where.loadedDigest}`;
  return {
    rows,
    db: {
      agentToolchainObservation: {
        updateMany: vi.fn(async ({ where, data }: { where: { credentialRef: string; loadedDigest: string; lastObservedAt: { lt: Date } }; data: Record<string, unknown> }) => {
          const row = rows.get(key(where));
          if (!row || !((row.lastObservedAt as Date) < where.lastObservedAt.lt)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const k = key(data as { credentialRef: string; loadedDigest: string });
          if (rows.has(k)) throw Object.assign(new Error("unique"), { code: "P2002" });
          rows.set(k, { ...data });
        }),
      },
    },
  };
}

const declaration = { pack: "0.3.0", digest: "abababababababab", client: "codex" };
const input = (now: Date) => ({
  credentialRef: "oauth:client-1",
  declaration,
  authSource: "oauth" as const,
  probableClient: "codex-cli",
  clientInfo: { name: "codex", version: "0.142.0" },
  now,
});

describe("recordToolchainObservation", () => {
  beforeEach(() => _resetObservationMemo());

  it("writes once per credential and loaded digest per window, even across processes", async () => {
    const { db, rows } = fakeTable();
    const t0 = new Date("2026-10-08T00:00:00Z");
    expect(await recordToolchainObservation(db, input(t0))).toBe(true);
    // Same process, inside the window: memo skips the query entirely.
    expect(await recordToolchainObservation(db, input(new Date(t0.getTime() + 1000)))).toBe(false);
    // Another process (fresh memo), inside the window: the guarded update and the insert both no-op.
    _resetObservationMemo();
    await recordToolchainObservation(db, input(new Date(t0.getTime() + 2000)));
    expect(rows.size).toBe(1);
    expect((rows.get("oauth:client-1|abababababababab")!.lastObservedAt as Date).getTime()).toBe(t0.getTime());
    // After the window, the row is refreshed in place.
    _resetObservationMemo();
    const later = new Date(t0.getTime() + OBSERVATION_COALESCE_MS + 1);
    await recordToolchainObservation(db, input(later));
    expect((rows.get("oauth:client-1|abababababababab")!.lastObservedAt as Date).getTime()).toBe(later.getTime());
  });

  it("keeps one row per loaded copy, and an undeclared copy as its own row", async () => {
    const { db, rows } = fakeTable();
    const now = new Date();
    await recordToolchainObservation(db, input(now));
    await recordToolchainObservation(db, { ...input(now), declaration: null });
    expect([...rows.keys()].sort()).toEqual(["oauth:client-1|abababababababab", "oauth:client-1|undeclared"]);
    expect(rows.get("oauth:client-1|undeclared")!.clientKind).toBe("undeclared");
  });

  it("rethrows anything other than a lost insert race", async () => {
    const { db } = fakeTable();
    db.agentToolchainObservation.create.mockRejectedValueOnce(new Error("db down"));
    await expect(recordToolchainObservation(db, input(new Date()))).rejects.toThrow("db down");
  });
});

describe("resolveCredentialRef", () => {
  it("keys OAuth tokens by their client, bearer tokens by themselves, and skips sessions", async () => {
    const db = { mcpApiToken: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === "t-oauth" ? { oauthClientId: "oc-1", kind: "oauth_access" } : { oauthClientId: null, kind: "operator" })) } };
    expect(await resolveCredentialRef(db, { tokenId: "t-oauth", source: "oauth" })).toEqual({ credentialRef: "oauth:oc-1", tokenKind: "oauth_access" });
    expect(await resolveCredentialRef(db, { tokenId: "t-pat", source: "pat" })).toEqual({ credentialRef: "token:t-pat", tokenKind: "operator" });
    expect(await resolveCredentialRef(db, { tokenId: "session:u:a", source: "session-jwt" })).toBeNull();
  });
});

describe("readClientInfo", () => {
  it("bounds and normalises initialize clientInfo", () => {
    expect(readClientInfo({ clientInfo: { name: " claude-code ", version: "2.1.0" } })).toEqual({ name: "claude-code", version: "2.1.0" });
    expect(readClientInfo({})).toBeNull();
    expect(readClientInfo({ clientInfo: { name: "x".repeat(500) } })!.name!.length).toBe(120);
  });
});

describe("rollUpToolchainCopies", () => {
  const published = { packVersion: "0.3.0", packDigest: "ab".repeat(32), floor: { minPackVersion: null, graceStartsAt: null } };
  const now = new Date("2026-10-08T00:00:00Z");
  const row = (over: Partial<ToolchainObservationRow>): ToolchainObservationRow => ({
    credentialRef: "oauth:host-a",
    loadedDigest: "abababababababab",
    clientKind: "claude-code",
    probableClient: "claude-code",
    loadedPackVersion: "0.3.0",
    authMode: "oauth",
    clientInfoName: null,
    clientInfoVersion: null,
    lastObservedAt: now,
    ...over,
  });

  it("reports the worst live copy per credential, so a pinned project shows beside a current one", () => {
    const [rollup] = rollUpToolchainCopies(
      [row({}), row({ loadedDigest: "0000000000000000", loadedPackVersion: "0.2.8" })],
      { published, mcpEndpoint: "https://dpf.example/api/mcp/v1", now, staleAfterMs: 7 * 86_400_000 },
    );
    expect(rollup!.verdict).toBe("stale");
    expect(rollup!.copies.map((copy) => copy.verdict).sort()).toEqual(["current", "stale"]);
  });

  it("ignores copies silent past the window when choosing the verdict", () => {
    const [rollup] = rollUpToolchainCopies(
      [row({}), row({ loadedDigest: "0000000000000000", lastObservedAt: new Date(now.getTime() - 8 * 86_400_000) })],
      { published, mcpEndpoint: "https://dpf.example/api/mcp/v1", now, staleAfterMs: 7 * 86_400_000 },
    );
    expect(rollup!.verdict).toBe("current");
    expect(rollup!.copies.find((copy) => copy.silent)).toBeTruthy();
  });
});
