import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/coworker-record/roster", () => ({
  loadRoster: vi.fn(async () => ({ rows: [{ agentId: "AGT-1" }], facets: {} })),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { platformRole: "owner", isSuperuser: true } })),
}));
vi.mock("@/lib/permissions", () => ({ getGrantedCapabilities: vi.fn(() => ["registry_read"]) }));
vi.mock("@/lib/platform-runtime/workforce-activity", () => ({
  loadWorkforceActivity: vi.fn(async () => ({
    capturedAt: "2026-11-10T12:00:00.000Z",
    working: [], quiet: [], workrooms: [], platformWork: [],
    pulse: { workingCount: 0, totalCount: 0, actionsToday: 0, tokensToday: 0, costToday: 0, tokensRoster: 0, costRoster: 0, tokensWorkroom: 0, costWorkroom: 0, tokensUnattributed: 0, costUnattributed: 0, platformWorkCount: 0, quietOverThresholdCount: 0, coworkersWithoutOwnerCount: 0, doneWeekCount: 0, breakFixDoneWeekCount: 0, breakFixShareWeek: 0 },
  })),
}));
vi.mock("@/components/platform/WorkforceNowShell", () => ({
  WorkforceNowShell: () => <div data-workforce-activity />,
}));
vi.mock("@/components/platform/coworker-record/RosterView", () => ({
  RosterView: ({
    initialQuery,
    presentation,
  }: {
    initialQuery: string;
    presentation: string;
  }) => (
    <div
      data-roster
      data-query={initialQuery}
      data-presentation={presentation}
    />
  ),
}));
vi.mock("@/components/owner-first/OwnerFirstDisclosure", () => ({
  OwnerFirstDisclosure: ({ children }: { children: React.ReactNode }) => <details>{children}</details>,
}));

import WorkforceDirectoryPage from "./page";

describe("WorkforceDirectoryPage", () => {
  it("renders the coworker roster directly on arrival", async () => {
    const html = renderToStaticMarkup(
      await WorkforceDirectoryPage({ searchParams: Promise.resolve({ q: "review" }) }),
    );

    expect(html).toContain("data-roster");
    expect(html).toContain('data-query="q=review"');
    expect(html).toContain('data-presentation="directory"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Browse the list");
  });

  it("renders retained coworker and Workroom activity from the same canonical home", async () => {
    const html = renderToStaticMarkup(
      await WorkforceDirectoryPage({ searchParams: Promise.resolve({ view: "activity" }) }),
    );

    expect(html).toContain("data-workforce-activity");
    expect(html).not.toContain("data-roster");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Workrooms");
    expect(html).toContain("Operations Map");
  });
});
