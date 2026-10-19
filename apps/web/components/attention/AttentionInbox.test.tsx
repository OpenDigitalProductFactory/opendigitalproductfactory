import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AttentionInbox as Inbox } from "./AttentionInbox";
import { translate } from "@dpf/i18n";
import type { ComponentProps } from "react";

function AttentionInbox(props: ComponentProps<typeof Inbox>) {
  return <Inbox {...props} approvalCopy={{
    displayedCount: translate("en-US", "approvals", "queue.displayedCount", { count: props.projection.count }),
    summary: translate("en-US", "approvals", "queue.summary", { count: props.approvalQueue?.total ?? 0, shown: props.approvalQueue?.shown ?? 0 }),
    explanation: translate("en-US", "approvals", "queue.explanation", { count: props.projection.needsYouNow.filter(entry => !entry.item.envelope).length }),
    latest: translate("en-US", "approvals", "queue.latest"), older: translate("en-US", "approvals", "queue.older"), unavailable: translate("en-US", "approvals", "queue.unavailable"),
  }} />;
}
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
    id: "platform-health:redis",
    source: "platform-health",
    title: "redis is offline",
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
  it("distinguishes the full approval queue from displayed notices and exposes older requests", () => {
    const projection = buildOwnerAttentionProjection([bill()], { nowMs: 0 });
    const html = renderToStaticMarkup(<AttentionInbox projection={projection} failedSources={[]}
      approvalQueue={{ total: 30, shown: 25, nextCursor: "2026-10-18T10:00:00.000Z|env-005", browsingOlder: false }} />);
    expect(html).toContain("30 pending approvals; 25 shown.");
    expect(html).toContain("Other notices: 1");
    expect(html).toContain("Older requests");
    expect(html).toContain("approvalsBefore=2026-10-18T10%3A00%3A00.000Z%7Cenv-005");
    expect(html).not.toContain("1 thing needs you today");
  });

  it("never reports caught up when queue reading failed or an older window is empty", () => {
    const projection = buildOwnerAttentionProjection([], { nowMs: 0 });
    const failed = renderToStaticMarkup(<AttentionInbox projection={projection} failedSources={["coworker-envelope"]} approvalQueue={null} />);
    expect(failed).toContain("Approvals unavailable");
    expect(failed).not.toContain("all caught up");
    const old = renderToStaticMarkup(<AttentionInbox projection={projection} failedSources={[]}
      approvalQueue={{ total: 4, shown: 0, nextCursor: null, browsingOlder: true }} />);
    expect(old).toContain("Latest requests");
    expect(old).not.toContain("all caught up");
  });

  it("renders the full owner projection without exposing the raw title by default", () => {
    const projection = buildOwnerAttentionProjection([bill()], {
      fallbackLevel: "balanced",
      nowMs: Date.parse("2026-07-17T18:00:00Z"),
    });
    const html = renderToStaticMarkup(
      <AttentionInbox projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("1 item shown for your attention");
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

    expect(html).toContain("0 items shown for your attention");
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

    expect(html).toContain("0 items shown for your attention");
    expect(html).toContain("all caught up");
    expect(html).toContain("Your digital team is handling 1 item");
    // The raw technical title is never surfaced to the owner.
    expect(html).not.toContain("redis is offline");
  });
});
