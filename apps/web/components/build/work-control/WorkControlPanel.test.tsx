import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkControlPanel } from "./WorkControlPanel";
import type { PortalContextEnvelope } from "@/lib/portal-context";
import type { DeliveryTaskHubPage } from "@/lib/work-capsules/delivery-task-hub-store";

const emptyDeliveryHub: DeliveryTaskHubPage = {
  rows: [],
  nextCursor: null,
  observedAt: "2026-09-04T12:00:00.000Z",
};

describe("WorkControlPanel", () => {
  it("renders active capsule rows", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        deliveryHub={{ ...emptyDeliveryHub, rows: [{
          capsuleId: "WC-1",
          title: "Adopt work",
          objective: "Deliver the governed outcome",
          group: "working",
          status: "working",
          statusIntent: "info",
          ownerLabel: "codex-desktop",
          stageLabel: "Working",
          source: "external-adoption",
          backlogItemId: "BI-1",
          branch: "feat/adopt",
          taskRunId: null,
          observedAt: "2026-09-04T12:00:00.000Z",
          freshness: "fresh",
          freshnessReason: null,
          latestTransition: { id: "a1", kind: "status-changed", summary: "Implementation started", recordedAt: "2026-09-04T12:00:00.000Z" },
          progress: null,
          nextAction: null,
          verifiedResult: null,
          inspectHref: "/build/work/WC-1",
          resumeHref: null,
          pullRequestHref: null,
          primaryAction: { label: "Inspect", href: "/build/work/WC-1" },
          secondaryActions: [{ label: "Handoff", href: "/build/work/WC-1#handoff" }],
          asyncOperation: { coreHandleAvailable: false },
        }] }}
        adoptable={[]}
        livenessSummary={{ scanned: 2, live: 1, history: 1, reapable: 1, byLiveness: { live: 1, "lease-expired": 1 }, heavyLane: { executing: 0, nextReady: 0, dormant: 0 }, progressSlo: { oldestWaitMs: null, maxNoTransitionMs: null } }}
        createAction={vi.fn()}
      />,
    );

    expect(html).toContain("Development Workrooms");
    expect(html).toContain("Delivery task hub");
    expect(html).toContain("Adopt work");
    expect(html).toContain("Implementation started");
    expect(html).toContain("feat/adopt");
    expect(html).toContain("Live Workrooms");
    expect(html).toContain("1 inactive");
    expect(html).toContain('href="/ops/workrooms"');
    expect(html).toContain('href="/ea/workrooms"');
  });

  it("renders empty state", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel deliveryHub={emptyDeliveryHub} adoptable={[]} createAction={vi.fn()} canCreateGovernedWork />,
    );

    expect(html).toContain("No delivery Workrooms in this 30-day window");
    expect(html).toContain("Plan governed work");
  });

  it("shows the governed-work create form to manage_backlog holders", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel deliveryHub={emptyDeliveryHub} adoptable={[]} createAction={vi.fn()} canCreateGovernedWork />,
    );

    // Door 2's create form is present, and the "reserved role" fallback is not.
    expect(html).toContain("Plan governed work");
    expect(html).not.toContain("reserved for the manage-backlog role");
  });

  it("hides the create door and explains the alternative when manage_backlog is absent", () => {
    // BI-E167A8A6: default (no capability) hides door 2's create form so a
    // non-technical operator is not offered a second intake they cannot use.
    const html = renderToStaticMarkup(
      <WorkControlPanel deliveryHub={emptyDeliveryHub} adoptable={[]} createAction={vi.fn()} />,
    );

    // No governed-work form heading/button ("Plan governed work"). The intro's
    // "Planning governed work" prose does not contain that exact substring.
    expect(html).not.toContain("Plan governed work");
    expect(html).toContain("reserved for the manage-backlog role");
    expect(html).toContain('href="/build"');
  });

  it("states the relationship to the plain-English Start a new outcome door", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel deliveryHub={emptyDeliveryHub} adoptable={[]} createAction={vi.fn()} canCreateGovernedWork />,
    );

    expect(html).toContain("Start a new outcome");
    expect(html).toContain('href="/build"');
  });

  it("renders the portal context strip when a server envelope is provided", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        deliveryHub={emptyDeliveryHub}
        adoptable={[]}
        createAction={vi.fn()}
        portalContext={makePortalContextEnvelope()}
      />,
    );

    expect(html).toContain("Portal context");
    // BI-AC156613: on /build/work nothing is anchored, so the strip shows a
    // selection null-state ("No build selected"), never a false activity claim
    // that would clash with the "Active workrooms: N" card on the same page.
    expect(html).toContain("No build selected");
    expect(html).not.toContain("No active build");
  });

  it("renders adoptable worktree rows surfaced by the scanner", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        deliveryHub={emptyDeliveryHub}
        adoptable={[{
          path: "D:/DPF-orphan",
          branch: "fix/orphan",
          modifiedCount: 3,
          untrackedCount: 1,
        }]}
        createAction={vi.fn()}
      />,
    );

    expect(html).toContain("D:/DPF-orphan");
    expect(html).toContain("fix/orphan");
    expect(html).toContain("4");
  });
});

function makePortalContextEnvelope(): PortalContextEnvelope {
  return {
    envelopeId: "env-1",
    resolvedAt: "2026-05-17T18:23:30.000Z",
    route: { pathname: "/build/work", routeContext: "/build", domain: "Build Studio", sensitivity: "internal", docsPath: null },
    organization: { organizationId: "ORG-1", name: "Digital Product Factory", archetypeId: "software-platform-operator" },
    user: { userId: "user-1", principalId: "principal-1", platformRole: "HR-000" },
    anchors: [],
    work: {
      backlogItem: null,
      epic: null,
      capsule: null,
      featureBuild: null,
      taskRun: null,
      agentThread: null,
      branch: null,
    },
    evidence: [],
    authority: {
      canActOnCapsule: true,
      canActOnBuild: true,
      canReviewPromotion: true,
      grantedToolKeys: [],
      proposalModeActive: false,
    },
    coworkers: [],
    attention: [{ kind: "no_active_build", severity: "info", message: "No active build", actionLabel: "Select build", actionHref: "/build" }],
    capability: null,
    promptDigest: "Route: /build",
  };
}
