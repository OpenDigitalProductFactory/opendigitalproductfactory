import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { AI_USAGE_SPEC_VERSION, PEER_AI_USAGE_KEY, type PeerAiUsageRecordV1 } from "./ai-usage-exchange";
import { runPeerAiUsageSync, type AiUsageSyncDb, type AiUsageSyncLink } from "./ai-usage-sync";

const now = new Date("2026-11-13T12:00:00Z");
const link = (overrides: Partial<AiUsageSyncLink> = {}): AiUsageSyncLink => ({
  linkId: "link_1", role: "same-org-peer", peerAuthorityUrl: "http://192.168.0.200:3000", peerTokenEnc: "enc", peerInstallationId: "inst_dev", ...overrides,
});

function store(links: AiUsageSyncLink[], previous: unknown = null) {
  const upsert = vi.fn(async (_args: unknown) => ({}));
  const db: AiUsageSyncDb = {
    federationLink: { findMany: vi.fn(async () => links) },
    platformConfig: { findUnique: vi.fn(async () => (previous ? { value: previous } : null)), upsert },
  };
  const written = () => (upsert.mock.calls.at(-1)?.[0] as { update: { value: PeerAiUsageRecordV1 } } | undefined)?.update.value;
  return { db, upsert, written };
}

const body = (origin = "inst_dev") => ({
  specVersion: AI_USAGE_SPEC_VERSION, originInstallationId: origin, generatedAt: now.toISOString(), lookbackDays: 30,
  rows: [["gemini", 490000, 1000, 200, 0]],
});

describe("pulling the paired install's AI usage over the work-sync link", () => {
  it("pulls with the peer-issued token and keeps the usage", async () => {
    const { db, upsert, written } = store([link()]);
    const fetchUsage = vi.fn(async () => ({ ok: true, status: 200, body: body() }));
    const result = await runPeerAiUsageSync(db, { fetchUsage, decryptToken: () => "dpflink_x", now });
    expect(fetchUsage).toHaveBeenCalledWith({ peerAuthorityUrl: "http://192.168.0.200:3000", linkToken: "dpflink_x", linkId: "link_1", sameOrgLan: true });
    expect(result).toMatchObject({ linksChecked: 1, pulled: 1 });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ where: { key: PEER_AI_USAGE_KEY } });
    expect(written()?.links[0]).toMatchObject({ linkId: "link_1", outcome: "pulled", peerInstallationId: "inst_dev", lastSuccessAt: now.toISOString() });
  });

  it("records an unreachable peer without throwing and keeps the last usage", async () => {
    const previous: PeerAiUsageRecordV1 = { schemaVersion: 1, links: [{ linkId: "link_1", peerInstallationId: "inst_dev", outcome: "pulled", detail: null,
      lastAttemptAt: "2026-11-13T11:00:00.000Z", lastSuccessAt: "2026-11-13T11:00:00.000Z", usage: body() as never }] };
    const { db, written } = store([link()], previous);
    const result = await runPeerAiUsageSync(db, { fetchUsage: async () => ({ ok: false, status: 0, error: "fetch failed" }), decryptToken: () => "t", now });
    expect(result.pulled).toBe(0);
    expect(written()?.links[0]).toMatchObject({ outcome: "unreachable", lastSuccessAt: "2026-11-13T11:00:00.000Z", usage: expect.objectContaining({ originInstallationId: "inst_dev" }) });
  });

  it("refuses usage from an installation other than the one the link belongs to", async () => {
    const { db, written } = store([link()]);
    await runPeerAiUsageSync(db, { fetchUsage: async () => ({ ok: true, status: 200, body: body("inst_other") }), decryptToken: () => "t", now });
    expect(written()?.links[0]).toMatchObject({ outcome: "identity-mismatch", usage: null });
  });

  it("asks only same-organization peers", async () => {
    const fetchUsage = vi.fn(async () => ({ ok: true, status: 200, body: body() }));
    const { db } = store([link({ role: "managed-by" })]);
    const result = await runPeerAiUsageSync(db, { fetchUsage, decryptToken: () => "t", now });
    expect(fetchUsage).not.toHaveBeenCalled();
    expect(result.linksChecked).toBe(0);
  });

  it("says a link without a peer token cannot be asked", async () => {
    const { db, written } = store([link({ peerTokenEnc: null })]);
    await runPeerAiUsageSync(db, { fetchUsage: vi.fn(), decryptToken: () => null, now });
    expect(written()?.links[0]).toMatchObject({ outcome: "no-token" });
  });
});
