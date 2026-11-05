import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MissedWindowNotice, describeMissedWindowReason } from "./MissedWindowNotice";

// BI-EF1AC111 (AC-3): a window that passed without a check says why, in plain
// words, and nothing is shown once a check has run.
describe("MissedWindowNotice", () => {
  it("explains a maintenance window that passed without an upgrade check", () => {
    const html = renderToStaticMarkup(
      <MissedWindowNotice
        missedWindow={{ reason: "cooldown: 2026-11-05T01:00:00.000Z", at: "2026-11-04T23:00:00.000Z" }}
      />,
    );
    expect(html).toContain('data-missed-window="cooldown"');
    expect(html).toContain("passed without an");
    expect(html).toContain("a recent upgrade attempt was still in its wait period");
  });

  it("renders nothing when no window was missed", () => {
    expect(renderToStaticMarkup(<MissedWindowNotice missedWindow={null} />)).toBe("");
  });

  it("shows an unknown reason as recorded", () => {
    expect(describeMissedWindowReason("something-new: x")).toBe("the scheduler declined (something-new: x)");
  });
});
