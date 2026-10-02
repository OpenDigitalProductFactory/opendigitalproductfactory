// GPP Phase 2 PR-H (BI-69415B68): screen_dispatch_action end to end through the
// REAL reference monitor. The outer call and the envelope's underlying tool are
// each admitted and audited by governedExecuteTool on their own; the
// unchanged envelope outcome is pinned in screen-pack.dispatch.characterization.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  envelopeFindUnique: vi.fn(),
  envelopeUpdate: vi.fn(),
  toolExecutionCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerActionEnvelope: {
      create: vi.fn(),
      findUnique: (...args: unknown[]) => db.envelopeFindUnique(...args),
      update: (...args: unknown[]) => db.envelopeUpdate(...args),
    },
    toolExecution: { create: (...args: unknown[]) => db.toolExecutionCreate(...args), update: vi.fn() },
    featureBuild: { findUnique: async () => null },
  },
}));

import { _setGovernanceForTests, governedExecuteTool } from "@/lib/mcp-governed-execute";
import { ALL_MANIFESTS } from "@/lib/coworker/manifests";
import type { ScreenManifest } from "@/lib/coworker/screen-manifest-types";

const manifest: ScreenManifest = {
  surfaceId: "test-surface",
  routePattern: "/test",
  label: "Test",
  selections: [],
  navigations: [],
  panels: [],
  forms: [],
  domainActions: [{ actionId: "pick", tool: "screen_select_entity", label: "Pick", invoke: async () => {} }],
  destructiveActions: [],
};

const envelope = {
  id: "env-1",
  coworkerAgentId: "AGT-X",
  delegatingUserId: "u-owner",
  threadId: "thread-1",
  chatMessageId: null,
  manifestActionId: "pick",
  argsJson: { selectionId: "build", entityId: "FB-1" },
  rationale: "test",
  status: "approved",
  createdAt: new Date(),
  resolvedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  _setGovernanceForTests({});
  ALL_MANIFESTS.length = 0;
  ALL_MANIFESTS.push(manifest);
  db.envelopeFindUnique.mockResolvedValue(envelope);
  db.envelopeUpdate.mockResolvedValue({ ...envelope, status: "executed", resolvedAt: new Date() });
  db.toolExecutionCreate.mockImplementation(async ({ data }: { data: { toolName: string } }) => ({ id: `TE-${data.toolName}` }));
});
afterEach(() => {
  ALL_MANIFESTS.length = 0;
  _setGovernanceForTests({});
});

describe("screen_dispatch_action through the reference monitor", () => {
  it("the underlying tool is admitted and audited on its own, and the envelope result is unchanged", async () => {
    const r = await governedExecuteTool({
      toolName: "screen_dispatch_action",
      rawParams: { envelopeId: "env-1" },
      userId: "u-owner",
      userContext: { platformRole: "HR-000", isSuperuser: false },
      context: { routeContext: "/test", threadId: "thread-1" },
      source: "rest",
    });

    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      event: {
        type: "screen:action_dispatched",
        payload: { envelopeId: "env-1", tool: "screen_select_entity", manifestActionId: "pick", ok: true },
      },
      // The nested monitor's `governance` block is not part of the envelope's tool result.
      toolResult: {
        success: true,
        message: expect.any(String),
        data: { event: { type: "screen:select_entity", payload: { selectionId: "build", entityId: "FB-1" } } },
      },
    });
    const audited = db.toolExecutionCreate.mock.calls.map(([arg]) => (arg as { data: Record<string, unknown> }).data);
    expect(audited.map((row) => [row.toolName, row.userId, row.executionMode, row.routeContext])).toEqual([
      ["screen_select_entity", "u-owner", "rest", "/test"],
      ["screen_dispatch_action", "u-owner", "rest", "/test"],
    ]);
    expect(db.envelopeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "env-1" }, data: expect.objectContaining({ status: "executed" }) }),
    );
  });
});
