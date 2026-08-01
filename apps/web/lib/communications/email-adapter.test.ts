import { describe, expect, it, vi } from "vitest";

import { createEmailAdapter, resolveEmailAdapterConfig } from "./email-adapter";
import { createCommunicationDispatcher } from "./dispatcher";
import type { SendCommunicationInput } from "./channel-types";

vi.mock("./delivery-evidence", () => ({
  recordDeliveryAttempt: vi.fn(async () => undefined),
}));

function okFetch(messageId = "pm-1") {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ MessageID: messageId, SubmittedAt: "2026-08-01T12:00:00Z" }),
    text: async () => "",
  }));
}

function input(overrides: Partial<SendCommunicationInput> = {}): SendCommunicationInput {
  return {
    channel: "email",
    target: { targetType: "notification", targetId: "n1" },
    title: "A bill needs your approval",
    body: "A bill needs your approval.\n\nOpen it here:\nhttps://example.test/r/tok",
    urgency: "priority",
    metadata: { emailAddress: "owner@example.test" },
    ...overrides,
  };
}

describe("email adapter capabilities are an honest contract", () => {
  it("declares interactive:false — this channel cannot carry an action", () => {
    // The machine-readable form of kernel DI-EFEB6002A5C5. Flipping this is the moment the
    // per-class security review (BI-C7D25599 Open Decision 3) becomes mandatory.
    const adapter = createEmailAdapter({ serverToken: "t", from: "f@example.test" });
    expect(adapter.capabilities.interactive).toBe(false);
  });

  it("does not claim inbound just because the client can parse it", () => {
    const adapter = createEmailAdapter({ serverToken: "t", from: "f@example.test" });
    expect(adapter.capabilities.inbound).toBe(false);
  });
});

describe("email adapter send", () => {
  it("registers for the email channel so dispatch stops failing adapter_not_registered", async () => {
    const fetchImpl = okFetch();
    const dispatcher = createCommunicationDispatcher([
      createEmailAdapter({ serverToken: "t", from: "f@example.test", fetchImpl }),
    ]);

    const result = await dispatcher.send(input());

    expect(result.status).toBe("sent");
    expect(result.providerMessageId).toBe("pm-1");
  });

  it("sends the composed subject and body unchanged", async () => {
    const fetchImpl = okFetch();
    const adapter = createEmailAdapter({ serverToken: "t", from: "f@example.test", fetchImpl });

    await adapter.send(input());

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.Subject).toBe("A bill needs your approval");
    expect(body.To).toBe("owner@example.test");
    expect(body.Tag).toBe("attention-reach");
  });

  it("fails closed with no recipient rather than sending nowhere", async () => {
    const fetchImpl = okFetch();
    const adapter = createEmailAdapter({ serverToken: "t", from: "f@example.test", fetchImpl });

    const result = await adapter.send(input({ metadata: {} }));

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("no_recipient_address");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["header injection", "owner@example.test\r\nBcc: evil@evil.test"],
    ["comma list", "owner@example.test,evil@evil.test"],
    ["angle brackets", "<evil@evil.test>"],
    ["no domain", "owner"],
    ["whitespace", "owner @example.test"],
  ])("rejects a malformed recipient (%s)", async (_label, address) => {
    const fetchImpl = okFetch();
    const adapter = createEmailAdapter({ serverToken: "t", from: "f@example.test", fetchImpl });

    const result = await adapter.send(input({ metadata: { emailAddress: address } }));

    expect(result.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a provider rejection as failed rather than silently succeeding", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: false,
      status: 422,
      json: async () => ({ ErrorCode: 300, Message: "Invalid sender" }),
      text: async () => "",
    }));
    const adapter = createEmailAdapter({ serverToken: "t", from: "f@example.test", fetchImpl });

    const result = await adapter.send(input());

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("422");
  });
});

describe("resolveEmailAdapterConfig", () => {
  it("returns null when email is not configured — an honest 'not available'", () => {
    expect(resolveEmailAdapterConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      resolveEmailAdapterConfig({ POSTMARK_SERVER_TOKEN: "t" } as unknown as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("resolves when a token and sender are present", () => {
    const config = resolveEmailAdapterConfig({
      POSTMARK_SERVER_TOKEN: "t",
      POSTMARK_FROM_EMAIL: "f@example.test",
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toEqual({ serverToken: "t", from: "f@example.test" });
  });
});
