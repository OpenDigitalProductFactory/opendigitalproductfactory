import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AttributedFeed,
  CapacityChips,
  NeedsYouQuests,
  PresenceRow,
  ResourceUnitGrid,
  TwinQueue,
  UtilityBand,
  WorkItem,
  type CapacityChipData,
} from "./index";

// The kit's pure primitives must render to static markup (server-usable) and
// surface their data. The one client primitive (CogBanner) owns interaction and
// is exercised via the showcase, not here.

describe("twin grammar kit — pure primitives render statically", () => {
  it("capacity chips show value / max and a live counter", () => {
    const chips: CapacityChipData[] = [
      { key: "t", label: "Tables", value: 6, max: 8, intent: "info", live: true },
    ];
    const html = renderToStaticMarkup(<CapacityChips chips={chips} />);
    expect(html).toContain("Tables");
    expect(html).toContain("6");
    expect(html).toContain("8");
    // live dot uses the motion-safe class (reduced-motion respected)
    expect(html).toContain("motion-safe:animate-pulse");
  });

  it("resource unit grid renders state and owner", () => {
    const html = renderToStaticMarkup(
      <ResourceUnitGrid
        units={[
          { key: "t9", label: "Table 9", state: "Seated", intent: "success", owner: { name: "Ana", kind: "human" } },
        ]}
      />,
    );
    expect(html).toContain("Table 9");
    expect(html).toContain("Seated");
    expect(html).toContain("Ana");
  });

  it("work item renders the blocked-on-external state distinctly", () => {
    const html = renderToStaticMarkup(
      <WorkItem label="Table 7 · wine" blockedOnExternal blockedLabel="Blocked · cellar restock" />,
    );
    expect(html).toContain("Blocked · cellar restock");
    expect(html).toContain('data-blocked="true"');
  });

  it("queue numbers items and shows the cog suggestion inline", () => {
    const html = renderToStaticMarkup(
      <TwinQueue
        label="Waitlist"
        items={[{ key: "w1", label: "Nguyen party", suggestion: "Seat at Table 12" }]}
      />,
    );
    expect(html).toContain("Waitlist");
    expect(html).toContain("Nguyen party");
    expect(html).toContain("Seat at Table 12");
  });

  it("empty queue states the good news", () => {
    const html = renderToStaticMarkup(<TwinQueue label="Dispatch" items={[]} />);
    expect(html).toContain("Queue clear");
  });

  it("presence and feed attribute humans and AI on one plane", () => {
    const presence = renderToStaticMarkup(
      <PresenceRow
        members={[
          { name: "You", kind: "human", focus: "expediting" },
          { name: "AI host", kind: "ai", focus: "waitlist" },
        ]}
      />,
    );
    expect(presence).toContain("You");
    expect(presence).toContain("AI host");
    expect(presence).toContain("expediting");

    const feed = renderToStaticMarkup(
      <AttributedFeed
        events={[
          { key: "f1", actor: { name: "AI host", kind: "ai" }, action: "proposed seating for", target: "Nguyen party", at: "now" },
        ]}
      />,
    );
    expect(feed).toContain("AI host");
    expect(feed).toContain("proposed seating for");
    expect(feed).toContain("Nguyen party");
  });

  it("utility band renders the identical support meters", () => {
    const html = renderToStaticMarkup(
      <UtilityBand
        meters={[
          { key: "bills", label: "Bills due", value: "2", intent: "warning" },
          { key: "tax", label: "VAT return", value: "12 days", intent: "info" },
        ]}
      />,
    );
    expect(html).toContain("Bills due");
    expect(html).toContain("VAT return");
  });

  it("needs-you quests render or state the calm-state fallback", () => {
    const withQuests = renderToStaticMarkup(
      <NeedsYouQuests quests={[{ key: "q1", title: "6-top blocked", intent: "danger", cta: "Seat" }]} />,
    );
    expect(withQuests).toContain("6-top blocked");
    expect(withQuests).toContain("Seat");

    const empty = renderToStaticMarkup(<NeedsYouQuests quests={[]} />);
    expect(empty).toContain("Nothing needs you right now");
  });
});
