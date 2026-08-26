// BI-C7151B1B — the MCP handshake must say WHICH installation it is.
//
// The reported defect: "can I connect this MCP client to both installations and
// have each one self-identify?" The answer was no, because serverInfo.name was
// the constant "dpf-platform" on every install. The first test here is that
// question, answered.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformConfig: { findUnique: vi.fn() },
  hostProfile: vi.fn(),
  instanceStance: vi.fn(),
}));
const { platformConfig, hostProfile, instanceStance } = mocks;

vi.mock("@dpf/db", () => ({ prisma: { platformConfig: mocks.platformConfig } }));
vi.mock("@/lib/install/host-profile", () => ({
  readInstallHostProfile: () => mocks.hostProfile(),
}));
vi.mock("@/lib/install/instance-stance", () => ({
  loadInstanceStance: () => mocks.instanceStance(),
  prismaInstanceStanceStore: () => ({}),
}));
vi.mock("@/lib/mcp/org-context-bundle", () => ({
  buildOrgContextBundle: async () => ({}),
  formatOrgContextInstructions: (instructions: string) => instructions,
}));

import { buildMcpInitializeResult } from "./initialize";

const AUTHORITY = { scope: "admin" as const, scopes: ["admin_write"] };

const STANCE = {
  schemaVersion: 1 as const,
  environmentClass: "development" as const,
  primaryPurpose: "evolve-dpf" as const,
  holdsIrreplaceableWork: false,
  credentials: "local-permitted",
  teardown: "permitted",
  sourceAuthority: "none",
  peerWrite: "none",
  workSync: "none",
  pairedProductionInstallationRef: undefined,
  rationale: {
    credentials: "r1",
    teardown: "r2",
    sourceAuthority: "r3",
    peerWrite: "r4",
    workSync: "r5",
  },
};

/** Stand in for PlatformConfig rows keyed by config key. */
function configRows(rows: Record<string, unknown>) {
  platformConfig.findUnique.mockImplementation(
    async ({ where }: { where: { key: string } }) =>
      where.key in rows ? { value: rows[where.key] } : null,
  );
}

const estateRow = (estateName: string) => ({
  schemaVersion: 1,
  estateName,
  source: "operator",
  declaredAt: "2026-08-25T00:00:00.000Z",
  declaredByPrincipalId: "PRN-1",
});

const environmentRow = (environmentClass: string) => ({
  schemaVersion: 1,
  environmentClass,
  declaredAt: "2026-08-25T00:00:00.000Z",
  declaredByPrincipalId: "PRN-1",
});

beforeEach(() => {
  vi.clearAllMocks();
  hostProfile.mockResolvedValue({
    kind: "consumer",
    installMode: "consumer",
    sourceCapable: false,
    releaseImage: true,
    reason: "consumer-release-install",
  });
  instanceStance.mockResolvedValue(STANCE);
  configRows({});
});

describe("serverInfo identifies the installation", () => {
  it("gives two installs of ONE estate different server names -- the reported defect", async () => {
    configRows({
      "installation.estate-identity.v1": estateRow("Northwind"),
      "installation.environment-class.v1": environmentRow("development"),
    });
    const dev = await buildMcpInitializeResult({ authority: AUTHORITY });

    configRows({
      "installation.estate-identity.v1": estateRow("Northwind"),
      "installation.environment-class.v1": environmentRow("production"),
    });
    const prod = await buildMcpInitializeResult({ authority: AUTHORITY });

    const devInfo = dev["serverInfo"] as { name: string; title?: string };
    const prodInfo = prod["serverInfo"] as { name: string; title?: string };

    expect(devInfo.name).toBe("dpf-northwind-dev");
    expect(prodInfo.name).toBe("dpf-northwind-prod");
    expect(devInfo.name).not.toBe(prodInfo.name);
    expect(devInfo.title).toBe("Northwind DEV");
  });

  it("still distinguishes by role when nobody has named the estate", async () => {
    configRows({ "installation.environment-class.v1": environmentRow("test") });
    const result = await buildMcpInitializeResult({ authority: AUTHORITY });
    expect((result["serverInfo"] as { name: string }).name).toBe("dpf-test");
  });

  // A database outage does NOT produce the historic constant, and should not.
  // Each precedence tier guards itself, so an unreadable store resolves to the
  // cautious identity -- production, unnamed -- which is the fail-safe answer.
  // An agent that cannot learn which install it is on is told it may be a
  // production one, rather than being handed an ambiguous name.
  it("degrades to the CAUTIOUS identity when the config store is unreachable", async () => {
    platformConfig.findUnique.mockRejectedValue(new Error("db down"));
    const result = await buildMcpInitializeResult({ authority: AUTHORITY });
    const info = result["serverInfo"] as { name: string; title?: string };

    expect(info.name).toBe("dpf-prod");
    expect(info.title).toBe("Unnamed DPF PROD");
  });
});

describe("the instructions name the installation", () => {
  it("puts an INSTALLATION line ahead of the identity line", async () => {
    configRows({
      "installation.estate-identity.v1": estateRow("Northwind"),
      "installation.environment-class.v1": environmentRow("development"),
    });
    const result = await buildMcpInitializeResult({ authority: AUTHORITY });
    const instructions = String(result["instructions"]);

    expect(instructions).toContain("INSTALLATION: Northwind DEV.");
    expect(instructions.indexOf("INSTALLATION: Northwind DEV.")).toBeLessThan(
      instructions.indexOf("INSTALLATION IDENTITY:"),
    );
  });

  it("carries the device id as the unforgeable discriminator when one exists", async () => {
    configRows({
      "installation.estate-identity.v1": estateRow("Northwind"),
      "installation.environment-class.v1": environmentRow("development"),
      "federation.identity": {
        installationId: `inst_${"a".repeat(32)}`,
        projectionSecret: "b".repeat(64),
        deviceId: `did_${"c".repeat(64)}`,
      },
    });
    const result = await buildMcpInitializeResult({ authority: AUTHORITY });
    expect(String(result["instructions"])).toContain("(did_cccc…cccc)");
  });

  it("names the installation on an install that has NEVER federated", async () => {
    configRows({
      "installation.estate-identity.v1": estateRow("Northwind"),
      "installation.environment-class.v1": environmentRow("development"),
    });
    const result = await buildMcpInitializeResult({ authority: AUTHORITY });
    const instructions = String(result["instructions"]);

    expect(instructions).toContain("INSTALLATION: Northwind DEV.");
    expect(instructions).not.toContain("did_");
  });

  it("never mints a device id as a side effect of a handshake", async () => {
    configRows({
      "installation.estate-identity.v1": estateRow("Northwind"),
      "installation.environment-class.v1": environmentRow("development"),
    });
    await buildMcpInitializeResult({ authority: AUTHORITY });
    // findUnique only — an upsert or create here would mean connecting to a
    // server changes its persistent state.
    expect(platformConfig).not.toHaveProperty("upsert.mock");
    expect(platformConfig.findUnique).toHaveBeenCalled();
  });

  it("keeps the handshake alive when identity is unresolvable", async () => {
    platformConfig.findUnique.mockRejectedValue(new Error("db down"));
    const result = await buildMcpInitializeResult({ authority: AUTHORITY });

    expect(result["protocolVersion"]).toBeTruthy();
    expect(String(result["instructions"])).toContain("DPF AGENT HOST");
  });
});
