/**
 * EP-MODEL-CAP-001-E: System-level model capability change events.
 *
 * Separate from agentEventBus (which is thread/conversation scoped).
 * Used to invalidate route caches when capability data changes.
 */
import { EventEmitter } from "events";

export interface CapabilityReconciledEvent {
  runId: string;
  source: "catalog" | "discovery";
  changedProviderIds: string[];
  changedCount: number;
  skippedCount: number;
}

class CapabilityEventBus extends EventEmitter {}

export const capabilityEventBus = new CapabilityEventBus();

/** Emit after a reconciliation or discovery run completes. */
export function emitCapabilityReconciled(event: CapabilityReconciledEvent): void {
  capabilityEventBus.emit("capability.reconciled", event);
}

/** Subscribe to capability reconciliation completions. */
export function onCapabilityReconciled(
  handler: (event: CapabilityReconciledEvent) => void,
): () => void {
  capabilityEventBus.on("capability.reconciled", handler);
  return () => capabilityEventBus.off("capability.reconciled", handler);
}
