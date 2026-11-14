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

const completedDays = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(now.getTime() - (13 - index) * 86_400_000).toISOString().slice(0, 10);
  return { runKey: `fixture-watch@1.0.0:${date}`, action: "stop", reason: "success", recordedAt: `${date}T09:00:00Z` };
});
function rowSummary(rhythm: StandingRhythmRow["rhythm"]) {
  const html = render([{ capsuleId: "WC-LABELLED-FIXTURE", title: "Labelled routine", rhythm }]);
  // Read the summary beside the daily marks, not matching words in the legend.
  const match = /<\/ol><span\b[^>]*>([^<]*)<\/span>/.exec(html);
  expect(match).not.toBeNull();
  return { text: match![1], html };
}
const history = (rows = completedDays) => classifyStandingRhythm({ rows, currentRunKey: null, now });

describe("RhythmStrip", () => {
  it("labels all-unknown history without claiming recorded days ran", () => {
    const result = rowSummary(history([]));
    expect(result.text).toBe("No record yet");
    expect(result.html.match(/data-rhythm-state="no-record"/g)).toHaveLength(15);
  });

  it("distinguishes mixed unknown and completed days from a complete history", () => {
    expect(rowSummary(history(completedDays.slice(-1))).text).toBe("Some days unrecorded");
  });

  it("does not claim completion while today's daily run is still due", () => {
    expect(rowSummary(history(completedDays.slice(0, -1))).text).toBe("Not started today");
  });

  it("retains the positive summary for a fully recorded completed window", () => {
    expect(rowSummary(history()).text).toBe("Every recorded day ran");
  });

  it("retains completed late marks without claiming that every run was on time", () => {
    const rows = completedDays.map((row, index) => index === 4
      ? { ...row, recordedAt: new Date(Date.parse(row.recordedAt) + 86_400_000).toISOString() } : row);
    const result = rowSummary(history(rows));
    expect(result.text).toBe("Every recorded day ran");
    expect(result.html.match(/data-rhythm-state="late"/g)).toHaveLength(2);
  });

  it("keeps genuine missed-day warnings ahead of incomplete history", () => {
    expect(rowSummary(history(completedDays.slice(0, 1))).text).toBe("12 days did not run");
  });

  it("cannot turn unknown marks into completion from inconsistent aggregate counts", () => {
    expect(rowSummary({ ...history([]), counts: { "on-time": 14, late: 0, missed: 0 } }).text).toBe("No record yet");
  });

  it("does not infer a completed period from an empty slot window", () => {
    expect(rowSummary({ ...history([]), slots: [] }).text).toBe("No record yet");
  });

  it("preserves a recorded running mark when its start date is unavailable", () => {
    const rhythm = classifyStandingRhythm({ rows: [], currentRunKey: "fixture-watch@1.0.0:2026-11-10", now });
    expect(rowSummary({ ...rhythm, runningSince: null }).text).toBe("Running now");
  });

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
