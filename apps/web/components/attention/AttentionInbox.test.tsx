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
});
