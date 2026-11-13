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

  it("gives on time, late and missed each its own shape, so none differs by colour alone", () => {
    const html = render([mixed]);
    const mark = (state: string) => new RegExp(`data-rhythm-state="${state}"[^>]*style="([^"]*)"[^>]*>([^<]*)<`).exec(html);
    const [onTime, late, missed] = [mark("on-time"), mark("late"), mark("missed")];
    expect(onTime?.[1]).toContain("background:var(--dpf-success)");
    expect(late?.[1]).toContain("linear-gradient(135deg");
    expect(missed?.[1]).toContain("background:transparent");
    expect(missed?.[2]).toBe("×");
    expect(late?.[2]).toBe("");
  });

  it("keeps the legend's words readable by screen readers and hides only its sample marks", () => {
    const html = render([mixed]);
    const legend = html.slice(html.indexOf("<details"));
    expect(legend).not.toMatch(/<ul aria-hidden/);
    expect(legend).toMatch(/aria-hidden="true" data-rhythm-state="late"/);
    expect(legend).toContain("Finished late");
  });

  it("says how long a stuck room has been running instead of a count", () => {
    const html = render([stuck]);
    expect(html).toContain("Running since Oct 7");
    expect(html).toContain("Nov 10: Running now");
  });

  it("says no runs are recorded yet, not that every day ran, for a room with no recorded run (BI-7DBE16F9)", () => {
    const unrecorded: StandingRhythmRow = {
      capsuleId: "WC-QUIET", title: "Contribution flow",
      rhythm: classifyStandingRhythm({ rows: [], currentRunKey: null, now }),
    };
    const html = render([unrecorded]);
    expect(html).toContain("No runs recorded yet");
    expect(html).not.toContain("Every recorded day ran");
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
