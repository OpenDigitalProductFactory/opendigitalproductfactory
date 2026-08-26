import { describe, expect, it } from "vitest";

import { translateAttentionToOwnerDecision } from "./owner-decision";
import type { AttentionItem, AttentionSource } from "./types";

function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "escalation:PIR-VOICE",
    source: "escalation",
    title: "Voice Slice 1.6 — Upgrade-to-GPU button in SpeechToTextCard",
    context: "The current voice typing path is slow.",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "self-fix-exhausted",
      blastRadius: "BI-VOICE-16",
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: "2026-07-17T12:00:00.000Z",
    actions: [
      { kind: "open-in-context", label: "View build", href: "/build?buildId=FB-VOICE-16" },
    ],
    deepLink: "/build?buildId=FB-VOICE-16",
    audience: { operator: true },
    ...over,
  };
}

describe("translateAttentionToOwnerDecision", () => {
  it("turns a raw engineering title into the approved owner question", () => {
    const card = translateAttentionToOwnerDecision(item(), Date.parse("2026-07-17T18:00:00Z"));

    expect(card.headline).toBe("Turn on faster voice typing?");
    expect(card.headline.split(/\s+/)).toHaveLength(5);
    expect(card.headline).not.toMatch(/\b(AI|API|DB|GPU|CI|CD)\b/);
    expect(card.whyItMatters).toMatch(/business|customer|team|work/i);
    expect(card.ifYouDoNothing.length).toBeGreaterThan(10);
    expect(card.recommendation.lead).toBe("AI recommendation");
    expect(card.recommendation.specialistByline).toBe("Platform operations");
  });

  it("surfaces the coworker's own context as the rationale for a blocked item", () => {
    const card = translateAttentionToOwnerDecision(
      item({
        source: "paused-ai",
        context: "Waiting for your OK to email the customer the revised quote.",
        triage: {
          timeToAct: "none",
          residueReason: "input-required",
          blastRadius: "a coworker task",
          decideEffort: "judgment",
          irreversible: false,
        },
      }),
      Date.parse("2026-07-17T18:00:00Z"),
    );

    expect(card.situation).toBe("Waiting for your OK to email the customer the revised quote.");
    // The vague placeholder blast radius must not leak into the impact line.
    expect(card.ifYouDoNothing).not.toMatch(/a coworker task/i);
    expect(card.ifYouDoNothing).toMatch(/stuck|waits/i);
  });

  it("omits the rationale line for a self-explanatory approval", () => {
    const card = translateAttentionToOwnerDecision(
      item({ source: "approval-bill", context: "GBP 240 due" }),
      Date.parse("2026-07-17T18:00:00Z"),
    );
    expect(card.situation).toBeUndefined();
  });

  it("keeps the raw title and builder references in technical detail", () => {
    const card = translateAttentionToOwnerDecision(item(), Date.parse("2026-07-17T18:00:00Z"));
    const details = Object.fromEntries(card.technical.fields.map((field) => [field.label, field.value]));

    expect(details["Original title"]).toBe(
      "Voice Slice 1.6 — Upgrade-to-GPU button in SpeechToTextCard",
    );
    expect(details["Backlog item"]).toBe("BI-VOICE-16");
    expect(details["Feature build"]).toBe("FB-VOICE-16");
    expect(details["Detected"]).toBe("2026-07-17T12:00:00.000Z");
    expect(card.technical.builderActions).toContainEqual(
      expect.objectContaining({ label: "Resume build", href: "/build?buildId=FB-VOICE-16" }),
    );
    expect(card.technical.builderActions).toContainEqual(
      expect.objectContaining({ label: "Open in Operations", href: "/ops" }),
    );
  });

  it("keeps a builder route out of Simple-view owner buttons", () => {
    const card = translateAttentionToOwnerDecision(
      item(),
      Date.parse("2026-07-17T18:00:00Z"),
      "worker",
    );

    expect(card.choices).toEqual([]);
    expect(card.technical.builderActions).toContainEqual(
      expect.objectContaining({ href: "/build?buildId=FB-VOICE-16" }),
    );
  });

  it("makes the builder route the primary action in Full view", () => {
    // Full view says "showing everything, including builder and platform tools",
    // so routing the reader to the surface that holds the record is honest.
    const card = translateAttentionToOwnerDecision(
      item(),
      Date.parse("2026-07-17T18:00:00Z"),
      "operator",
    );

    expect(card.choices).toContainEqual(
      expect.objectContaining({ href: "/build?buildId=FB-VOICE-16" }),
    );
    expect(card.handoff).toBeUndefined();
  });

  it.each<{
    source: AttentionSource;
    headline: string;
    tag: string;
  }>([
    { source: "approval-bill", headline: "Approve this bill?", tag: "Costs money" },
    { source: "approval-expense", headline: "Approve this expense?", tag: "Costs money" },
    { source: "approval-outbound", headline: "Send this message?", tag: "Goes public" },
    { source: "compliance-submission", headline: "File this report?", tag: "Goes public" },
    { source: "agent-proposal", headline: "Let this coworker do more?", tag: "Reversible" },
  ])("uses plain owner copy and word-based tags for $source", ({ source, headline, tag }) => {
    const card = translateAttentionToOwnerDecision(
      item({
        id: `${source}:1`,
        source,
        title: source === "agent-proposal" ? "Review proactivity: Balanced -> Assertive" : "RAW INTERNAL TITLE",
        deepLink: "/finance",
        actions: [{ kind: "open-in-context", label: "Review", href: "/finance" }],
        triage: {
          timeToAct: "due-soon",
          deadlineIso: "2026-07-20T12:00:00.000Z",
          residueReason: "policy-approval",
          decideEffort: "review",
          irreversible: false,
        },
      }),
      Date.parse("2026-07-17T12:00:00Z"),
    );

    expect(card.headline).toBe(headline);
    expect(card.tags.map((entry) => entry.label)).toContain(tag);
    expect(card.tags.map((entry) => entry.label)).toContain("Due in 3 days");
    expect(card.tags.map((entry) => entry.label)).not.toContain("High risk");
    expect(card.choices.length).toBeGreaterThanOrEqual(1);
    expect(card.choices.length).toBeLessThanOrEqual(3);
  });

  it("never exposes the raw title above technical detail", () => {
    const raw = "qdrant is offline";
    const card = translateAttentionToOwnerDecision(
      item({ source: "platform-health", title: raw, deepLink: "/ops/health" }),
      Date.now(),
    );

    expect([card.headline, card.whyItMatters, card.ifYouDoNothing, card.recommendation.text].join(" "))
      .not.toContain(raw);
    expect(card.technical.fields).toContainEqual({ label: "Original title", value: raw });
  });

  it("keeps raw coworker-memory content below technical detail", () => {
    const rawContext =
      "Integrate Orchestrator remembered a caution: OpenCode task failed with UnknownError. " +
      "Check server logs and apps/web/app/api/route.ts before retrying codex-gpt.";
    const card = translateAttentionToOwnerDecision(
      item({
        source: "coworker-memory",
        context: rawContext,
        deepLink: "/platform/ai/memory",
        actions: [
          { kind: "open-in-context", label: "Review memory", href: "/platform/ai/memory" },
        ],
        triage: {
          timeToAct: "none",
          residueReason: "new-memory-note",
          decideEffort: "review",
          irreversible: false,
        },
      }),
      Date.parse("2026-07-30T12:00:00Z"),
    );
    const collapsedOwnerCopy = [
      card.headline,
      card.situation,
      card.whyItMatters,
      card.ifYouDoNothing,
      card.recommendation.text,
      card.recommendation.specialistByline,
    ].filter(Boolean).join(" ");
    const details = Object.fromEntries(
      card.technical.fields.map((field) => [field.label, field.value]),
    );

    expect(card.situation).toBe("A coworker saved a new note from completed work.");
    expect(collapsedOwnerCopy).not.toMatch(
      /OpenCode|UnknownError|server logs|route\.ts|codex-gpt/i,
    );
    expect(details["Original context"]).toBe(rawContext);
  });

  it("keeps builder, platform, and admin routes below technical detail in Simple view", () => {
    const card = translateAttentionToOwnerDecision(
      item({
        id: "research-proposal:1",
        source: "research-proposal",
        actions: [{ kind: "open-in-context", label: "Review proposal", href: "/admin/research" }],
        deepLink: "/admin/research",
      }),
      Date.now(),
      "worker",
    );

    // No owner button at all — and specifically NOT the old self-link fallback,
    // which pointed at the page the card renders on and never did anything.
    expect(card.choices).toEqual([]);
    expect(card.handoff).toMatch(/technical detail/i);
    expect(card.technical.builderActions).toContainEqual(
      expect.objectContaining({ label: "Review proposal", href: "/admin/research" }),
    );
  });

  it("never offers a choice that links back to the surface the card renders on", () => {
    // The BI-90B6D8C5 regression guard, held for EVERY source and both views: the
    // old fallback was `/workspace/inbox?attentionId=<id>` on a card rendered at
    // /workspace/inbox, with no reader for the param anywhere — a guaranteed no-op.
    const sources: AttentionSource[] = [
      "escalation",
      "ai-decision",
      "business-journey",
      "paused-ai",
      "scheduled-task",
      "agent-proposal",
      "approval-outbound",
      "approval-bill",
      "approval-expense",
      "compliance-submission",
      "research-proposal",
      "coworker-memory",
      "ai-readiness-blocker",
      "platform-health",
      "provider-credential",
      "reservation-exception",
      "storefront-inquiry",
    ];
    const builderRailHrefs = [
      "/platform/ai/decisions/DI-1",
      "/ops/journeys?journey=storefront-booking",
      "/build?buildId=FB-1",
      "/admin/research",
    ];

    for (const source of sources) {
      for (const href of builderRailHrefs) {
        for (const audience of ["worker", "operator"] as const) {
          const card = translateAttentionToOwnerDecision(
            item({
              id: `${source}:no-op-guard`,
              source,
              actions: [{ kind: "open-in-context", label: "Open record", href }],
              deepLink: href,
            }),
            Date.parse("2026-07-29T12:00:00Z"),
            audience,
          );

          for (const choice of card.choices) {
            expect(choice.href).not.toMatch(/^\/workspace\/inbox\b/);
            expect(choice.href).not.toMatch(/\battentionId=/);
          }
          // A card with no button always explains itself instead.
          if (card.choices.length === 0) expect(card.handoff).toBeTruthy();
        }
      }
    }
  });

  it("names the build in the handoff when the blast radius carries one", () => {
    const card = translateAttentionToOwnerDecision(
      item({
        source: "ai-decision",
        actions: [{ kind: "open-in-context", label: "Review evidence", href: "/platform/ai/decisions/DI-1" }],
        deepLink: "/platform/ai/decisions/DI-1",
        triage: {
          timeToAct: "none",
          residueReason: "high-risk-gate",
          blastRadius: "build FB-1DB2A3B5",
          decideEffort: "judgment",
          irreversible: false,
        },
      }),
      Date.parse("2026-07-29T12:00:00Z"),
      "worker",
    );

    expect(card.handoff).toMatch(/build record/i);
    // The raw id stays below the fold, never in owner copy.
    expect(card.handoff).not.toMatch(/FB-1DB2A3B5/);
  });

  it("recovers the feature build id from the blast radius when the deep link has no query", () => {
    // An ai-decision deep link is /platform/ai/decisions/DI-… with no buildId
    // param, so query-only parsing reported "Not attached" on a card whose own
    // consequence line named the build (BI-90B6D8C5).
    const card = translateAttentionToOwnerDecision(
      item({
        source: "ai-decision",
        actions: [{ kind: "open-in-context", label: "Review evidence", href: "/platform/ai/decisions/DI-1" }],
        deepLink: "/platform/ai/decisions/DI-1",
        triage: {
          timeToAct: "none",
          residueReason: "high-risk-gate",
          blastRadius: "build FB-1DB2A3B5",
          decideEffort: "judgment",
          irreversible: false,
        },
      }),
      Date.parse("2026-07-29T12:00:00Z"),
    );
    const details = Object.fromEntries(
      card.technical.fields.map((field) => [field.label, field.value]),
    );

    expect(details["Feature build"]).toBe("FB-1DB2A3B5");
    expect(card.technical.builderActions).toContainEqual(
      expect.objectContaining({ label: "Resume build", href: "/build?buildId=FB-1DB2A3B5" }),
    );
  });

  // A deadline tag must never contradict the exact expiry printed on the same
  // card. Every span below used to render "Due in 1 day" (BI-7CB2CCDE follow-up).
  describe("deadline tag precision", () => {
    const NOW = Date.parse("2026-08-25T23:35:00.000Z");

    function tagFor(deadlineIso: string): string | undefined {
      const card = translateAttentionToOwnerDecision(
        item({
          source: "approval-bill",
          triage: {
            timeToAct: "due-soon",
            deadlineIso,
            residueReason: "policy-approval",
            decideEffort: "review",
            irreversible: false,
          },
        }),
        NOW,
      );
      return card.tags.find((tag) => tag.kind === "deadline")?.label;
    }

    it("reports a minutes-wide window in minutes, not as a day", () => {
      expect(tagFor("2026-08-25T23:38:00.000Z")).toBe("Due in 3 minutes");
      // The exact envelope observed on the live install: 3m30.687s remaining,
      // which previously rendered "Due in 1 day".
      expect(tagFor("2026-08-25T23:38:30.687Z")).toBe("Due in 4 minutes");
    });

    it("keeps a one-minute window singular and never rounds it to zero", () => {
      expect(tagFor("2026-08-25T23:35:20.000Z")).toBe("Due in 1 minute");
      expect(tagFor("2026-08-25T23:36:00.000Z")).toBe("Due in 1 minute");
    });

    it("reports an hours-wide window in hours", () => {
      expect(tagFor("2026-08-26T05:35:00.000Z")).toBe("Due in 6 hours");
      expect(tagFor("2026-08-26T00:35:00.000Z")).toBe("Due in 1 hour");
    });

    it("still reports day-scale deadlines in days", () => {
      expect(tagFor("2026-08-28T23:35:00.000Z")).toBe("Due in 3 days");
      expect(tagFor("2026-08-26T23:35:00.000Z")).toBe("Due in 1 day");
    });

    it("calls an elapsed deadline past due", () => {
      expect(tagFor("2026-08-25T23:34:59.000Z")).toBe("Past due");
      expect(tagFor("2026-08-25T23:35:00.000Z")).toBe("Past due");
      expect(tagFor("2026-08-24T23:35:00.000Z")).toBe("Past due");
    });
  });

  it.each<AttentionSource>([
    "escalation",
    "ai-decision",
    "paused-ai",
    "scheduled-task",
    "agent-proposal",
    "approval-outbound",
    "approval-bill",
    "approval-expense",
    "compliance-submission",
    "research-proposal",
    "coworker-memory",
    "ai-readiness-blocker",
    "platform-health",
    "provider-credential",
  ])("keeps every %s card short and free of bare technical acronyms", (source) => {
    const card = translateAttentionToOwnerDecision(
      item({
        id: `${source}:plain-copy`,
        source,
        title: "RAW API GPU DB AI INTERNAL TITLE",
        triage: {
          timeToAct: "none",
          residueReason: "policy-approval",
          decideEffort: "review",
          irreversible: false,
        },
      }),
      Date.parse("2026-07-17T12:00:00Z"),
    );
    const ownerCopy = [
      card.headline,
      card.whyItMatters,
      card.ifYouDoNothing,
      card.recommendation.text,
      card.recommendation.specialistByline,
      ...card.choices.map((choice) => choice.label),
    ].join(" ");

    expect(card.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(ownerCopy).not.toMatch(/\b(?:AI|API|DB|GPU|CI|CD)\b/);
  });
});
