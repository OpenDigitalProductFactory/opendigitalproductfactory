import type { AuthorizedSurfaceContext } from "./authorized-surface-execution-types";

export function createAuthorizedSurfaceTurnGovernance(input: {
  interactionMode: "chat" | "autonomous";
  apiTokenId?: string | null;
  route?: string;
  /**
   * The Workroom the turn runs in (WC-*). Populating this is what lets the
   * room-aware pre-tool gate (workroom-shape-governance-hook) fire for chat
   * turns — until BI-F114354D no caller set it, so the gate never ran from
   * the composer.
   */
  workroomId?: string | null;
  chatHistory: Array<{ role: string; content?: unknown }>;
}): { coworkerAuthorizedSurfaceBaseline: true; authorizedSurfaceContext: AuthorizedSurfaceContext } {
  const content = [...input.chatHistory].reverse().find((message) => message.role === "user")?.content;
  return {
    coworkerAuthorizedSurfaceBaseline: true,
    authorizedSurfaceContext: {
      mode: input.interactionMode === "chat" ? "browser" : input.apiTokenId ? "external" : "background",
      route: input.route,
      ...(input.workroomId ? { workroomId: input.workroomId } : {}),
      taskIntent: typeof content === "string" ? content : undefined,
    },
  };
}
