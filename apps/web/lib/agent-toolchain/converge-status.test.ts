// BI-3E66F76F (S4 of BI-63672FBE; spec 2026-10-27-self-converging-agent-toolchain M9).
// Each connection already declares the toolchain it loaded. It now also says how
// the host's convergence agent last fared, so the portal can show why a client is
// behind and raise one attention item only for what automation cannot fix.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { recordToolchainObservation, _resetObservationMemo } from "./connection-observation";
import { toConnectedClientRows } from "./connected-clients";
import { rollUpToolchainCopies, type ToolchainObservationRow } from "./fleet-readiness";
import { parseConvergeToken, parseToolchainDeclaration, type PublishedToolchain } from "./toolchain-verdict";
import { agentToolchainAttentionItems, CONVERGE_ESCALATE_AFTER_MS } from "@/lib/attention/sources/agent-toolchain";

const DIGEST = "ab".repeat(32);
const RELEASE: PublishedToolchain = { packVersion: "0.3.0", packDigest: DIGEST, floor: { minPackVersion: null, graceStartsAt: null } };
const HTTPS = "https://dpf.example/api/mcp/v1";
const NOW = new Date("2026-10-27T12:00:00Z");

function header(value: string) {
  return { get: (name: string) => (name === "x-dpf-toolchain" ? value : null) };
}

describe("parseConvergeToken", () => {
  it("reads status, code and the time the host first failed", () => {
    expect(parseConvergeToken("failed:exit-1@1761500000")).toEqual({ status: "failed", code: "exit-1", since: new Date(1761500000 * 1000) });
    expect(parseConvergeToken("ok")).toEqual({ status: "ok", code: null, since: null });
    expect(parseConvergeToken("needs-operator:identity_changed")).toEqual({ status: "needs-operator", code: "identity_changed", since: null });
    expect(parseConvergeToken("ahead-of-portal")?.status).toBe("ahead-of-portal");
  });

  it("drops anything outside the closed vocabulary instead of storing it", () => {
    for (const bad of ["", "great", "failed:<script>", "failed:exit-1@soon", "ok:" + "x".repeat(80)]) {
      expect(parseConvergeToken(bad)).toBeNull();
    }
  });
});

describe("parseToolchainDeclaration carries the convergence report", () => {
  it("from the header carrier", () => {
    const parsed = parseToolchainDeclaration(HTTPS, header(`pack=0.3.0;digest=${DIGEST.slice(0, 16)};client=codex;converge=failed:exit-1@1761500000`));
    expect(parsed?.converge).toEqual({ status: "failed", code: "exit-1", since: new Date(1761500000 * 1000) });
  });

  it("from the query carrier", () => {
    const parsed = parseToolchainDeclaration(`${HTTPS}?dpf_pack=0.3.0&dpf_digest=${DIGEST.slice(0, 16)}&dpf_client=grok&dpf_converge=ok`, header(""));
    expect(parsed?.converge?.status).toBe("ok");
  });

  it("a malformed report leaves the declaration itself intact", () => {
    const parsed = parseToolchainDeclaration(HTTPS, header(`pack=0.3.0;digest=${DIGEST.slice(0, 16)};client=codex;converge=bogus`));
    expect(parsed).toEqual({ pack: "0.3.0", digest: DIGEST.slice(0, 16), client: "codex" });
  });
});

describe("recordToolchainObservation", () => {
  it("stores the convergence report with the observation", async () => {
    _resetObservationMemo();
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const create = vi.fn(async () => ({}));
    await recordToolchainObservation({ agentToolchainObservation: { updateMany, create } }, {
      credentialRef: "oauth:c1",
      declaration: { pack: "0.3.0", digest: DIGEST.slice(0, 16), client: "codex",
                     converge: { status: "needs-operator", code: "identity_changed", since: new Date(1761500000 * 1000) } },
      authSource: "oauth", probableClient: null, clientInfo: null, now: NOW,
    });
    const data = (create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.convergeStatus).toBe("needs_operator");
    expect(data.convergeCode).toBe("identity_changed");
    expect(data.convergeSince).toEqual(new Date(1761500000 * 1000));
  });
});

function row(over: Partial<ToolchainObservationRow> = {}): ToolchainObservationRow {
  return {
    credentialRef: "oauth:c1", loadedDigest: "00".repeat(8), clientKind: "codex", probableClient: null,
    loadedPackVersion: "0.3.0", authMode: "oauth", clientInfoName: null, clientInfoVersion: null,
    lastObservedAt: NOW, convergeStatus: null, convergeCode: null, convergeSince: null, ...over,
  };
}

describe("the connected-clients view keeps the reasons (BI-81AB897A E2)", () => {
  it("names why a client is behind and how its host agent last fared", () => {
    const rollups = rollUpToolchainCopies([row({ convergeStatus: "failed", convergeCode: "exit-1", convergeSince: new Date("2026-10-26T00:00:00Z") })],
      { published: RELEASE, mcpEndpoint: HTTPS, now: NOW, staleAfterMs: 7 * 86400000 });
    const [client] = toConnectedClientRows(rollups);
    expect(client.behind).toBe(true);
    expect(client.reasons.length).toBeGreaterThan(0);
    expect(client.hostAgent).toEqual({ status: "failed", code: "exit-1", since: new Date("2026-10-26T00:00:00Z") });
  });

  it("a host with no agent report says nothing rather than guessing", () => {
    const [client] = toConnectedClientRows(rollUpToolchainCopies([row()], { published: RELEASE, mcpEndpoint: HTTPS, now: NOW, staleAfterMs: 7 * 86400000 }));
    expect(client.hostAgent).toBeNull();
  });
});

describe("agent-toolchain attention: only what automation cannot fix, once", () => {
  const day = 24 * 60 * 60 * 1000;

  it("a host failing for more than a day raises one item naming the cause", () => {
    const items = agentToolchainAttentionItems([
      row({ convergeStatus: "failed", convergeCode: "exit-1", convergeSince: new Date(NOW.getTime() - 2 * day) }),
      row({ loadedDigest: "11".repeat(8), convergeStatus: "failed", convergeCode: "exit-1", convergeSince: new Date(NOW.getTime() - 2 * day) }),
    ], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("agent-toolchain");
    expect(items[0].audience).toEqual({ operator: true });
    expect(items[0].deepLink).toBe("/ops/self-upgrade");
  });

  it("an identity change names the single operator action", () => {
    const [item] = agentToolchainAttentionItems([row({ convergeStatus: "needs_operator", convergeCode: "identity_changed", convergeSince: new Date(NOW.getTime() - 2 * day) })], NOW);
    expect(item.context).toMatch(/identity/i);
  });

  it("healthy, recent, opted-out, ahead and long-silent hosts raise nothing", () => {
    const recent = new Date(NOW.getTime() - CONVERGE_ESCALATE_AFTER_MS / 2);
    expect(agentToolchainAttentionItems([
      row({ convergeStatus: "ok" }),
      row({ credentialRef: "oauth:c2", convergeStatus: "failed", convergeCode: "exit-1", convergeSince: recent }),
      row({ credentialRef: "oauth:c3", convergeStatus: "opted_out" }),
      row({ credentialRef: "oauth:c4", convergeStatus: "ahead_of_portal" }),
      row({ credentialRef: "oauth:c5", convergeStatus: "failed", convergeSince: new Date(NOW.getTime() - 20 * day), lastObservedAt: new Date(NOW.getTime() - 10 * day) }),
    ], NOW)).toEqual([]);
  });
});
