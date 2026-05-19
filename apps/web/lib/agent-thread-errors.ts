export const THREAD_ERRORS = {
  UNAUTHORIZED: "UNAUTHORIZED",
  DEPTH_LIMIT_EXCEEDED: "DEPTH_LIMIT_EXCEEDED",
  CHILD_LIMIT_EXCEEDED: "CHILD_LIMIT_EXCEEDED",
  PARENT_CANCELLED: "PARENT_CANCELLED",
  DISPATCH_FAILED: "DISPATCH_FAILED",
  AGENT_ERROR: "AGENT_ERROR",
  POLLING_TIMEOUT: "POLLING_TIMEOUT",
} as const;

export type ThreadErrorCode = (typeof THREAD_ERRORS)[keyof typeof THREAD_ERRORS];

export class ThreadSpawnError extends Error {
  readonly code: ThreadErrorCode;

  constructor(code: ThreadErrorCode, message = code) {
    super(message);
    this.name = "ThreadSpawnError";
    this.code = code;
  }
}
