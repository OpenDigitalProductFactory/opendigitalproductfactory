// BI-8D152751: the Grok credentials client acts as AGT-EXT-GROK.
import { describe, expect, it, vi } from "vitest";

import { GROK_AGENT_ID, bindGrokClientAgent, grokAgentRecordId } from "./grok-agent-binding";

describe("grokAgentRecordId", () => {
  it("asks only for an active, unarchived AGT-EXT-GROK that may write workrooms", async () => {
    const findFirst = vi.fn(async () => ({ id: "agent-grok" }));
    const id = await grokAgentRecordId({ agent: { findFirst }, oAuthClient: {} } as never);
    expect(id).toBe("agent-grok");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: GROK_AGENT_ID, status: "active", archived: false, toolGrants: { some: { grantKey: "work_room_write" } } },
    }));
  });

  it("is null when no eligible agent exists", async () => {
    const db = { agent: { findFirst: vi.fn(async () => null) }, oAuthClient: {} } as never;
    expect(await grokAgentRecordId(db)).toBeNull();
  });
});

describe("bindGrokClientAgent", () => {
  it("binds only a client that has no agent yet", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    await bindGrokClientAgent({ agent: {}, oAuthClient: { updateMany } } as never, "dpfoc_x", "agent-grok");
    expect(updateMany).toHaveBeenCalledWith({ where: { oAuthClientId: "dpfoc_x", agentId: null }, data: { agentId: "agent-grok" } });
  });
});
