// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortalContextOverlayDrawer } from "./PortalContextOverlayDrawer";
import type { PortalContextEnvelope } from "@/lib/portal-context";

afterEach(() => cleanup());

describe("PortalContextOverlayDrawer", () => {
  it("renders four accessible tabs and moves focus with arrow keys", () => {
    render(<PortalContextOverlayDrawer envelope={makeEnvelope()} open={true} onClose={vi.fn()} />);

    const contextTab = screen.getByRole("tab", { name: "Context" });
    const workTab = screen.getByRole("tab", { name: "Work" });
    const hiveTab = screen.getByRole("tab", { name: "Hive" });
    const evidenceTab = screen.getByRole("tab", { name: "Evidence" });

    expect(contextTab.getAttribute("aria-selected")).toBe("true");
    expect(workTab.getAttribute("aria-selected")).toBe("false");
    expect(hiveTab.getAttribute("aria-selected")).toBe("false");
    expect(evidenceTab.getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(contextTab, { key: "ArrowRight" });

    expect(workTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("WC-123")).toBeTruthy();
  });

  it("renders empty hive and evidence states without hardcoded colors", () => {
    const envelope = makeEnvelope({ coworkers: [], evidence: [] });
    render(<PortalContextOverlayDrawer envelope={envelope} open={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Hive" }));
    expect(screen.getByText("No recommended coworkers")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByText("No evidence recorded")).toBeTruthy();

    const html = renderToStaticMarkup(
      <PortalContextOverlayDrawer envelope={envelope} open={true} onClose={() => {}} />,
    );
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).toContain("border-[var(--dpf-border)]");
    expect(html).not.toMatch(/text-gray|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});

function makeEnvelope(overrides: Partial<PortalContextEnvelope> = {}): PortalContextEnvelope {
  const envelope: PortalContextEnvelope = {
    envelopeId: "env-1",
    resolvedAt: "2026-05-17T18:23:30.000Z",
    route: {
      pathname: "/build",
      routeContext: "/build",
      domain: "Build Studio",
      sensitivity: "internal",
      docsPath: null,
    },
    organization: {
      organizationId: "ORG-1",
      name: "Digital Product Factory",
      archetypeId: "software-platform-operator",
    },
    user: {
      userId: "user-1",
      principalId: "principal-1",
      platformRole: "HR-000",
    },
    anchors: [],
    work: {
      backlogItem: {
        backlogItemId: "BI-123",
        title: "Portal context overlay",
        status: "in-progress",
        epicId: "EP-CAPSULE",
        href: "/ops/backlog/BI-123",
      },
      epic: {
        epicId: "EP-CAPSULE",
        title: "Work Capsule",
        status: "in-progress",
        href: "/ops/epics/EP-CAPSULE",
      },
      capsule: {
        capsuleId: "WC-123",
        title: "Portal context capsule",
        status: "claimed",
        executorKind: "codex",
        leaseExpiresAt: null,
        isLeaseExpired: false,
        isStale: false,
        scopeClaims: ["apps/web/components/portal-context"],
        branchName: "feat/portal-context",
        href: "/build/work/WC-123",
      },
      featureBuild: {
        buildId: "FB-123",
        title: "Portal context build",
        phase: "implement",
        status: "active",
        evidenceComplete: false,
        href: "/build?buildId=FB-123",
      },
      taskRun: null,
      agentThread: null,
      branch: {
        branchName: "feat/portal-context",
        worktreePath: "D:/DPF/.worktrees/portal-context-overlay-hive-mind",
        commitSha: null,
      },
    },
    evidence: [
      {
        kind: "build_evidence",
        source: "build_evidence",
        recordId: "FB-123:evidence",
        label: "Build evidence present",
        recordedAt: "2026-05-17T18:20:00.000Z",
        isGap: false,
      },
    ],
    authority: {
      canActOnCapsule: true,
      canActOnBuild: true,
      canReviewPromotion: true,
      grantedToolKeys: ["work-capsule"],
      proposalModeActive: false,
    },
    coworkers: [
      {
        agentId: "agent-reviewer",
        label: "Delivery reviewer",
        role: "reviewer",
        reason: "Evidence is incomplete before promotion.",
        activation: "required-before-promotion",
        requiredGrantKeys: ["work-capsule"],
        taskType: "verification",
      },
    ],
    attention: [],
    promptDigest: "Route: /build\nBuild: FB-123",
  };

  return {
    ...envelope,
    ...overrides,
    work: {
      ...envelope.work,
      ...(overrides.work ?? {}),
    },
  };
}
