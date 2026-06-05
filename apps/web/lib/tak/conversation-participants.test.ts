import { describe, expect, it } from "vitest";
import {
  buildParticipants,
  type AgentIdentity,
  type ParticipantProjectionInput,
} from "./conversation-participants-core";

function identity(agentId: string, label: string, principalId: string | null): AgentIdentity {
  return { agentId, label, principalId };
}

const ROOT = "thread-root";
const CHILD = "thread-child";
const NESTED = "thread-nested";

describe("buildParticipants", () => {
  it("projects a single owner for a 1-1 conversation", () => {
    const input: ParticipantProjectionInput = {
      rootThreadId: ROOT,
      threads: [{ id: ROOT, parentThreadId: null }],
      taskRuns: [],
      actingAgentByThread: { [ROOT]: "AGT-OWNER" },
      identities: { "AGT-OWNER": identity("AGT-OWNER", "Build Specialist", "PR-OWNER") },
      ownerAgentId: "AGT-OWNER",
    };
    const result = buildParticipants(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agentId: "AGT-OWNER",
      role: "owner",
      tier: 1,
      enteredVia: "route",
      principalId: "PR-OWNER",
      principalResolved: true,
      label: "Build Specialist",
    });
  });

  it("projects owner + spawned sub-agent with thread lineage", () => {
    const input: ParticipantProjectionInput = {
      rootThreadId: ROOT,
      threads: [
        { id: ROOT, parentThreadId: null },
        { id: CHILD, parentThreadId: ROOT },
      ],
      taskRuns: [
        {
          threadId: CHILD,
          taskRunId: "task-1",
          status: "working",
          currentAgentId: "AGT-PEER",
          initiatingAgentId: "AGT-OWNER",
          startedAt: new Date("2026-06-04T00:00:00Z"),
        },
      ],
      actingAgentByThread: { [ROOT]: "AGT-OWNER", [CHILD]: "AGT-PEER" },
      identities: {
        "AGT-OWNER": identity("AGT-OWNER", "Build Specialist", "PR-OWNER"),
        "AGT-PEER": identity("AGT-PEER", "Enterprise Architect", "PR-PEER"),
      },
      ownerAgentId: "AGT-OWNER",
    };
    const result = buildParticipants(input);
    expect(result).toHaveLength(2);
    // owner is sorted first
    expect(result[0].role).toBe("owner");
    const sub = result.find((p) => p.role === "sub-agent")!;
    expect(sub).toMatchObject({
      agentId: "AGT-PEER",
      tier: 2,
      enteredVia: "spawn",
      threadId: CHILD,
      parentThreadId: ROOT,
      state: "working",
      taskRunId: "task-1",
    });
  });

  it("maps the child's latest TaskRun status to its TaskState", () => {
    const input: ParticipantProjectionInput = {
      rootThreadId: ROOT,
      threads: [
        { id: ROOT, parentThreadId: null },
        { id: CHILD, parentThreadId: ROOT },
      ],
      taskRuns: [
        {
          threadId: CHILD,
          taskRunId: "task-old",
          status: "working",
          currentAgentId: "AGT-PEER",
          initiatingAgentId: null,
          startedAt: new Date("2026-06-04T00:00:00Z"),
        },
        {
          threadId: CHILD,
          taskRunId: "task-new",
          status: "input-required",
          currentAgentId: "AGT-PEER",
          initiatingAgentId: null,
          startedAt: new Date("2026-06-04T01:00:00Z"),
        },
      ],
      actingAgentByThread: { [ROOT]: "AGT-OWNER", [CHILD]: "AGT-PEER" },
      identities: {
        "AGT-OWNER": identity("AGT-OWNER", "Owner", "PR-OWNER"),
        "AGT-PEER": identity("AGT-PEER", "Peer", "PR-PEER"),
      },
      ownerAgentId: "AGT-OWNER",
    };
    const sub = buildParticipants(input).find((p) => p.role === "sub-agent")!;
    expect(sub.state).toBe("input-required");
    expect(sub.taskRunId).toBe("task-new");
  });

  it("fails open to agentId when no PrincipalAlias resolved", () => {
    const input: ParticipantProjectionInput = {
      rootThreadId: ROOT,
      threads: [{ id: ROOT, parentThreadId: null }],
      taskRuns: [],
      actingAgentByThread: { [ROOT]: "AGT-LEGACY" },
      identities: { "AGT-LEGACY": identity("AGT-LEGACY", "Legacy Agent", null) },
      ownerAgentId: "AGT-LEGACY",
    };
    const owner = buildParticipants(input)[0];
    expect(owner.principalResolved).toBe(false);
    expect(owner.principalId).toBe("AGT-LEGACY");
  });

  it("coerces an unknown TaskRun status to 'working' rather than crashing", () => {
    const input: ParticipantProjectionInput = {
      rootThreadId: ROOT,
      threads: [
        { id: ROOT, parentThreadId: null },
        { id: CHILD, parentThreadId: ROOT },
      ],
      taskRuns: [
        {
          threadId: CHILD,
          taskRunId: "task-x",
          status: "some-future-status",
          currentAgentId: "AGT-PEER",
          initiatingAgentId: null,
          startedAt: new Date("2026-06-04T00:00:00Z"),
        },
      ],
      actingAgentByThread: { [ROOT]: "AGT-OWNER", [CHILD]: "AGT-PEER" },
      identities: {
        "AGT-OWNER": identity("AGT-OWNER", "Owner", "PR-OWNER"),
        "AGT-PEER": identity("AGT-PEER", "Peer", "PR-PEER"),
      },
      ownerAgentId: "AGT-OWNER",
    };
    const sub = buildParticipants(input).find((p) => p.role === "sub-agent")!;
    expect(sub.state).toBe("working");
  });

  it("omits threads with no resolvable acting agent", () => {
    const input: ParticipantProjectionInput = {
      rootThreadId: ROOT,
      threads: [
        { id: ROOT, parentThreadId: null },
        { id: NESTED, parentThreadId: ROOT },
      ],
      taskRuns: [],
      actingAgentByThread: { [ROOT]: "AGT-OWNER", [NESTED]: null },
      identities: { "AGT-OWNER": identity("AGT-OWNER", "Owner", "PR-OWNER") },
      ownerAgentId: "AGT-OWNER",
    };
    const result = buildParticipants(input);
    expect(result).toHaveLength(1);
    expect(result[0].threadId).toBe(ROOT);
  });
});
