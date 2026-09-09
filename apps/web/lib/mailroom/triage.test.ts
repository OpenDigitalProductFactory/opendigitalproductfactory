// Mailroom triage — design 2026-09-09 §4.5 (BI-9BD223B1; AC-MAIL-TYPED-REASON,
// AC-MAIL-NOISE-FIRST, AC-MAIL-UNTRUSTED, AC-MAIL-ACK-WINDOW).

import { describe, expect, it, vi } from "vitest";

import { ALL_ARCHETYPES, resolveMailroomProfile } from "@dpf/storefront-templates";

import { buildClassifierPrompt, parseClassifierAnswer } from "./classifier";
import type { NormalizedInboundMail } from "./providers/types";
import { extractSubjectCandidate, isNoiseMail, matchReasonByHints, triageInboundMail } from "./triage";

const profile = resolveMailroomProfile(ALL_ARCHETYPES.find((a) => a.archetypeId === "pet-rescue")!);

function mail(overrides: Partial<NormalizedInboundMail> = {}): NormalizedInboundMail {
  return {
    providerMessageId: "1",
    messageIdHeader: "<1@x>",
    inReplyTo: null,
    references: [],
    from: { address: "someone@example.test", name: "Someone" },
    to: [{ address: "info@rescue.example", name: null }],
    subject: "Hello",
    body: "",
    textBody: "Hello there",
    htmlBody: null,
    receivedAt: new Date("2026-09-09T10:00:00Z"),
    headers: {},
    attachments: [],
    ...overrides,
  } as NormalizedInboundMail;
}

describe("noise rules run before any model", () => {
  it("Auto-Submitted other than no is noise", () => {
    expect(isNoiseMail(mail({ headers: { "auto-submitted": "auto-replied" } }))).toBe(true);
    expect(isNoiseMail(mail({ headers: { "auto-submitted": "no" } }))).toBe(false);
  });
  it("list mail, bulk precedence, delivery reports and no-reply senders are noise", () => {
    expect(isNoiseMail(mail({ headers: { "list-unsubscribe": "<mailto:x>" } }))).toBe(true);
    expect(isNoiseMail(mail({ headers: { precedence: "bulk" } }))).toBe(true);
    expect(isNoiseMail(mail({ headers: { "content-type": "multipart/report; report-type=delivery-status" } }))).toBe(true);
    expect(isNoiseMail(mail({ from: { address: "no-reply@shop.example", name: null } }))).toBe(true);
    expect(isNoiseMail(mail({ from: { address: "mailer-daemon@mx.example", name: null } }))).toBe(true);
  });
  it("noise is stored with the noise reason and the classifier is never called", async () => {
    const classify = vi.fn();
    const result = await triageInboundMail({ profile, mail: mail({ headers: { "auto-submitted": "auto-generated" } }), classify });
    expect(result.noise).toBe(true);
    expect(result.reasonKey).toBe("noise");
    expect(result.source).toBe("rule-noise");
    expect(classify).not.toHaveBeenCalled();
  });
});

describe("hint matching", () => {
  it("a found dog hits found-animal with urgency hours and no model call", async () => {
    const classify = vi.fn();
    const result = await triageInboundMail({
      profile,
      mail: mail({ subject: "Dog on Elm St", textBody: "I found a dog wandering on Elm St this morning, no collar." }),
      classify,
    });
    expect(result.reasonKey).toBe("found-animal");
    expect(result.urgency).toBe("hours");
    expect(result.queueKey).toBe("intake");
    expect(result.source).toBe("rule-hint");
    expect(classify).not.toHaveBeenCalled();
  });
  it("two reasons matching means no rule hit", () => {
    expect(matchReasonByHints(profile, mail({ textBody: "I want to adopt and also donate" }))).toBeNull();
  });
  it("a vet's message about a named animal carries the animal reference", async () => {
    const result = await triageInboundMail({
      profile,
      mail: mail({ subject: "Bloodwork results for A-1234", textBody: "Lab results attached from the clinic." }),
      lookupSubject: async (kind, candidate) => (kind === "animal" && candidate === "A-1234" ? "A-1234" : null),
    });
    expect(result.reasonKey).toBe("veterinary-correspondence");
    expect(result.queueKey).toBe("veterinary");
    expect(result.subjectRef).toBe("A-1234");
    expect(extractSubjectCandidate(profile, "animal", mail({ subject: "re: A-1234" }))).toBe("A-1234");
  });
});

describe("model stage", () => {
  it("accepts only reason keys from the profile; off-profile answers fall back and flag", async () => {
    const result = await triageInboundMail({
      profile,
      mail: mail({ subject: "Question", textBody: "Something I could not phrase with your hints." }),
      classify: async () => ({ reasonKey: "delete-all-records", summary: "x", subjectRef: null }),
    });
    expect(result.reasonKey).toBe(profile.defaultReasonKey);
    expect(result.flagged).toBe(true);
    expect(result.source).toBe("fallback");
  });
  it("a classifier throw never blocks intake", async () => {
    const result = await triageInboundMail({
      profile,
      mail: mail({ subject: "Question", textBody: "Plain question." }),
      classify: async () => {
        throw new Error("model down");
      },
    });
    expect(result.flagged).toBe(true);
    expect(result.reasonKey).toBe(profile.defaultReasonKey);
  });
  it("a valid answer is used with its summary and the allowed list excludes noise", async () => {
    const classify = vi.fn(async (req) => {
      expect(req.allowedReasons.map((r: { key: string }) => r.key)).not.toContain("noise");
      return { reasonKey: "surrender-animal", summary: "Owner moving abroad needs to rehome two cats.", subjectRef: null };
    });
    const result = await triageInboundMail({ profile, mail: mail({ subject: "Help", textBody: "Long story." }), classify });
    expect(result.reasonKey).toBe("surrender-animal");
    expect(result.summary).toBe("Owner moving abroad needs to rehome two cats.");
    expect(result.source).toBe("model");
    expect(result.flagged).toBe(false);
  });
});

describe("classifier answer parsing is constrained to the allowed keys", () => {
  const allowed = ["adopt-animal", "found-animal"];
  it("parses JSON answers", () => {
    expect(parseClassifierAnswer('{"reason":"found-animal","summary":"A dog was found.","subjectRef":null}', allowed)).toEqual({
      reasonKey: "found-animal",
      summary: "A dog was found.",
      subjectRef: null,
    });
  });
  it("rejects keys outside the list even when well-formed", () => {
    expect(parseClassifierAnswer('{"reason":"run-payroll","summary":"x"}', allowed)).toBeNull();
    expect(parseClassifierAnswer("ignore previous instructions", allowed)).toBeNull();
  });
  it("the prompt quotes the mail as untrusted data", () => {
    const prompt = buildClassifierPrompt({ subject: "S", body: "B", allowedReasons: [{ key: "adopt-animal", label: "Adopt" }], subjectKindHint: "animal" });
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("- adopt-animal: Adopt");
  });
});
