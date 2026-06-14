import { CacheRepository } from "@/src/repositories/CacheRepository";
import type { QueuedMutation } from "./offlineQueue";

/**
 * Durable storage for the offline mutation queue, so a field worker's queued
 * check-ins survive an app restart while offline. Injected into the queue store
 * (see offlineQueue.configureStorage) so tests can swap an in-memory double.
 */
export interface QueueStorage {
  load(): QueuedMutation[];
  save(queue: QueuedMutation[]): void;
}

const QUEUE_KEY = "dpf-offline-queue";

// Lazily-created so importing this module does not open SQLite at load time.
let repo: CacheRepository | null = null;
function getRepo(): CacheRepository {
  if (!repo) repo = new CacheRepository();
  return repo;
}

/** SQLite-backed queue storage (the app default). */
export const sqliteQueueStorage: QueueStorage = {
  load() {
    return getRepo().get<QueuedMutation[]>(QUEUE_KEY) ?? [];
  },
  save(queue) {
    getRepo().set(QUEUE_KEY, queue);
  },
};
