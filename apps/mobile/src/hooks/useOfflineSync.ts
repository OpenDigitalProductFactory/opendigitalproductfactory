import { useEffect, useRef } from "react";
import { useOfflineStatus } from "@/src/hooks/useOfflineStatus";
import { useOfflineQueueStore } from "@/src/stores/offlineQueue";

/**
 * Flush the offline mutation queue when connectivity is regained. A field
 * worker who checks in/out while offline has those mutations sent automatically
 * the moment the device comes back online.
 */
export function shouldFlush(
  prevOnline: boolean,
  nowOnline: boolean,
  hasPending: boolean,
): boolean {
  return !prevOnline && nowOnline && hasPending;
}

export function useOfflineSync(): void {
  const { isOnline } = useOfflineStatus();
  const prevOnline = useRef(isOnline);
  const processQueue = useOfflineQueueStore((s) => s.processQueue);
  const pending = useOfflineQueueStore((s) =>
    s.queue.some((m) => m.status === "pending" || m.status === "retrying"),
  );

  useEffect(() => {
    if (shouldFlush(prevOnline.current, isOnline, pending)) {
      void processQueue();
    }
    prevOnline.current = isOnline;
  }, [isOnline, pending, processQueue]);
}
