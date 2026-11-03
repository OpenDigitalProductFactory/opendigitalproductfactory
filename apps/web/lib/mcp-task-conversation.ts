import type {ContentBlock, ChatMessage} from "./routing/chat-message-types";
export function remoteTaskConversation(input: {
  systemPrompt: string;
  prompt: string;
  visualInputs?: Extract<ContentBlock,{type:"image_url"|"text"}>[];
  resumeKind?: "capacity" | "terminal-writer";
  terminalWriterContext?: string;
}): {
  systemPrompt: string;
  chatHistory: ChatMessage[];
} {
  return {
    systemPrompt: input.resumeKind === "terminal-writer" && input.terminalWriterContext
      ? `${input.systemPrompt}\n\n${input.terminalWriterContext}`
      : input.systemPrompt,
    chatHistory: [{ role: "user", content: input.visualInputs?.length ? [{type:"text",text:input.prompt},...input.visualInputs] : input.prompt }],
  };
}

