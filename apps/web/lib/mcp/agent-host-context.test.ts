import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveInstanceStance } from "@dpf/db/installation-instance-stance";

const mocks = vi.hoisted(() => ({ host: vi.fn(), stance: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/install/host-profile", () => ({ readInstallHostProfile: mocks.host }));
vi.mock("@/lib/install/instance-stance", () => ({
  loadInstanceStance: mocks.stance,
  prismaInstanceStanceStore: () => ({}),
}));

import { loadAgentHostContext } from "./agent-host-context";
import { buildAgentHostInstructions } from "./agent-host-instructions";

const HOST = { kind: "consumer" as const, installMode: "consumer" as const,
  sourceCapable: false, releaseImage: true, reason: "consumer-release-install" as const };
const AUTHORITY = { scope: "write" as const, scopes: ["sandbox_execute"] };
const STANCE = resolveInstanceStance({ schemaVersion: 1, profileFingerprint: "test", evidence: [], environmentClass: "development", primaryPurpose: "evolve-dpf",
  secondaryPurposes: [], relationshipIntents: [], confidence: "high", confirmationStatus: "confirmed" },
  { sourceCapable: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.host.mockResolvedValue(HOST);
  mocks.stance.mockResolvedValue(STANCE);
});

describe("recoverable installation context", () => {
  it("uses the canonical stance and the same host briefing as initialization", async () => {
    const result = await loadAgentHostContext(AUTHORITY);
    expect(result).toMatchObject({ hostProfile: HOST, stance: STANCE, stanceStatus: "resolved" });
    expect(result.instructions).toBe(buildAgentHostInstructions(HOST, AUTHORITY, STANCE));
    expect(result.instructions).toContain("development installation");
    expect(result.instructions).toContain("issue_ux_verification_sign_in");
  });

  it("retains the usable host context when stance composition fails", async () => {
    mocks.stance.mockRejectedValue(new Error("DB unavailable"));
    const result = await loadAgentHostContext(AUTHORITY);
    expect(result).toMatchObject({ hostProfile: HOST, stance: null, stanceStatus: "unknown" });
    expect(result.instructions).toContain("INSTALLATION IDENTITY: unverified");
    expect(result.instructions).not.toContain("development installation");
  });

  it("retains the declared environment when host inspection fails", async () => {
    mocks.host.mockRejectedValue(new Error("host unavailable"));
    const result = await loadAgentHostContext(AUTHORITY);
    expect(result.stance).toEqual(STANCE);
    expect(result.hostProfile.kind).toBe("unknown");
    expect(result.instructions).toContain("Do not edit host files");
  });

  it("fails cautiously when neither read works", async () => {
    mocks.host.mockRejectedValue(new Error("unavailable"));
    mocks.stance.mockRejectedValue(new Error("unavailable"));
    const result = await loadAgentHostContext(AUTHORITY);
    expect(result.instructions).toContain("UNVERIFIED HOST");
    expect(result.instructions).toContain("INSTALLATION IDENTITY: unverified");
    expect(result.instructions).not.toContain("local test credentials may");
  });
});
