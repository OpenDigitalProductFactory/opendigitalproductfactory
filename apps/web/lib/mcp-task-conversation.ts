export function remoteTaskConversation(input: {
  systemPrompt: string;
  prompt: string;
  resumeKind?: "capacity" | "terminal-writer";
  terminalWriterContext?: string;
}): {
  systemPrompt: string;
  chatHistory: Array<{ role: "user"; content: string }>;
} {
  return {
    systemPrompt: input.resumeKind === "terminal-writer" && input.terminalWriterContext
      ? `${input.systemPrompt}\n\n${input.terminalWriterContext}`
      : input.systemPrompt,
    chatHistory: [{ role: "user", content: input.prompt }],
  };
}

