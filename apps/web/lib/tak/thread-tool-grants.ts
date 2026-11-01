/** Shared work-thread pack and governing grant declarations. Read never implies write. */
export const THREAD_TOOL_GRANTS: Record<string, string[]> = {
  spawn_work_thread: ["thread_write"],
  cancel_thread: ["thread_write"],
  get_thread_result: ["thread_read"],
  get_child_threads: ["thread_read"],
  // A feedback writer can inspect the exact judgment it may change; delegation reads keep their separate grant.
  get_response_feedback: ["thread_read", "thread_write"],
  record_response_feedback: ["thread_write"],
};
