export type SetupEvent = {
  event: "field_updated" | "step_completed" | "step_skipped" | "error" | "provider_test_success" | "provider_test_failure";
  field?: string;
  value?: string;
  message?: string;
};

type EventHandler = (events: SetupEvent[]) => void;

/**
 * Client-side event queue that debounces setup page events
 * before sending them to the COO chat panel.
 */
export class SetupEventQueue {
  private queue: SetupEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private handler: EventHandler;
  private debounceMs: number;

  constructor(handler: EventHandler, debounceMs = 500) {
    this.handler = handler;
    this.debounceMs = debounceMs;
  }

  push(event: SetupEvent) {
    this.queue.push(event);
    if (this.busy) return;
    this.resetTimer();
  }

  resume() {
    this.busy = false;
    if (this.queue.length > 0) {
      this.flush();
    }
  }

  private resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush() {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];
    this.busy = true;
    this.handler(batch);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}
