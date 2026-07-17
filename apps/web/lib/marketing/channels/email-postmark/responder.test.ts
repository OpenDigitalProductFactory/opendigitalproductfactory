import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  draft: null as null | { draftId: string },
  engagement: null as null | { id: string },
  draftCreates: 0,
  engagementCreates: 0,
  crashOnce: false,
}));

vi.mock("@dpf/db", () => {
  const inbound = {
    inboundId: "inbound-concurrent-12345678", organizationId: "org-1", fromAddress: "founder@example.com",
    fromDisplayName: "Founder", subject: "Interested", body: "I am interested in learning much more about this platform.",
    externalMessageId: "MSG-1", classification: null, routedEngagementId: null, draftedReplyId: null,
  };
  const prisma: Record<string, unknown> = {};
  Object.assign(prisma, {
    inboundChannelMessage: {
      findUnique: async () => inbound,
      update: async ({ data }: any) => {
        if (h.crashOnce) { h.crashOnce = false; throw new Error("injected transaction crash"); }
        Object.assign(inbound, data); return inbound;
      },
    },
    customerContact: { findUnique: async () => ({ id: "contact-1", accountId: "account-1" }) },
    engagement: { upsert: async () => { if (!h.engagement) { h.engagement = { id: "engagement-1" }; h.engagementCreates += 1; } return h.engagement; } },
    outboundDraft: {
      findFirst: async () => h.draft,
      create: async () => {
        if (h.draft) throw Object.assign(new Error("partial unique conflict"), { code: "P2002" });
        h.draftCreates += 1; h.draft = { draftId: "draft-1" }; return h.draft;
      },
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({ draft: h.draft, engagement: h.engagement, draftCreates: h.draftCreates, engagementCreates: h.engagementCreates });
      try { return await operation(prisma); }
      catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) Object.assign(h, snapshot);
        throw error;
      }
    },
  });
  return { prisma };
});

import { runInboundResponder } from "./responder";

beforeEach(() => {
  h.draft = null; h.engagement = null; h.draftCreates = 0; h.engagementCreates = 0; h.crashOnce = false;
});

describe("durable Postmark responder", () => {
  it("allows one cross-worker claim and replays the completed result without duplicate effects", async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const classify = async () => { arrivals += 1; if (arrivals === 2) release(); await barrier; return "qualified-inquiry" as const; };
    const [first, concurrent] = await Promise.allSettled([
      runInboundResponder({ inboundId: "inbound-concurrent-12345678", classify }),
      runInboundResponder({ inboundId: "inbound-concurrent-12345678", classify }),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(concurrent.status).toBe("rejected");
    await expect(runInboundResponder({ inboundId: "inbound-concurrent-12345678", classify: async () => "qualified-inquiry" })).resolves.toMatchObject({ draftId: "draft-1", engagementId: "engagement-1" });
    expect(h.draftCreates).toBe(1);
    expect(h.engagementCreates).toBe(1);
  });

  it("rolls back draft and engagement on a crash and recovers after lease expiry", async () => {
    h.crashOnce = true;
    await expect(runInboundResponder({ inboundId: "inbound-concurrent-12345678", classify: async () => "qualified-inquiry" })).rejects.toThrow("injected transaction crash");
    expect(h.draft).toBeNull();
    expect(h.engagement).toBeNull();
    await expect(runInboundResponder({ inboundId: "inbound-concurrent-12345678", classify: async () => "qualified-inquiry" })).resolves.toMatchObject({ draftId: "draft-1", engagementId: "engagement-1" });
    expect(h.draftCreates).toBe(1);
    expect(h.engagementCreates).toBe(1);
  });
});
