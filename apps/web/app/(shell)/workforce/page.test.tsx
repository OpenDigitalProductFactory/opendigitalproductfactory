import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/coworker-record/roster", () => ({
  loadRoster: vi.fn(async () => ({ rows: [{ agentId: "AGT-1" }], facets: {} })),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { platformRole: "owner", isSuperuser: true } })),
}));
vi.mock("@/lib/permissions", () => ({ getGrantedCapabilities: vi.fn(() => ["registry_read"]) }));
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
});
