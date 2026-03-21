// apps/web/lib/routing/execution-adapter-registry.ts

/**
 * EP-INF-008a: Execution adapter registry.
 * Maps adapter type strings to handler implementations.
 * The "chat" adapter is registered by chat-adapter.ts at import time.
 */

import type { ExecutionAdapterHandler } from "./adapter-types";

const adapters = new Map<string, ExecutionAdapterHandler>();

export function registerExecutionAdapter(adapter: ExecutionAdapterHandler): void {
  adapters.set(adapter.type, adapter);
}

export function getExecutionAdapter(type: string): ExecutionAdapterHandler {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`No execution adapter registered for type "${type}". Registered: [${[...adapters.keys()].join(", ")}]`);
  }
  return adapter;
}

/** Test-only: reset registry to empty state */
export function _resetAdaptersForTest(): void {
  adapters.clear();
}
