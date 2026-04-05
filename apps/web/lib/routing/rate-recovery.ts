// apps/web/lib/routing/rate-recovery.ts
// Schedules model profile recovery after rate limiting.
// Previously used in-memory setTimeout — now dispatches to Inngest durable function.

import { inngest } from "@/lib/queue/inngest-client";

export function scheduleRecovery(
  providerId: string,
  modelId: string,
): void {
  void inngest.send({
    name: "ops/rate.recover",
    data: { providerId, modelId },
  });
}

export function cancelRecovery(_providerId: string, _modelId: string): void {
  // Inngest functions cannot be cancelled by event data match from outside.
  // Rate recovery is idempotent — if the provider is already active, the
  // recovery step is a no-op. No cancellation needed.
}
