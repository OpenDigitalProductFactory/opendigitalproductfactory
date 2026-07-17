import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  credential: { status: "connected", fieldsEnc: "x", tokenCacheEnc: "y" } as unknown,
  organization: { id: "org-oldest" } as { id: string } | null,
  stored: { signingSecret: "sig", fromAddress: "a@b.com", replyToAddress: null, serverToken: "token" } as unknown,
  verified: true,
  parsed: { externalMessageId: "MSG-1", externalThreadId: "THREAD-1", fromAddress: "from@example.com", fromDisplayName: "Founder", subject: "Hello", textBody: "Body", receivedAt: new Date("2026-01-01"), metadata: { stream: "inbound" } } as unknown,
  create: vi.fn(), responder: vi.fn(), audit: vi.fn(), execute: vi.fn(), verify: vi.fn(), parse: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {
  integrationCredential: { findUnique: vi.fn(async () => h.credential) },
  organization: { findFirst: vi.fn(async () => h.organization) },
  integrationToolCallLog: { create: vi.fn() }, inboundChannelMessage: { create: h.create },
} }));
vi.mock("@/lib/integrations/connectors/email-postmark", () => ({ readStoredEmailPostmarkCredential: vi.fn(() => h.stored) }));
vi.mock("@/lib/marketing/channels/email-postmark/client", () => ({
  verifyInboundSignature: h.verify,
  parseInboundPayload: h.parse,
}));
vi.mock("@/lib/marketing/channels/email-postmark/responder", () => ({ runInboundResponder: h.responder }));
vi.mock("@/lib/integrations/kernel/audit", () => ({
  createDurableConnectorAudit: () => ({ record: h.audit }),
  executeCallbackTransaction: h.execute,
}));

import { POST } from "./route";

function request(body = JSON.stringify({ MessageID: "MSG-1" })) {
  const text = vi.fn(async () => body);
  return { text, headers: new Headers({ "x-postmark-signature": "signature" }) };
}

beforeEach(() => {
  h.credential = { status: "connected", fieldsEnc: "x", tokenCacheEnc: "y" };
  h.organization = { id: "org-oldest" };
  h.stored = { signingSecret: "sig", fromAddress: "a@b.com", replyToAddress: null, serverToken: "token" };
  h.verified = true;
  h.parsed = { externalMessageId: "MSG-1", externalThreadId: "THREAD-1", fromAddress: "from@example.com", fromDisplayName: "Founder", subject: "Hello", textBody: "Body", receivedAt: new Date("2026-01-01"), metadata: { stream: "inbound" } };
  vi.clearAllMocks();
  h.verify.mockImplementation(() => h.verified);
  h.parse.mockImplementation(() => h.parsed);
  h.create.mockResolvedValue({ inboundId: "inbound-1" });
  h.responder.mockResolvedValue({});
  h.audit.mockResolvedValue(undefined);
  let completed: { responseCode: number; domainEntityId: string; acknowledgment: unknown } | null = null;
  h.execute.mockImplementation(async (input) => {
    if (input.responder && completed) {
      await input.responder(completed.domainEntityId);
      return { ...completed, replayed: true, operationalErrors: [] };
    }
    const domain = await input.performDomainWrite({ inboundChannelMessage: { create: h.create } });
    completed = domain;
    return { ...domain, replayed: false, operationalErrors: [] };
  });
});

describe("Postmark inbound compatibility", () => {
  it.each([
    ["disconnected", 503, "integration_not_connected"],
    ["missing-secret", 500, "signing_secret_missing"],
    ["invalid-signature", 401, "invalid_signature"],
    ["invalid-json", 400, "invalid_json"],
    ["malformed", 400, "malformed_payload"],
    ["no-org", 500, "no_organization"],
  ])("preserves %s response", async (kind, status, error) => {
    if (kind === "disconnected") h.credential = null;
    if (kind === "missing-secret") h.stored = null;
    if (kind === "invalid-signature") h.verified = false;
    if (kind === "malformed") h.parsed = null;
    if (kind === "no-org") h.organization = null;
    const req = request(kind === "invalid-json" ? "{" : undefined);
    const response = await POST(req as never);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(req.text).toHaveBeenCalledTimes(1);
    if (kind === "invalid-signature") expect(h.parse).not.toHaveBeenCalled();
  });

  it("preserves every domain mapping and delegates idempotency to the kernel transaction", async () => {
    const req = request();
    const response = await POST(req as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, inboundId: "inbound-1" });
    expect(h.create).toHaveBeenCalledWith({ data: {
      organizationId: "org-oldest", domain: "marketing", channelId: "email-postmark",
      externalThreadId: "THREAD-1", externalMessageId: "MSG-1", fromAddress: "from@example.com",
      fromDisplayName: "Founder", subject: "Hello", body: "Body", receivedAt: new Date("2026-01-01"),
      metadata: { stream: "inbound" },
    }, select: { inboundId: true } });
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ connectorId: "email-postmark", deliveryKey: "MSG-1" }));
    await vi.waitFor(() => expect(h.execute).toHaveBeenCalledTimes(2));
    expect(h.responder).toHaveBeenCalledWith({ inboundId: "inbound-1" });
  });
});
