import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortalContextStrip } from "./PortalContextStrip";
import type { PortalContextEnvelope } from "@/lib/portal-context";

describe("PortalContextStrip", () => {
  it("renders route-only Build Studio context with no_active_build signal and theme tokens", () => {
    const html = renderToStaticMarkup(<PortalContextStrip envelope={makeEnvelope()} />);

    expect(html).toContain("Portal context");
    expect(html).toContain("Build Studio");
    expect(html).toContain("No active build");
    expect(html).toContain("Select build");
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).toContain("border-[var(--dpf-border)]");
    expect(html).not.toMatch(/text-gray|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});

function makeEnvelope(): PortalContextEnvelope {
  return {
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
    attention: [
      {
        kind: "no_active_build",
        severity: "info",
        message: "No Build Studio work object is anchored in the URL.",
        actionLabel: "Select build",
        actionHref: "/build",
      },
    ],
    promptDigest: "Route: /build\nAttention: no_active_build(info)",
  };
}
