import { describe, expect, it } from "vitest";

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
