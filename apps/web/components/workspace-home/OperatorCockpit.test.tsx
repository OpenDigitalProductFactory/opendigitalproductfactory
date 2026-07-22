import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatorCockpitView } from "./OperatorCockpit";
import { buildOwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { AttentionItem, AttentionSource } from "@/lib/attention/types";

function item(
  source: AttentionSource,
  over: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    id: `${source}:1`,
    source,
    title: source,
    context: "context",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-11T00:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Review", href: "/review" }],
    deepLink: "/review",
    audience: { operator: true },
    ...over,
  };
}

const NOW = Date.parse("2026-07-11T12:00:00.000Z");

describe("OperatorCockpitView", () => {
  it("leads with the calm owner count and shared decision cards", () => {
    const projection = buildOwnerAttentionProjection(
      [item("approval-bill"), item("approval-outbound", { id: "approval-outbound:2" })],
      { nowMs: NOW, fallbackLevel: "balanced" },
    );
    const html = renderToStaticMarkup(
      <OperatorCockpitView projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("What needs you now");
    expect(html).toContain("2 things need you today");
    expect(html).toContain("Approve this bill?");
    expect(html).toContain("Send this message?");
    expect(html).toContain("AI recommendation");
    expect(html).not.toContain("3040");
    expect(html).not.toContain("high-risk");
  });

  it("routes platform plumbing out of the owner count into the calm handling strip", () => {
    const projection = buildOwnerAttentionProjection(
      [
        item("platform-health", {
          title: "qdrant is offline",
          riskClass: "high-risk",
          triage: {
            timeToAct: "none",
            residueReason: "no-self-heal",
            blastRadius: "qdrant",
            decideEffort: "review",
            irreversible: false,
          },
          deepLink: "/ops/health",
        }),
      ],
      { nowMs: NOW, fallbackLevel: "quiet" },
    );
    const html = renderToStaticMarkup(
      <OperatorCockpitView projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("Nothing needs you right now.");
    expect(html).toContain("Your digital team is handling</span> 1 item");
    expect(html).toContain("no action needed");
    expect(html).not.toContain("qdrant is offline");
  });

  it("shows weekly batching without inflating today's count", () => {
    const projection = buildOwnerAttentionProjection(
      [item("research-proposal", { riskClass: "read" })],
      { nowMs: NOW, fallbackLevel: "balanced" },
    );
    const html = renderToStaticMarkup(
      <OperatorCockpitView projection={projection} failedSources={[]} />,
    );

    expect(html).toContain("Nothing needs you right now.");
    expect(html).toContain("1 item saved for Friday review");
  });
});
