import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AttentionInbox } from "./AttentionInbox";
import { buildOwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { AttentionItem } from "@/lib/attention/types";

function bill(): AttentionItem {
  return {
    id: "approval-bill:BILL-1",
    source: "approval-bill",
    title: "Approve bill BILL-1",
    context: "GBP 240 due",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-17T12:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Review bill", href: "/finance/bills" }],
    deepLink: "/finance/bills",
    audience: { operator: true },
  };
}

function platformHealth(): AttentionItem {
  return {
    id: "platform-health:qdrant",
    source: "platform-health",
    title: "qdrant is offline",
    context: "Vector store degraded",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "no-self-heal",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-17T12:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Open health", href: "/ops/health" }],
    deepLink: "/ops/health",
    audience: { operator: true },
  };
}

describe("AttentionInbox", () => {
  it("renders the full owner projection without exposing the raw title by default", () => {
    const projection = buildOwnerAttentionProjection([bill()], {
      fallbackLevel: "balanced",
      nowMs: Date.parse("2026-07-17T18:00:00Z"),
    });
    const html = renderToStaticMarkup(
      <AttentionInbox projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("1 thing needs you today");
    expect(html).toContain("Approve this bill?");
    expect(html).not.toContain("Approve bill BILL-1");
    expect(html).not.toContain("Open in Operations");
  });

  it("shows a reassuring caught-up state when nothing needs the owner", () => {
    const projection = buildOwnerAttentionProjection([], {
      fallbackLevel: "balanced",
      nowMs: Date.parse("2026-07-17T18:00:00Z"),
    });
    const html = renderToStaticMarkup(
      <AttentionInbox projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("0 things need you today");
    expect(html).toContain("all caught up");
    expect(html).not.toContain("Your digital team is handling");
  });

  it("names what the digital team is handling in the caught-up state", () => {
    const projection = buildOwnerAttentionProjection([platformHealth()], {
      fallbackLevel: "balanced",
      nowMs: Date.parse("2026-07-17T18:00:00Z"),
    });
    // The technical item routes to the custodian lane, so the owner count is zero.
    expect(projection.count).toBe(0);
    expect(projection.custodian).toHaveLength(1);

    const html = renderToStaticMarkup(
      <AttentionInbox projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("0 things need you today");
    expect(html).toContain("all caught up");
    expect(html).toContain("Your digital team is handling 1 item");
    // The raw technical title is never surfaced to the owner.
    expect(html).not.toContain("qdrant is offline");
  });
});
