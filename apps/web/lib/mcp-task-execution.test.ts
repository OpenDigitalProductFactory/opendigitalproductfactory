import { describe, expect, it } from "vitest";

import { remoteTaskChatHistory } from "./mcp-task-execution";

describe("remoteTaskChatHistory", () => {
  it("places hydrated terminal-writer context before the user prompt", () => {
    expect(remoteTaskChatHistory({
      prompt: "Record the exact governed receipt.",
      resumeKind: "terminal-writer",
      terminalWriterContext: "Immutable artifact evidence",
    })).toEqual([
      { role: "system", content: "Immutable artifact evidence" },
      { role: "user", content: "Record the exact governed receipt." },
    ]);
  });

  it("keeps an ordinary task prompt as the only history message", () => {
    expect(remoteTaskChatHistory({ prompt: "Inspect the artifact." })).toEqual([
      { role: "user", content: "Inspect the artifact." },
    ]);
  });
});
