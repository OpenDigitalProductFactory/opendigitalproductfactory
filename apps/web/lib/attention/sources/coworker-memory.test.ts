import { describe, expect, it, vi } from "vitest";

import { classifyOwnerAttentionLane } from "../owner-routing";
import {
  coworkerMemoryNoteToAttentionItem,
  loadCoworkerMemoryItems,
} from "./coworker-memory";

describe("coworker memory attention source", () => {
  it("projects newly distilled coworker notes into the digest lane", () => {
    const item = coworkerMemoryNoteToAttentionItem({
      id: "note-1",
      noteKind: "technique",
      noteKey: "source-local-vitest",
      content: "Use source-local Vitest before broad gates.",
      sourceRef: "memory-distill:task-run:task-1",
      createdAt: new Date("2026-07-22T01:00:00.000Z"),
      agent: { agentId: "AGT-EA", displayName: "Enterprise Architect", name: "Architect" },
    });

    expect(item).toMatchObject({
      id: "coworker-memory:note-1",
      source: "coworker-memory",
      title: "New coworker memory note",
      context: "Enterprise Architect remembered a technique: Use source-local Vitest before broad gates.",
      riskClass: "read",
      deepLink: "/platform/ai/memory",
      audience: { operator: true },
    });
    expect(classifyOwnerAttentionLane(item).lane).toBe("weekly-digest");
  });

  it("loads active recently recorded notes", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "note-1",
        noteKind: "context",
        noteKey: "checkpoint-sweep",
        content: "Run checkpoint folding from the nightly pass.",
        sourceRef: "memory-distill:phase-handoff:handoff-1",
        createdAt: new Date("2026-07-22T01:00:00.000Z"),
        agent: { agentId: "AGT-EA", displayName: "Enterprise Architect", name: "Architect" },
      },
    ]);

    const items = await loadCoworkerMemoryItems(
      { coworkerMemoryNote: { findMany } },
      { now: new Date("2026-07-22T04:00:00.000Z") },
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        supersededAt: null,
      }),
    }));
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("coworker-memory");
  });
});
