import { describe, expect, it } from "vitest";

import {
  createEmailPostmarkConnectorAdapter,
  emailPostmarkDefinition,
  readStoredEmailPostmarkCredential,
} from "./email-postmark";

describe("emailPostmarkDefinition", () => {
  it("declares the stable API-key/webhook contract with unique capabilities", () => {
    expect(emailPostmarkDefinition).toMatchObject({
      schemaVersion: 1,
      key: "email-postmark",
      auth: { kind: "api-key" },
      callback: { kind: "webhook" },
      sync: { kind: "none" },
    });
    expect(emailPostmarkDefinition.capabilities).toEqual([
      "communications.email.send",
      "communications.email.receive",
    ]);
    expect(new Set(emailPostmarkDefinition.capabilities).size).toBe(2);
  });
});

describe("Postmark credential adapter", () => {
  it("maps vendor fields while exposing only a safe setup projection", async () => {
    const connected = await createEmailPostmarkConnectorAdapter().connect({
      serverToken: "server-secret",
      signingSecret: "signing-secret",
      fromAddress: "sender@example.com",
      replyToAddress: "reply@example.com",
    });
    expect(connected.credential).toMatchObject({
      integrationId: "email-postmark",
      provider: "postmark",
      reconnectFields: { fromAddress: "sender@example.com", replyToAddress: "reply@example.com" },
      secretFields: { signingSecret: "signing-secret" },
      tokenEnvelope: { serverToken: "server-secret" },
      safeProjection: { fromAddress: "sender@example.com", replyToAddress: "reply@example.com" },
    });
    expect(JSON.stringify(connected.credential.safeProjection)).not.toContain("secret");
  });

  it("rejects incomplete and invalid replacement input before producing a credential", async () => {
    await expect(createEmailPostmarkConnectorAdapter().connect({
      serverToken: "new-token", signingSecret: "new-signature", fromAddress: "invalid",
    })).rejects.toMatchObject({ kind: "configuration" });
  });

  it("reads both kernel envelopes and legacy records", () => {
    const encrypt = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
    const decrypt = (stored: string) => JSON.parse(Buffer.from(stored, "base64").toString());
    expect(readStoredEmailPostmarkCredential({
      fieldsEnc: encrypt({ schemaVersion: 1, reconnectFields: { fromAddress: "a@b.com", replyToAddress: null }, secretFields: { signingSecret: "sig" }, safeProjection: {} }),
      tokenCacheEnc: encrypt({ schemaVersion: 1, tokenEnvelope: { serverToken: "token" } }),
    }, decrypt)).toEqual({ fromAddress: "a@b.com", replyToAddress: null, signingSecret: "sig", serverToken: "token" });
    expect(readStoredEmailPostmarkCredential({
      fieldsEnc: encrypt({ fromAddress: "a@b.com", signingSecret: "sig" }),
      tokenCacheEnc: encrypt({ server_token: "token" }),
    }, decrypt)).toEqual({ fromAddress: "a@b.com", replyToAddress: null, signingSecret: "sig", serverToken: "token" });
  });
});
