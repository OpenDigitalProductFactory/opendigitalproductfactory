import { describe, expect, it } from "vitest";

import { authorizeWorkroomAccess } from "./room-participation";
import { authorizeAgentRoomAccess, grantsRequested } from "./room-agent-access";

const BASE = {
  agentPrincipalRef: "PRN-agent-1",
  agentSensitivityClearance: ["public", "internal"],
  sensitivityCeiling: "internal",
};

describe("authorizeAgentRoomAccess", () => {
  it("denies an agent not in any ref set", () => {
    const d = authorizeAgentRoomAccess({
      ...BASE,
      requested: "action",
      admittedPrincipalRefs: ["PRN-other"],
      actionPrincipalRefs: ["PRN-other"],
    });
    expect(d.level).toBe("none");
    expect(d.reason).toBe("not-admitted");
  });

  it("grants action to an agent in the action set (e.g. a capsule holder / assigned agent)", () => {
    const d = authorizeAgentRoomAccess({
      ...BASE,
      requested: "action",
      admittedPrincipalRefs: ["PRN-agent-1"],
      actionPrincipalRefs: ["PRN-agent-1"],
    });
    expect(d.level).toBe("action");
    expect(grantsRequested(d, "action")).toBe(true);
  });

  it("grants content to an admitted-but-not-action agent, but denies action", () => {
    const admittedOnly = {
      ...BASE,
      admittedPrincipalRefs: ["PRN-agent-1"],
      actionPrincipalRefs: [] as string[],
    };
    expect(authorizeAgentRoomAccess({ ...admittedOnly, requested: "content" }).level).toBe("content");
    expect(authorizeAgentRoomAccess({ ...admittedOnly, requested: "action" }).level).toBe("none");
  });

  it("caps an admitted agent to discover when clearance is below the room ceiling", () => {
    const d = authorizeAgentRoomAccess({
      ...BASE,
      agentSensitivityClearance: ["public"],
      sensitivityCeiling: "confidential",
      requested: "content",
      admittedPrincipalRefs: ["PRN-agent-1"],
      actionPrincipalRefs: ["PRN-agent-1"],
    });
    expect(d.level).toBe("discover");
    expect(d.reason).toBe("insufficient-clearance");
  });

  it("keeps a discoverable-only agent at discover, not admitted", () => {
    const d = authorizeAgentRoomAccess({
      ...BASE,
      requested: "content",
      admittedPrincipalRefs: ["PRN-other"],
      actionPrincipalRefs: ["PRN-other"],
      discoverablePrincipalRefs: ["PRN-agent-1"],
    });
    expect(d.level).toBe("discover");
    expect(d.reason).toBe("discover-only");
  });
});

describe("superuser guard (BI-154DAA7E)", () => {
  // The superuser short-circuit in authorizeWorkroomAccess is a HUMAN
  // affordance. An AI principal must never ride it: one flag would void
  // admission AND the sensitivity ceiling at once.
  it("the agent input cannot express superuser at all — the field does not exist", () => {
    // Type-level guarantee, asserted at runtime for the compiled contract:
    // passing isSuperuser must not change the decision for an unadmitted agent.
    const decision = authorizeAgentRoomAccess({
      requested: "action",
      agentPrincipalRef: "agent:AGT-ORCH-000",
      agentSensitivityClearance: ["public", "internal", "confidential", "restricted"],
      admittedPrincipalRefs: [],
      actionPrincipalRefs: [],
      sensitivityCeiling: "public",
      // @ts-expect-error BI-154DAA7E — isSuperuser was removed from the agent path
      isSuperuser: true,
    });
    expect(decision.level).toBe("none");
    expect(decision.reason).toBe("not-admitted");
  });

  it("an under-cleared agent is capped even if a future caller smuggles the flag through the core", () => {
    // Belt and braces: the core decision refuses the short-circuit for
    // principalKind "agent" even with isSuperuser true.
    const decision = authorizeWorkroomAccess({
      requested: "content",
      principalRef: "agent:AGT-ORCH-000",
      assignedPrincipalRefs: ["agent:AGT-ORCH-000"],
      sensitivityCeiling: "restricted",
      sensitivityClearance: ["public", "internal"],
      isSuperuser: true,
      principalKind: "agent",
    });
    expect(decision.level).toBe("discover");
    expect(decision.reason).toBe("insufficient-clearance");
  });

  it("a human superuser is unchanged — the owner affordance survives", () => {
    const decision = authorizeWorkroomAccess({
      requested: "action",
      principalRef: "user:owner",
      assignedPrincipalRefs: [],
      sensitivityCeiling: "restricted",
      sensitivityClearance: [],
      isSuperuser: true,
    });
    expect(decision.level).toBe("action");
    expect(decision.reason).toBe("authorized");
  });
});
