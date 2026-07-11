import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatorCockpitView } from "./OperatorCockpit";
import { buildOutsideInCockpit } from "@/lib/attention/outside-in";
import type { AttentionItem, AttentionSource } from "@/lib/attention/types";

function item(
  over: Partial<{
    id: string;
    source: AttentionSource;
    title: string;
    blastRadius: string;
  }> = {},
): AttentionItem {
  return {
    id: over.id ?? "i1",
    source: over.source ?? "ai-decision",
    title: over.title ?? "Untitled",
    context: "ctx",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "coverage-gap",
      blastRadius: over.blastRadius,
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: "2026-07-11T00:00:00.000Z",
    actions: [],
    deepLink: "/x",
    audience: { operator: true },
  };
}

const NOW = Date.parse("2026-07-11T12:00:00.000Z");

describe("OperatorCockpitView", () => {
  it("(d, non-empty) shows ONE count and groups outside-in — customer before workforce", () => {
    const cockpit = buildOutsideInCockpit([
      item({ id: "cust", source: "approval-outbound", title: "Approve campaign" }),
      item({ id: "work", source: "ai-decision", title: "Coworker escalation" }),
    ]);
    const html = renderToStaticMarkup(
      <OperatorCockpitView cockpit={cockpit} failedSources={[]} nowMs={NOW} />,
    );

    expect(html).toContain("What needs you now");
    expect(html).toContain(">2<"); // the single count badge
    expect(html).toContain("Products &amp; services sold");
    expect(html).toContain("Workforce");
    // Customer portfolio section renders before workforce (outside-in).
    expect(html.indexOf("Products &amp; services sold")).toBeLessThan(
      html.indexOf("Workforce"),
    );
    // It never claims nothing needs you while showing items (the F2 fix).
    expect(html).not.toContain("Nothing needs you right now.");
  });

  it("(d, empty) with no items, says nothing needs you — never a phantom count", () => {
    const cockpit = buildOutsideInCockpit([]);
    const html = renderToStaticMarkup(
      <OperatorCockpitView cockpit={cockpit} failedSources={[]} nowMs={NOW} />,
    );

    expect(html).toContain("Nothing needs you right now.");
    expect(html).not.toContain("Blocker");
  });

  it("a blocking inner item jumps into the primary queue and is flagged as a blocker", () => {
    const cockpit = buildOutsideInCockpit([
      item({ id: "outage", source: "escalation", title: "Checkout build stalled", blastRadius: "checkout" }),
    ]);
    const html = renderToStaticMarkup(
      <OperatorCockpitView cockpit={cockpit} failedSources={[]} nowMs={NOW} />,
    );

    expect(html).toContain(">1<");
    expect(html).toContain("Blocker");
    expect(html).toContain("Checkout build stalled");
    expect(html).toContain("blocking a customer/business outcome");
  });

  it("demotes inner, non-blocking items out of the primary count into an 'in hand' note", () => {
    const cockpit = buildOutsideInCockpit([
      item({ id: "bill", source: "approval-bill", title: "Approve utility bill" }),
    ]);
    const html = renderToStaticMarkup(
      <OperatorCockpitView cockpit={cockpit} failedSources={[]} nowMs={NOW} />,
    );

    // Nothing is blocking a customer outcome, but there is an inner item in hand.
    expect(html).toContain("Nothing is blocking a customer or business outcome right now.");
    expect(html).toContain("1 inner item");
  });
});
