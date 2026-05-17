import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkControlPanel } from "./WorkControlPanel";
import type { PortalContextEnvelope } from "@/lib/portal-context";

describe("WorkControlPanel", () => {
  it("renders active capsule rows", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        capsules={[{
          capsuleId: "WC-1",
          title: "Adopt work",
          status: "working",
          source: "external-adoption",
          executorKind: "codex-desktop",
          branch: "feat/adopt",
          worktreePath: "D:/DPF-adopt",
          pullRequestUrl: null,
          health: "ok",
          updatedAt: "2026-05-14T00:00:00.000Z",
        }]}
        adoptable={[]}
        createAction={vi.fn()}
      />,
    );

    expect(html).toContain("Work Control");
    expect(html).toContain("Adopt work");
    expect(html).toContain("feat/adopt");
  });

  it("renders empty state", () => {
    const html = renderToStaticMarkup(<WorkControlPanel capsules={[]} adoptable={[]} createAction={vi.fn()} />);

    expect(html).toContain("No active capsules yet.");
    expect(html).toContain("Plan governed work");
  });

  it("renders the portal context strip when a server envelope is provided", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        capsules={[]}
        adoptable={[]}
        createAction={vi.fn()}
        portalContext={makePortalContextEnvelope()}
      />,
    );

    expect(html).toContain("Portal context");
    expect(html).toContain("No active build");
  });

  it("renders adoptable worktree rows surfaced by the scanner", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        capsules={[]}
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
    promptDigest: "Route: /build",
  };
}
