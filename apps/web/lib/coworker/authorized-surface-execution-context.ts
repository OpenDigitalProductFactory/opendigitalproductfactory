import type { AuthorizedSurfaceContext } from "./authorized-surface-execution-types";

export function createAuthorizedSurfaceTurnGovernance(input: {
  interactionMode: "chat" | "autonomous";
  apiTokenId?: string | null;
  route?: string;
  chatHistory: Array<{ role: string; content?: unknown }>;
}): { coworkerAuthorizedSurfaceBaseline: true; authorizedSurfaceContext: AuthorizedSurfaceContext } {
  const content = [...input.chatHistory].reverse().find((message) => message.role === "user")?.content;
  return {
    coworkerAuthorizedSurfaceBaseline: true,
    authorizedSurfaceContext: {
      mode: input.interactionMode === "chat" ? "browser" : input.apiTokenId ? "external" : "background",
      route: input.route,
      taskIntent: typeof content === "string" ? content : undefined,
    },
  };
}
