import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tak/coworker-tool-grant-core", () => ({
  resolveCoworkerAgent: vi.fn(),
}));
vi.mock("@/lib/tak/effort-context-runner", () => ({
  recordEffortEntry: vi.fn(),
  loadEffortContext: vi.fn(),
}));

import { resolveCoworkerAgent } from "@/lib/tak/coworker-tool-grant-core";
import { recordEffortEntry, loadEffortContext } from "@/lib/tak/effort-context-runner";
import { effortContextPack } from "./effort-context-pack";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const SCOUT = { id: "cuid-scout", agentId: "AGT-WS-SCOUT", slugId: "scout", displayName: "Scout" };

beforeEach(() => vi.clearAllMocks());

describe("effortContextPack shape", () => {
  it("owns both tools ungated with a handler each", () => {
    expect(effortContextPack.definitions.map((d) => d.name).sort()).toEqual([
      "read_effort_context",
      "record_effort_context",
    ]);
    expect(effortContextPack.grants).toEqual({ record_effort_context: [], read_effort_context: [] });
    for (const def of effortContextPack.definitions) {
      expect(effortContextPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("keeps tool descriptions provenance-free (matches the hygiene guard)", () => {
    // Same patterns as apps/web/lib/tool-description-hygiene.test.ts.
    for (const def of effortContextPack.definitions) {
      expect(def.description).not.toMatch(/\bPhase\s+\d+[a-z]?\b/i);
      expect(def.description).not.toMatch(/\bBI-[0-9A-Fa-f]{6,}\b/i);
      expect(def.description).not.toMatch(/\bEP-[0-9A-Fa-f]{6,}\b/i);
    }
  });
});

describe("record_effort_context", () => {
  it("rejects an unknown kind before writing", async () => {
    const res = await effortContextPack.handlers["record_effort_context"](
      { effortKey: "epic:EP-1", kind: "blocker", content: "x" },
      "user-1",
      { agentId: "AGT-WS-SCOUT" },
    );
    expect(res.success).toBe(false);
    expect(recordEffortEntry).not.toHaveBeenCalled();
  });

  it("rejects a missing effortKey and empty content", async () => {
    const a = await effortContextPack.handlers["record_effort_context"](
      { kind: "note", content: "x" },
      "user-1",
      { agentId: "AGT-WS-SCOUT" },
    );
    expect(a.success).toBe(false);
    const b = await effortContextPack.handlers["record_effort_context"](
      { effortKey: "epic:EP-1", kind: "note", content: "   " },
      "user-1",
      { agentId: "AGT-WS-SCOUT" },
    );
    expect(b.success).toBe(false);
  });

  it("appends with the resolved calling coworker as author", async () => {
    asMock(resolveCoworkerAgent).mockResolvedValue(SCOUT);
    asMock(recordEffortEntry).mockResolvedValue({
      effortKey: "epic:EP-1",
      title: null,
      epicId: null,
      backlogItemId: null,
      decisions: ["use TDD"],
      openQuestions: [],
      notes: [],
      participantAgentIds: ["cuid-scout"],
    });
    const res = await effortContextPack.handlers["record_effort_context"](
      { effortKey: "epic:EP-1", kind: "decision", content: "use TDD" },
      "user-1",
      { agentId: "AGT-WS-SCOUT" },
    );
    expect(res.success).toBe(true);
    expect(recordEffortEntry).toHaveBeenCalledWith(
      expect.objectContaining({ effortKey: "epic:EP-1", kind: "decision", content: "use TDD", agentId: "cuid-scout" }),
    );
  });
});

describe("read_effort_context", () => {
  it("returns an empty shape when the effort has no context yet", async () => {
    asMock(loadEffortContext).mockResolvedValue(null);
    const res = await effortContextPack.handlers["read_effort_context"](
      { effortKey: "epic:EP-404" },
      "user-1",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ decisions: [], openQuestions: [], notes: [] });
  });

  it("returns the shared context when present", async () => {
    asMock(loadEffortContext).mockResolvedValue({
      effortKey: "epic:EP-1",
      title: "Billing",
      epicId: null,
      backlogItemId: null,
      decisions: ["use TDD"],
      openQuestions: ["which db?"],
      notes: [],
      participantAgentIds: ["cuid-scout"],
    });
    const res = await effortContextPack.handlers["read_effort_context"](
      { effortKey: "epic:EP-1" },
      "user-1",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      decisions: ["use TDD"],
      openQuestions: ["which db?"],
      participants: ["cuid-scout"],
    });
  });
});
