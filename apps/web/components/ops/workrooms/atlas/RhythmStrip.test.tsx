import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { classifyStandingRhythm } from "@/lib/work-management/standing-run-history";
import type { StandingRhythmRow } from "@/lib/work-management/standing-run-history.server";
import { RhythmStrip } from "./RhythmStrip";

const now = new Date("2026-11-10T15:00:00.000Z");
const LOCALE = "en-US";
const render = (rows: StandingRhythmRow[]) => renderToStaticMarkup(
  <MessagesProvider locale="en-US" messages={{ workrooms: namespaceMessages("en-US", "workrooms") }}>
    <RhythmStrip rows={rows} locale={LOCALE} />
  </MessagesProvider>,
);

const stuck: StandingRhythmRow = {
  capsuleId: "WC-STUCK", title: "Payables",
  rhythm: classifyStandingRhythm({ rows: [], currentRunKey: "payables-watch@1.1.0:2026-10-07", now }),
};
const mixed: StandingRhythmRow = {
  capsuleId: "WC-MIXED", title: "Issue triage",
  rhythm: classifyStandingRhythm({
    rows: [
      { runKey: "issue-triage-watch@1.0.0:2026-11-08", action: "stop", reason: "success", recordedAt: "2026-11-08T09:00:00Z" },
      { runKey: "issue-triage-watch@1.0.0:2026-11-09", action: "stop", reason: "success", recordedAt: "2026-11-10T02:00:00Z" },
    ],
    currentRunKey: "issue-triage-watch@1.0.0:2026-11-09", now,
  }),
};

describe("RhythmStrip", () => {
  it("draws 14 named marks per standing room, oldest first", () => {
    const html = render([mixed]);
    expect(html.match(/data-rhythm-state=/g)?.length).toBe(14 + 6); // 14 days plus the six-entry legend
    expect(html).toContain("Last 14 days for Issue triage");
    expect(html).toContain("Nov 8: Finished on time");
    expect(html).toContain("Nov 9: Finished late");
  });

  it("tells missed from late without colour: missed carries a cross, late does not", () => {
    const html = render([mixed]);
    const late = /data-rhythm-state="late"[^>]*>([^<]*)</.exec(html)?.[1];
    const missed = /data-rhythm-state="missed"[^>]*>([^<]*)</.exec(html)?.[1];
    expect(late).toBe("");
    expect(missed).toBe("×");
  });

  it("says how long a stuck room has been running instead of a count", () => {
    const html = render([stuck]);
    expect(html).toContain("Running since Oct 7");
    expect(html).toContain("Nov 10: Running now");
  });

  it("links each room to its detail page, and draws no band when there are none", () => {
    expect(render([mixed])).toContain("/workspace/cases/");
    expect(render([])).toBe("");
  });

  it("keeps the explanation and legend behind a disclosure, so arrival shows only the rooms", () => {
    const html = render([mixed]);
    const disclosure = html.indexOf("<details");
    expect(html).toContain("Day-to-day operations");
    expect(html).toContain("What the marks mean");
    expect(disclosure).toBeGreaterThan(-1);
    expect(html.indexOf("Each standing room runs once a day")).toBeGreaterThan(disclosure);
  });
});
