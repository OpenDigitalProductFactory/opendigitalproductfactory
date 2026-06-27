import { describe, expect, it } from "vitest";

import { createWorkCaseGovernanceHook } from "./work-case-governance-hook";

const NORMAL_USER = {
  platformRole: "ceo",
  isSuperuser: true,
};

const BASE_EVENT = {
  toolName: "query_backlog",
  rawParams: {},
  userId: "user-1",
  userContext: NORMAL_USER,
  source: "rest",
} as const;

const BASE_WORK_CASE = {
  caseRef: {
    caseId: "backlog-item:BI-1",
    sourceType: "backlog-item",
    sourceId: "BI-1",
  },
  sourceKey: "backlog-item",
  action: "respond",
  currentState: {
    state: "active",
    terminal: false,
  },
  envelope: {
    autonomyMode: "autonomous",
    receiptPolicy: {
      required: true,
      kind: "governed-action",
    },
  },
} as const;

describe("createWorkCaseGovernanceHook", () => {
  it("allows tool execution when no Work Case context is present", async () => {
    const hook = createWorkCaseGovernanceHook();

    await expect(hook.onPreToolUse?.(BASE_EVENT)).resolves.toEqual({
      decision: "allow",
      reason: "No Work Case context supplied.",
    });
  });

  it("denies tool execution when Work Case policy denies the action", async () => {
    const hook = createWorkCaseGovernanceHook();

    await expect(
      hook.onPreToolUse?.({
        ...BASE_EVENT,
        context: {
          workCase: {
            ...BASE_WORK_CASE,
            action: "complete",
            currentState: {
              state: "closed",
              terminal: true,
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      decision: "deny",
      reason: expect.stringContaining("terminal_case_sealed"),
    });
  });

  it("allows tool execution when Work Case policy allows the action", async () => {
    const hook = createWorkCaseGovernanceHook();

    await expect(
      hook.onPreToolUse?.({
        ...BASE_EVENT,
        context: {
          workCase: BASE_WORK_CASE,
        },
      }),
    ).resolves.toEqual({
      decision: "allow",
      reason: "Work Case policy allowed respond.",
    });
  });
});
