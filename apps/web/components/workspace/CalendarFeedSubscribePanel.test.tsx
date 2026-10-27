import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/calendar-feed", () => ({
  getCalendarFeedStatus: vi.fn().mockResolvedValue({ ok: true, data: { active: false, issuedAt: null } }),
  rotateCalendarFeed: vi.fn(),
  revokeCalendarFeed: vi.fn(),
}));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: vi.fn() }));

import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { CalendarFeedSubscribePanel } from "./CalendarFeedSubscribePanel";

describe("CalendarFeedSubscribePanel (BI-051A74CE)", () => {
  it("offers a private link and never renders a user-id URL", () => {
    const html = renderToStaticMarkup(
      <MessagesProvider locale="en-US" messages={{ shell: namespaceMessages("en-US", "shell") }}>
        <CalendarFeedSubscribePanel />
      </MessagesProvider>,
    );
    expect(html).toContain("Subscribe from another calendar app");
    expect(html).toContain("Create link");
    expect(html).toContain("Older links that used your account id no longer work");
    expect(html).not.toContain("/api/calendar/feed/");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
