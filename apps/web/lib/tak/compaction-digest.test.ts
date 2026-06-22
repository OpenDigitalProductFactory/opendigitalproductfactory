import { describe, it, expect } from "vitest";
import { summarizeDroppedMessages, type CompactionMessageLike } from "./compaction-digest";

describe("summarizeDroppedMessages", () => {
  it("returns null for an empty/absent span", () => {
    expect(summarizeDroppedMessages([])).toBeNull();
    expect(summarizeDroppedMessages(null)).toBeNull();
    expect(summarizeDroppedMessages(undefined)).toBeNull();
  });

  it("returns null when the span has no tool activity (plain text is droppable)", () => {
    const span: CompactionMessageLike[] = [
      { role: "user", content: "do the thing" },
      { role: "assistant", content: "sure, thinking about it" },
    ];
    expect(summarizeDroppedMessages(span)).toBeNull();
  });

  it("tallies tools used in the dropped span", () => {
    const span: CompactionMessageLike[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "search_knowledge" }] },
      { role: "tool", content: "ok\n{}", toolCallId: "a" },
      { role: "assistant", content: "", toolCalls: [{ id: "b", name: "search_knowledge" }] },
      { role: "tool", content: "ok\n{}", toolCallId: "b" },
    ];
    const digest = summarizeDroppedMessages(span);
    expect(digest).toContain("search_knowledge ×2");
    expect(digest).toContain("4 message(s) were compacted");
    expect(digest).not.toContain("failed");
  });

  it("flags failures (Error: results) per tool", () => {
    const span: CompactionMessageLike[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "x", name: "run_sandbox_tests" }] },
      { role: "tool", content: "Error: tests failed", toolCallId: "x" },
      { role: "assistant", content: "", toolCalls: [{ id: "y", name: "edit_sandbox_file" }] },
      { role: "tool", content: "ok\n{}", toolCallId: "y" },
    ];
    const digest = summarizeDroppedMessages(span)!;
    expect(digest).toContain("run_sandbox_tests ×1 (1 failed)");
    expect(digest).toContain("edit_sandbox_file ×1");
    // edit_sandbox_file succeeded → no "(failed)" on it
    expect(digest).toMatch(/edit_sandbox_file ×1(,| )/);
  });

  it("sorts tools deterministically (byte order)", () => {
    const span: CompactionMessageLike[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "zzz_tool" }] },
      { role: "assistant", content: "", toolCalls: [{ id: "2", name: "aaa_tool" }] },
    ];
    const digest = summarizeDroppedMessages(span)!;
    expect(digest.indexOf("aaa_tool")).toBeLessThan(digest.indexOf("zzz_tool"));
  });
});
