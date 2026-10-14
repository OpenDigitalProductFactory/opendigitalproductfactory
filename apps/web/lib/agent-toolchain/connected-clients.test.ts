// BI-E7974C18 — one plain-words row per credential, used by the release
// notification and the /ops/self-upgrade section.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildConnectedClientsView, clientDisplayName, clientProduct, toConnectedClientRows } from "./connected-clients";
import type { ToolchainCopyRollup } from "./fleet-readiness";

const copy = (over: Partial<ToolchainCopyRollup["copies"][number]>): ToolchainCopyRollup["copies"][number] => ({
  loadedPackVersion: "0.4.0",
  loadedDigest: "1111111111111111",
  authMode: "oauth",
  verdict: "current",
  silent: false,
  lastObservedAt: new Date("2026-10-13T10:00:00Z"),
  ...over,
});

describe("toConnectedClientRows", () => {
  it("uses the newest copy for what it loaded, and flags any recent copy that is not current as behind", () => {
    const [row] = toConnectedClientRows([
      {
        credentialRef: "token:shared",
        clientKind: "codex",
        probableClient: null,
        verdict: "stale",
        copies: [
          copy({ lastObservedAt: new Date("2026-10-13T11:00:00Z"), authMode: "bearer" }),
          copy({ loadedDigest: "2222222222222222", loadedPackVersion: "0.3.0", verdict: "stale" }),
        ],
      },
    ]);
    expect(row).toMatchObject({ product: "Codex", probable: false, authMode: "bearer", loadedVersion: "0.4.0", loadedFingerprint: "111111111111", standing: "stale", behind: true });
  });

  it("judges a client silent all week by its newest copy", () => {
    const [current, old] = toConnectedClientRows([
      { credentialRef: "a", clientKind: "grok", probableClient: null, verdict: "silent", copies: [copy({ silent: true, lastObservedAt: new Date("2026-10-01T00:00:00Z") })] },
      { credentialRef: "b", clientKind: "undeclared", probableClient: null, verdict: "silent", copies: [copy({ silent: true, verdict: "undeclared", loadedDigest: "undeclared", loadedPackVersion: null, lastObservedAt: new Date("2026-09-30T00:00:00Z") })] },
    ]);
    expect(current).toMatchObject({ behind: false, standing: "silent" });
    expect(old).toMatchObject({ behind: true, loadedVersion: null, loadedFingerprint: null, product: null });
  });

  it("labels an undeclared client by its User-Agent hint only as 'probably'", () => {
    const hinted = clientProduct({ clientKind: "undeclared", probableClient: "claude-code" });
    expect(hinted).toEqual({ product: "Claude Code", probable: true });
    expect(clientDisplayName(hinted)).toBe("Claude Code (probably)");
    expect(clientDisplayName({ product: null, probable: false })).toBe("Unidentified client");
  });
});

describe("buildConnectedClientsView", () => {
  it("returns no release and reads nothing when the image carries no pack", async () => {
    const findMany = vi.fn();
    const view = await buildConnectedClientsView({ agentToolchainObservation: { findMany }, oAuthClient: { findMany: vi.fn() }, mcpApiToken: { findMany: vi.fn() } }, { published: null, mcpEndpoint: "https://x/api/mcp/v1", now: new Date() });
    expect(view).toEqual({ release: null, clients: [], truncated: false });
    expect(findMany).not.toHaveBeenCalled();
  });
});
