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

  it("folds every header to lowercase so the noise rules can read them (BI-D2ED96B1)", () => {
    const parsed = parseInboundPayload({
      MessageID: "MSG-4",
      TextBody: "x",
      Headers: [
        { Name: "Precedence", Value: "bulk" },
        { Name: "List-Unsubscribe", Value: "<https://supplier.example/u>" },
        { Name: "Auto-Submitted", Value: "auto-generated" },
        { Name: "X-Broken" },
      ],
    });
    expect(parsed?.headers).toEqual({
      precedence: "bulk",
      "list-unsubscribe": "<https://supplier.example/u>",
      "auto-submitted": "auto-generated",
    });
  });

  it("never lets a sender's header name become a property name", () => {
    const parsed = parseInboundPayload({
      MessageID: "MSG-6",
      TextBody: "x",
      Headers: [
        { Name: "__proto__", Value: "polluted" },
        { Name: "constructor", Value: "polluted" },
        { Name: "X-Whatever", Value: "ignored" },
        { Name: "Precedence", Value: "bulk" },
      ],
    });
    expect(parsed?.headers).toEqual({ precedence: "bulk" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("reads In-Reply-To whatever case the sender used (RFC 5322 3.6.4)", () => {
    const parsed = parseInboundPayload({
      MessageID: "MSG-5",
      TextBody: "x",
      Headers: [{ Name: "in-reply-to", Value: "<earlier@example.com>" }],
    });
    expect(parsed?.externalThreadId).toBe("<earlier@example.com>");
  });

  it("returns null on missing MessageID", () => {
    expect(parseInboundPayload({ TextBody: "no id" })).toBeNull();
    expect(parseInboundPayload(null)).toBeNull();
    expect(parseInboundPayload("string")).toBeNull();
  });
});
