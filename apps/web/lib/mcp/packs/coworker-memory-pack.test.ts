import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tak/coworker-tool-grant-core", () => ({
  resolveCoworkerAgent: vi.fn(),
}));
vi.mock("@/lib/tak/coworker-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tak/coworker-memory")>();
  return {
    ...actual, // keep COWORKER_NOTE_KINDS (imported at module load for the schema enum)
    recordCoworkerNote: vi.fn(),
    loadCoworkerNotes: vi.fn(),
  };
});

import { resolveCoworkerAgent } from "@/lib/tak/coworker-tool-grant-core";
import { loadCoworkerNotes, recordCoworkerNote } from "@/lib/tak/coworker-memory";
import { coworkerMemoryPack } from "./coworker-memory-pack";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const SCOUT = { id: "cuid-scout", agentId: "AGT-WS-SCOUT", slugId: "external-catalog-scout", displayName: "Scout" };

beforeEach(() => vi.clearAllMocks());

describe("coworkerMemoryPack shape", () => {
  it("owns both tools ungated with a handler each", () => {
    expect(coworkerMemoryPack.definitions.map((d) => d.name).sort()).toEqual([
      "list_working_notes",
      "record_working_note",
    ]);
    expect(coworkerMemoryPack.grants).toEqual({ record_working_note: [], list_working_notes: [] });
    expect(Object.keys(coworkerMemoryPack.handlers).sort()).toEqual([
      "list_working_notes",
      "record_working_note",
    ]);
  });
});

describe("record_working_note", () => {
  it("scopes the write to the CALLING coworker (context.agentId), not any param", async () => {
    asMock(resolveCoworkerAgent).mockResolvedValueOnce(SCOUT);
    asMock(recordCoworkerNote).mockResolvedValueOnce({ ok: true, status: "created" });
    const res = await coworkerMemoryPack.handlers.record_working_note(
      { kind: "technique", key: "dedupe", content: "dedupe first", agentCuid: "cuid-attacker" },
      "user_1",
      { agentId: "AGT-WS-SCOUT" },
    );
    expect(resolveCoworkerAgent).toHaveBeenCalledWith("AGT-WS-SCOUT");
    expect(recordCoworkerNote).toHaveBeenCalledWith(
      expect.objectContaining({ agentCuid: "cuid-scout", noteKind: "technique", noteKey: "dedupe" }),
    );
    expect(res.success).toBe(true);
  });

  it("rejects a non-agent caller (no context.agentId) without writing", async () => {
    const res = await coworkerMemoryPack.handlers.record_working_note(
      { kind: "technique", key: "k", content: "c" },
      "user_1",
      {},
    );
    expect(res).toMatchObject({ success: false, error: "no_calling_coworker" });
    expect(recordCoworkerNote).not.toHaveBeenCalled();
  });

  it("surfaces a core validation failure", async () => {
    asMock(resolveCoworkerAgent).mockResolvedValueOnce(SCOUT);
    asMock(recordCoworkerNote).mockResolvedValueOnce({ ok: false, error: "Unknown note kind: bad" });
    const res = await coworkerMemoryPack.handlers.record_working_note(
      { kind: "bad", key: "k", content: "c" },
      "user_1",
      { agentId: "AGT-WS-SCOUT" },
    );
    expect(res).toMatchObject({ success: false, error: "note_write_failed" });
  });
});

describe("list_working_notes", () => {
  it("returns the calling coworker's own notes", async () => {
    asMock(resolveCoworkerAgent).mockResolvedValueOnce(SCOUT);
    asMock(loadCoworkerNotes).mockResolvedValueOnce([
      { id: "1", noteKind: "technique", noteKey: "dedupe", content: "dedupe first", createdAt: new Date() },
    ]);
    const res = await coworkerMemoryPack.handlers.list_working_notes({}, "user_1", { agentId: "AGT-WS-SCOUT" });
    expect(loadCoworkerNotes).toHaveBeenCalledWith("cuid-scout");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ notes: [{ kind: "technique", key: "dedupe", content: "dedupe first" }] });
  });

  it("rejects a non-agent caller", async () => {
    const res = await coworkerMemoryPack.handlers.list_working_notes({}, "user_1", {});
    expect(res).toMatchObject({ success: false, error: "no_calling_coworker" });
    expect(loadCoworkerNotes).not.toHaveBeenCalled();
  });
});
