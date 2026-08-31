import { describe, expect, it } from "vitest";

import { remoteTaskConversation } from "./mcp-task-execution";

describe("remoteTaskConversation", () => {
  it("merges hydrated terminal-writer context into the sole system prompt", () => {
    expect(remoteTaskConversation({
      systemPrompt: "Review independently.",
      prompt: "Record the exact governed receipt.",
      resumeKind: "terminal-writer",
      terminalWriterContext: "Immutable artifact evidence",
    })).toEqual({
      systemPrompt: "Review independently.\n\nImmutable artifact evidence",
      chatHistory: [
        { role: "user", content: "Record the exact governed receipt." },
      ],
    });
  });

  it("keeps an ordinary task system prompt and user history unchanged", () => {
    expect(remoteTaskConversation({
      systemPrompt: "Review independently.",
      prompt: "Inspect the artifact.",
    })).toEqual({
      systemPrompt: "Review independently.",
      chatHistory: [
        { role: "user", content: "Inspect the artifact." },
      ],
    });
  });
});
