import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { MissedWindowNotice, type MissedWindow } from "./MissedWindowNotice";

// BI-EF1AC111 (AC-3): a window that passed without a check says why, in plain
// words, and nothing is shown once a check has run.
function render(missedWindow: MissedWindow | null) {
  return renderToStaticMarkup(
    <MessagesProvider locale="en-US" messages={{ upgrade: namespaceMessages("en-US", "upgrade") }}>
      <MissedWindowNotice missedWindow={missedWindow} />
    </MessagesProvider>,
  );
}

describe("MissedWindowNotice", () => {
  it("explains a maintenance window that passed without an upgrade check", () => {
    const html = render({ reason: "cooldown: 2026-11-05T01:00:00.000Z", at: "2026-11-04T23:00:00.000Z" });
    expect(html).toContain('data-missed-window="cooldown"');
    expect(html).toContain("No upgrade check ran in the maintenance window");
    expect(html).toContain("A recent upgrade attempt was still in its wait period.");
  });

  it("renders nothing when no window was missed", () => {
    expect(render(null)).toBe("");
  });

  it("shows an unknown reason as recorded", () => {
    expect(render({ reason: "something-new: x", at: "2026-11-04T23:00:00.000Z" }))
      .toContain("The scheduler declined: something-new: x");
  });
});
