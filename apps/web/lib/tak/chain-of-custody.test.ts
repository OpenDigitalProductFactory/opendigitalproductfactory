import { describe, it, expect } from "vitest";
import {
  assembleToolExecutionCustody,
  isCustodyWellFormed,
  getToolExecutionCustody,
} from "./chain-of-custody";
import type { DelegationLink } from "./delegation-authority";

const link = (over: Partial<DelegationLink>): DelegationLink =>
  ({
    id: "link-0",
    chainId: "chain-1",
    depth: 0,
    fromAgentId: "ops-coordinator",
    toAgentId: "build-specialist",
    skillId: null,
    authorityScope: ["backlog_read"],
    originUserId: "u-human",
    originAuthority: ["backlog_read", "backlog_write"],
    status: "active",
    parentLinkId: null,
    ...over,
  }) as DelegationLink;

const execution = {
  id: "te-1",
  agentId: "build-specialist",
  userId: "u-human",
  delegatingUserId: null as string | null,
  toolName: "query_backlog",
  delegationChainId: null as string | null,
};

describe("assembleToolExecutionCustody", () => {
  it("resolves a human origin for a DIRECT human→coworker call (no chain) — INV-A3", () => {
    const c = assembleToolExecutionCustody({ execution });
    expect(c.human.userId).toBe("u-human");
    expect(c.chain).toEqual([]);
    expect(c.depth).toBe(0);
    expect(c.originUserId).toBeNull();
    expect(c.toolCall.toolName).toBe("query_backlog");
  });

  it("assembles the ordered agent→agent hops for a DELEGATED call", () => {
    const links = [
      link({ id: "l1", depth: 1, fromAgentId: "ops-coordinator", toAgentId: "platform-engineer" }),
      link({ id: "l0", depth: 0, fromAgentId: "u-human", toAgentId: "ops-coordinator" }),
    ];
    const c = assembleToolExecutionCustody({
      execution: { ...execution, delegationChainId: "chain-1" },
      chainLinks: links,
    });
    // sorted origin→executing by depth
    expect(c.chain.map((l) => l.depth)).toEqual([0, 1]);
    expect(c.depth).toBe(1);
    expect(c.originUserId).toBe("u-human");
    expect(c.human.userId).toBe("u-human");
  });
});

describe("isCustodyWellFormed", () => {
  it("accepts a direct call with a human", () => {
    expect(isCustodyWellFormed(assembleToolExecutionCustody({ execution }))).toBe(true);
  });

  it("accepts a chain whose origin human matches the execution human", () => {
    const c = assembleToolExecutionCustody({
      execution: { ...execution, delegationChainId: "chain-1" },
      chainLinks: [link({ originUserId: "u-human" })],
    });
    expect(isCustodyWellFormed(c)).toBe(true);
  });

  it("rejects a chain whose origin human does NOT match (custody break)", () => {
    const c = assembleToolExecutionCustody({
      execution: { ...execution, delegationChainId: "chain-1" },
      chainLinks: [link({ originUserId: "u-someone-else" })],
    });
    expect(isCustodyWellFormed(c)).toBe(false);
  });

  it("rejects an execution with no human", () => {
    const c = assembleToolExecutionCustody({ execution: { ...execution, userId: "" } });
    expect(isCustodyWellFormed(c)).toBe(false);
  });
});

describe("getToolExecutionCustody (injected deps)", () => {
  it("returns null when the execution row is missing", async () => {
    const c = await getToolExecutionCustody("nope", {
      findExecution: async () => null,
      getChainOfCustody: async () => [],
    });
    expect(c).toBeNull();
  });

  it("fetches the chain only when delegationChainId is set", async () => {
    let chainCalls = 0;
    const direct = await getToolExecutionCustody("te-1", {
      findExecution: async () => ({ ...execution }),
      getChainOfCustody: async () => {
        chainCalls++;
        return [];
      },
    });
    expect(direct?.human.userId).toBe("u-human");
    expect(chainCalls).toBe(0); // no chain fetch for a direct call

    const delegated = await getToolExecutionCustody("te-1", {
      findExecution: async () => ({ ...execution, delegationChainId: "chain-1" }),
      getChainOfCustody: async () => {
        chainCalls++;
        return [link({ originUserId: "u-human" })];
      },
    });
    expect(delegated?.originUserId).toBe("u-human");
    expect(chainCalls).toBe(1);
  });
});
