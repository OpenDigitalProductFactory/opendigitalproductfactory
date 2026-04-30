import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentIdentityPanel } from "./AgentIdentityPanel";

describe("AgentIdentityPanel", () => {
  it("renders AIDoc projection details, portable authorization classes, and fingerprint coverage", () => {
    const html = renderToStaticMarkup(
      <AgentIdentityPanel
        agents={[
          {
            id: "1",
            agentId: "build-specialist",
            name: "Build Specialist",
            status: "active",
            lifecycleStage: "production",
            humanSupervisorId: "HR-300",
            linkedPrincipalId: "PRN-000002",
            gaid: "gaid:priv:dpf.internal:build-specialist",
            aidoc: null,
            validationState: "validated",
            authorizationClasses: ["observe", "execute"],
            operatingProfileFingerprint: "abc123def456",
            toolSurfaceCount: 4,
            promptClassRefCount: 2,
            memoryFactCurrentCount: 2,
            memoryFactPendingRevalidationCount: 1,
            memoryFactLegacyCount: 1,
          },
        ]}
        summary={{
          totalAgents: 1,
          linkedAgents: 1,
          projectedAgents: 1,
          unlinkedAgents: 0,
          validatedAgents: 1,
          pendingRevalidationAgents: 0,
          staleAgents: 0,
          portableAuthorizationClassCount: 2,
        }}
      />,
    );

    expect(html).toContain("Agent Identity");
    expect(html).toContain("Projected AIDocs");
    expect(html).toContain("Portable authorization classes");
    expect(html).toContain("build-specialist");
    expect(html).toContain("gaid:priv:dpf.internal:build-specialist");
    expect(html).toContain("abc123def456");
    expect(html).toContain("observe");
    expect(html).toContain("execute");
    expect(html).toContain("Memory freshness");
    expect(html).toContain("2 current");
    expect(html).toContain("1 pending");
  });
});
