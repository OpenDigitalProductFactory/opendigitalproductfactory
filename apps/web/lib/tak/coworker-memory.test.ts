import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerMemoryNote: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

import {
  COWORKER_NOTE_KINDS,
  formatNotesAsContext,
  isKnownNoteKind,
  loadCoworkerNotes,
  recordCoworkerNote,
} from "./coworker-memory";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.coworkerMemoryNote.create).mockResolvedValue({ id: "note-new" });
  // BI-840FDD43: the consolidation gate loads sibling notes when there is no
  // exact-key match; default to an empty store so the exact-key/no-match cases
  // behave as before unless a test seeds siblings.
  asMock(prisma.coworkerMemoryNote.findMany).mockResolvedValue([]);
});

describe("isKnownNoteKind", () => {
  it("accepts every declared kind and rejects an unknown one", () => {
    for (const kind of COWORKER_NOTE_KINDS) expect(isKnownNoteKind(kind)).toBe(true);
    expect(isKnownNoteKind("nonsense")).toBe(false);
  });
});

describe("recordCoworkerNote", () => {
  it("rejects an unknown note kind before any write", async () => {
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "nonsense",
      noteKey: "k",
      content: "c",
    });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/note kind/i) });
    expect(prisma.coworkerMemoryNote.findFirst).not.toHaveBeenCalled();
    expect(prisma.coworkerMemoryNote.create).not.toHaveBeenCalled();
  });

  it("rejects empty content", async () => {
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "technique",
      noteKey: "k",
      content: "   ",
    });
    expect(res).toMatchObject({ ok: false });
    expect(prisma.coworkerMemoryNote.create).not.toHaveBeenCalled();
  });

  it("creates a fresh note when none exists for the key", async () => {
    asMock(prisma.coworkerMemoryNote.findFirst).mockResolvedValueOnce(null);
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "technique",
      noteKey: "dedupe-first",
      content: "Always dedupe against merged PRs before filing.",
      createdBy: null,
    });
    expect(res).toEqual({ ok: true, status: "created" });
    expect(prisma.coworkerMemoryNote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: "cuid-scout",
        noteKind: "technique",
        noteKey: "dedupe-first",
        content: "Always dedupe against merged PRs before filing.",
      }),
    });
    expect(prisma.coworkerMemoryNote.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the same key already holds identical content", async () => {
    asMock(prisma.coworkerMemoryNote.findFirst).mockResolvedValueOnce({
      id: "note-1",
      content: "same",
    });
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "context",
      noteKey: "k",
      content: "same",
    });
    expect(res).toEqual({ ok: true, status: "unchanged" });
    expect(prisma.coworkerMemoryNote.create).not.toHaveBeenCalled();
    expect(prisma.coworkerMemoryNote.update).not.toHaveBeenCalled();
  });

  it("supersedes the prior note when the key exists with different content", async () => {
    asMock(prisma.coworkerMemoryNote.findFirst).mockResolvedValueOnce({ id: "note-old", content: "old" });
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "caution",
      noteKey: "k",
      content: "new",
    });
    expect(res).toEqual({ ok: true, status: "updated" });
    expect(prisma.coworkerMemoryNote.create).toHaveBeenCalledTimes(1);
    expect(prisma.coworkerMemoryNote.update).toHaveBeenCalledWith({
      where: { id: "note-old" },
      data: { supersededAt: expect.any(Date), supersededById: "note-new" },
    });
  });

  it("supersedes a different-key near-duplicate via the consolidation gate (BI-840FDD43)", async () => {
    // No exact-key match, but an active sibling states the same concept under a
    // different key with a changed value → the gate supersedes the sibling.
    asMock(prisma.coworkerMemoryNote.findFirst).mockResolvedValueOnce(null);
    asMock(prisma.coworkerMemoryNote.findMany).mockResolvedValueOnce([
      { id: "note-near", noteKey: "preferred_review_style", content: "terse bullet points" },
    ]);
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "preference",
      noteKey: "review_style_preferred",
      content: "detailed prose",
    });
    expect(res).toEqual({ ok: true, status: "updated" });
    expect(prisma.coworkerMemoryNote.create).toHaveBeenCalledTimes(1);
    expect(prisma.coworkerMemoryNote.update).toHaveBeenCalledWith({
      where: { id: "note-near" },
      data: { supersededAt: expect.any(Date), supersededById: "note-new" },
    });
  });

  it("no-ops a different-key near-duplicate that restates the same content", async () => {
    asMock(prisma.coworkerMemoryNote.findFirst).mockResolvedValueOnce(null);
    asMock(prisma.coworkerMemoryNote.findMany).mockResolvedValueOnce([
      { id: "note-near", noteKey: "preferred_review_style", content: "terse bullet points" },
    ]);
    const res = await recordCoworkerNote({
      agentCuid: "cuid-scout",
      noteKind: "preference",
      noteKey: "review_style_preferred",
      content: "Terse bullet points",
    });
    expect(res).toEqual({ ok: true, status: "unchanged" });
    expect(prisma.coworkerMemoryNote.create).not.toHaveBeenCalled();
  });
});

describe("loadCoworkerNotes", () => {
  it("loads only active notes for the agent, newest first, capped at the limit", async () => {
    asMock(prisma.coworkerMemoryNote.findMany).mockResolvedValueOnce([]);
    await loadCoworkerNotes("cuid-scout", 5);
    expect(prisma.coworkerMemoryNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: "cuid-scout", supersededAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    );
  });
});

describe("formatNotesAsContext", () => {
  it("returns null when there are no notes", () => {
    expect(formatNotesAsContext([])).toBeNull();
  });

  it("renders a labelled block grouping each note by kind and key", () => {
    const block = formatNotesAsContext([
      { id: "1", noteKind: "technique", noteKey: "dedupe", content: "dedupe first", createdAt: new Date() },
    ]);
    expect(block).toContain("technique");
    expect(block).toContain("dedupe first");
  });
});
