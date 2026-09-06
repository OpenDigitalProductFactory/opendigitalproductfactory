import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCapsuleDetail: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));
vi.mock("@/lib/actions/work-capsules", () => ({
  getCapsuleDetail: mocks.getCapsuleDetail,
}));
vi.mock("@/lib/portal-context", () => ({
  resolvePortalContextEnvelope: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/work-capsules/agent-activity-presenter", () => ({
  presentAgentSession: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/work-capsules/activity-stream", () => ({
  serializeAgentSessionEntry: vi.fn(),
}));
vi.mock("@/lib/work-capsules/launch-presenter", () => ({
  presentLaunchInstructions: vi.fn().mockReturnValue([]),
}));
vi.mock("@/components/portal-context/PortalContextStrip", () => ({
  PortalContextStrip: () => <div data-context-strip="true" />,
}));
vi.mock("@/components/build/AgentSessionFeedLive", () => ({
  AgentSessionFeedLive: () => <div data-activity-feed="true">Canonical Workroom activity</div>,
}));
vi.mock("@/components/build/work-control/WorkCapsuleLaunchPanel", () => ({
  WorkCapsuleLaunchPanel: () => <div data-launch-panel="true" />,
}));

describe("CapsuleDetailPage delivery destinations", () => {
  it("lands review and result links on actionable, labelled content", async () => {
    mocks.getCapsuleDetail.mockResolvedValue({
      capsuleId: "WC-1",
      title: "Ship the task hub",
      headBranch: "feat/task-hub",
      worktreePath: "D:/worktrees/task-hub",
      baseBranch: "main",
      activities: [],
    });
    const { default: CapsuleDetailPage } = await import("./page");

    const html = renderToStaticMarkup(await CapsuleDetailPage({
      params: Promise.resolve({ capsuleId: "WC-1" }),
    }));

    expect(html).toMatch(/<section[^>]*id="review"[^>]*>[\s\S]*Governed review[\s\S]*href="\/workspace\/inbox"[\s\S]*<\/section>/);
    expect(html).toMatch(/<section[^>]*id="result"[^>]*>[\s\S]*Result and evidence[\s\S]*data-activity-feed="true"[\s\S]*<\/section>/);
    expect(html).not.toMatch(/<header[^>]*id="result"/);
  });
});
