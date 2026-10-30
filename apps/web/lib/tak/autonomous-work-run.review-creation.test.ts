import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const tx = { taskRun: { create: vi.fn() } };
  return { prisma: { ...tx, $transaction: vi.fn(async callback => callback(tx)) } };
});
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("../mcp-task-review-reassessment", () => ({ lockInitiativeReviewCreationSubject: vi.fn() }));

import { prisma } from "@dpf/db";
import { lockInitiativeReviewCreationSubject } from "../mcp-task-review-reassessment";
import { createAutonomousWorkRun } from "./autonomous-work-run";

beforeEach(() => vi.resetAllMocks());

it("checks server-held review authority in the same transaction before creating the task", async () => {
  const binding = { itemId: "BI-FIXTURE", gate: "design-spec" };
  const authority = { taskAuthorityKey: "oauth-family:fixture", tokenId: "token-fixture", parsed: { agentId: "reviewer" } };
  vi.mocked(lockInitiativeReviewCreationSubject).mockImplementation(async (tx, target, current) => {
    expect(tx.taskRun).toBe(prisma.taskRun);
    expect(target).toBe(binding);
    expect(current).toEqual({ ...authority, userId: "human" });
    expect(prisma.taskRun.create).not.toHaveBeenCalled();
    throw new Error("synthetic predecessor barrier");
  });
  await expect(createAutonomousWorkRun({ trigger: "external-mcp", userId: "human", agentId: "reviewer",
    routeContext: "/build", title: "Review", objective: "Review fixture", prompt: "Review fixture",
    metadata: { initiativeReviewBinding: binding }, reviewCreationAuthority: authority as never,
  })).rejects.toThrow("synthetic predecessor barrier");
  expect(lockInitiativeReviewCreationSubject).toHaveBeenCalledOnce();
  expect(prisma.taskRun.create).not.toHaveBeenCalled();
});

it("refuses review creation authority on a scheduled trigger before creating work", async () => {
  await expect(createAutonomousWorkRun({ trigger: "scheduled", userId: "human", agentId: "reviewer",
    routeContext: "/build", title: "Review", objective: "Review fixture", prompt: "Review fixture",
    reviewCreationAuthority: { taskAuthorityKey: "oauth-family:fixture", tokenId: "token-fixture", parsed: {} as never },
  })).rejects.toThrow("restricted to external MCP work");
  expect(prisma.taskRun.create).not.toHaveBeenCalled();
});
