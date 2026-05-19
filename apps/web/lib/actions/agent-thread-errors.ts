export const THREAD_ERRORS = {
  UNAUTHORIZED: "UNAUTHORIZED",
  DEPTH_LIMIT_EXCEEDED: "DEPTH_LIMIT_EXCEEDED",
  CHILD_LIMIT_EXCEEDED: "CHILD_LIMIT_EXCEEDED",
  PARENT_CANCELLED: "PARENT_CANCELLED",
  DISPATCH_FAILED: "DISPATCH_FAILED",
  POLLING_TIMEOUT: "POLLING_TIMEOUT",
  AGENT_ERROR: "AGENT_ERROR",
} as const;

export class ThreadSpawnError extends Error {
  constructor(
    public code: keyof typeof THREAD_ERRORS,
    message: string,
  ) {
    super(message);
    this.name = "ThreadSpawnError";
  }
}
