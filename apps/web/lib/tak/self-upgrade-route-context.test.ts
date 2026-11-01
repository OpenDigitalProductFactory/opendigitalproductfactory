import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectedClientRow } from "@/lib/agent-toolchain/connected-clients";
const { load, user, config, run, signal } = vi.hoisted(() => ({
  load: vi.fn(), user: vi.fn(), config: vi.fn(), run: vi.fn(), signal: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { selfUpgradeRun: { findFirst: run }, platformConfig: { findUnique: signal } } }));
vi.mock("@/lib/self-upgrade/config", () => ({ getSelfUpgradeConfig: config }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: user }));
vi.mock("@/lib/agent-toolchain/connected-clients", async (original) => ({
  ...await original<typeof import("@/lib/agent-toolchain/connected-clients")>(),
  loadConnectedAgentClients: load,
}));
import { connectedClientsPromptFacts } from "@/lib/agent-toolchain/connected-clients";
import { getSelfUpgradeContext } from "./self-upgrade-route-context";

function row(standing: ConnectedClientRow["standing"]): ConnectedClientRow {
  return { credentialRef: "PRIVATE-TOKEN-ID", product: "Codex", probable: false,
    authMode: "oauth", standing, loadedVersion: standing === "undeclared" ? null : "0.2.19",
    loadedFingerprint: null, lastSeen: new Date("2026-10-31T23:00:00Z"),
    behind: standing === "stale", reasons: standing === "stale" ? ["loaded fingerprint differs from released"] : [],
    hostAgent: { status: "failed", code: "PRIVATE-HOST-CODE", since: new Date() } };
}
beforeEach(() => {
  vi.clearAllMocks();
  user.mockResolvedValue({ userId: "operator", isSuperuser: false, platformRole: "HR-000" });
  config.mockResolvedValue({ enabled: true, channel: "stable" });
  run.mockResolvedValue(null); signal.mockResolvedValue(null);
  load.mockResolvedValue({ release: { packVersion: "0.2.19", fingerprint: "released1234" },
    clients: [row("current"), row("stale"), row("silent"), row("undeclared")], truncated: true });
});
describe("authorized Self-upgrade client context", () => {
  it("carries page count semantics, unknowns and stale reasons without private identifiers", async () => {
    const context = await getSelfUpgradeContext("operator");
    expect(context).toContain('"current":1,"total":4');
    expect(context).toContain('"standing":"silent"');
    expect(context).toContain('"standing":"undeclared"');
    expect(context).toContain("loaded fingerprint differs from released");
    expect(context).toContain('"truncated":true');
    expect(context).not.toMatch(/PRIVATE-|credentialRef|hostAgent.*code/);
    expect(context).toContain("/ops/self-upgrade");
  });
  it("isolates a failed client read from other page data and does not expose the error", async () => {
    load.mockRejectedValue(new Error("PRIVATE database address"));
    const context = await getSelfUpgradeContext("operator");
    expect(context).toContain('"status":"unavailable"');
    expect(context).toContain("Self-upgrade: enabled");
    expect(context).not.toContain("PRIVATE");
    expect(context).not.toContain('"current":');
  });
  it("does not report an absent published pack as an empty healthy fleet", () => {
    expect(connectedClientsPromptFacts({ release: null, clients: [], truncated: false }))
      .toMatchObject({ status: "unavailable", reason: "No published agent tool pack is available." });
  });
  it.each([null, { userId: "operator", isSuperuser: false, platformRole: null }])(
    "does not load any operations facts when current view authority is absent", async (identity) => {
      user.mockResolvedValue(identity);
      expect(await getSelfUpgradeContext("operator")).toContain("not authorized");
      expect(load).not.toHaveBeenCalled();
      expect(config).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });
});
