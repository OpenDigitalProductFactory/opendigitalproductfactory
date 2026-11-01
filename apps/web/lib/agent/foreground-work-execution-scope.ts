import { AsyncLocalStorage } from "node:async_hooks";
import type { TaskExecutionFence } from "@/lib/shared/task-execution-fence";

// The existing retained execution scope has one store. Keep its read projection
// free of web authentication dependencies for shared server/script callers.
type ForegroundExecutionScope = {
  taskRunId: string;
  agentId: string | null;
  fence: TaskExecutionFence | null;
  deadlineAt: string;
  userId: string;
  threadId: string;
};
const execution = new AsyncLocalStorage<ForegroundExecutionScope>();

/** Called only after foreground-work-context has revalidated the saved actor. */
export function withForegroundExecutionScope<T>(scope: ForegroundExecutionScope, action: () => T): T {
  return execution.run(scope, action);
}

export function foregroundExecutionContext() {
  return execution.getStore() ?? null;
}
