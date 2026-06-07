import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  parseInboundPayload,
  verifyInboundSignature,
} from "./client";

describe("verifyInboundSignature", () => {
  const secret = "test-signing-secret";
  const body = JSON.stringify({ MessageID: "abc", From: "x@y.com", Subject: "Hi" });
  const correct = createHmac("sha256", secret).update(body, "utf8").digest("base64");

  it("returns true when signature matches", () => {
    expect(
      verifyInboundSignature({
        rawBody: body,
        signatureHeader: correct,
        signingSecret: secret,
      }),
    ).toBe(true);
  });

  it("returns false when signature is wrong", () => {
    expect(
      verifyInboundSignature({
        rawBody: body,
        signatureHeader: "AAAAAAAAAAAAAA==",
        signingSecret: secret,
      }),
    ).toBe(false);
  });

  it("returns false when signature header is missing", () => {
    expect(
      verifyInboundSignature({
        rawBody: body,
        signatureHeader: null,
        signingSecret: secret,
      }),
    ).toBe(false);
  });

  it("returns false when secret is empty", () => {
    expect(
      verifyInboundSignature({
        rawBody: body,
        signatureHeader: correct,
        signingSecret: "",
      }),
    ).toBe(false);
  });

  it("returns false when body is tampered", () => {
    expect(
      verifyInboundSignature({
        rawBody: body + " ",
        signatureHeader: correct,
        signingSecret: secret,
      }),
    ).toBe(false);
  });
});

describe("parseInboundPayload", () => {
  it("parses a typical Postmark inbound shape", () => {
    const parsed = parseInboundPayload({
      MessageID: "MSG-1",
      Date: "Tue, 27 May 2026 03:00:00 GMT",
      Subject: "Hello there",
      FromFull: { Email: "founder@example.com", Name: "Tech Founder" },
      To: "you@yourdomain.example",
      TextBody: "Hi — interested in the platform.",
      StrippedTextReply: "",
      Headers: [{ Name: "In-Reply-To", Value: "<previous-message>" }],
      MessageStream: "inbound",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.externalMessageId).toBe("MSG-1");
    expect(parsed?.externalThreadId).toBe("<previous-message>");
    expect(parsed?.fromAddress).toBe("founder@example.com");
    expect(parsed?.fromDisplayName).toBe("Tech Founder");
    expect(parsed?.subject).toBe("Hello there");
    expect(parsed?.textBody).toBe("Hi — interested in the platform.");
  });

  it("prefers StrippedTextReply when present", () => {
    const parsed = parseInboundPayload({
      MessageID: "MSG-2",
      TextBody: "Full quoted thread",
      StrippedTextReply: "Just the new reply",
    });
    expect(parsed?.textBody).toBe("Just the new reply");
  });

  it("falls back to MessageID for threadId when no In-Reply-To header", () => {
    const parsed = parseInboundPayload({ MessageID: "MSG-3", TextBody: "x" });
    expect(parsed?.externalThreadId).toBe("MSG-3");
  });

  it("returns null on missing MessageID", () => {
    expect(parseInboundPayload({ TextBody: "no id" })).toBeNull();
    expect(parseInboundPayload(null)).toBeNull();
    expect(parseInboundPayload("string")).toBeNull();
  });
});
