import type { UserContext } from "@/lib/permissions";

export type AuthorizedSurfaceContext = {
  mode?: "browser" | "headless" | "workroom" | "scheduled" | "background" | "external" | "mobile";
  route?: string;
  locale?: string;
  timezone?: string;
  workspaceId?: string;
  workroomId?: string;
  workroomType?: string;
  resourceType?: string;
  resourceIds?: string[];
  taskIntent?: string;
};

export type AuthorizedSurfaceInvocation = {
  surfaceId: string;
  sessionId: string;
  revision: string;
  actionId: string;
};

type AuthorizedSurfaceDispatchResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
};

export type AuthorizedSurfaceToolExecutionContext = {
  userContext?: UserContext;
  governedSource?: "rest" | "jsonrpc" | "external-jsonrpc" | "internal-mcp-session" | "agentic-loop";
  tokenScope?: "read" | "write" | "admin";
  tokenGrantScopes?: string[];
  governedDispatch?: (
    toolName: string,
    params: Record<string, unknown>,
    invocation?: AuthorizedSurfaceInvocation,
  ) => Promise<AuthorizedSurfaceDispatchResult>;
  authorizedSurfaceContext?: AuthorizedSurfaceContext;
};
