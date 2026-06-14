import { create } from "zustand";
import { SecureStorage } from "@/src/repositories/SecureStorage";
import { getServerUrl } from "@/src/lib/serverConfig";
import type { QueueStorage } from "./queueStorage";

export interface QueuedMutation {
  id: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  body: string;
  status: "pending" | "retrying" | "failed";
  retries: number;
  createdAt: number;
}

const MAX_RETRIES = 3;

export interface OfflineQueueState {
  queue: QueuedMutation[];
  /** Durable storage; null = in-memory only (default until the app wires it). */
  storage: QueueStorage | null;
  configureStorage: (storage: QueueStorage) => void;
  /** Load a persisted queue into memory (call once at app start, after configureStorage). */
  hydrate: () => void;
  enqueue: (
    endpoint: string,
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
  ) => void;
  dequeue: (id: string) => void;
  /** Reset failed mutations back to pending so a later flush retries them. */
  retryFailed: () => void;
  hasPending: () => boolean;
  processQueue: () => Promise<void>;
}

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `oq_${Date.now()}_${idCounter}`;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => {
  const persist = () => {
    const { storage, queue } = get();
    if (!storage) return;
    try {
      storage.save(queue);
    } catch {
      // Best-effort; an unavailable store must never break the queue.
    }
  };

  return {
    queue: [],
    storage: null,

    configureStorage: (storage) => set({ storage }),

    hydrate: () => {
      const { storage } = get();
      if (!storage) return;
      try {
        const saved = storage.load();
        if (Array.isArray(saved)) set({ queue: saved });
      } catch {
        // Best-effort; corrupt/unavailable storage falls back to empty.
      }
    },

    enqueue: (endpoint, method, body) => {
      const mutation: QueuedMutation = {
        id: generateId(),
        endpoint,
        method,
        body: JSON.stringify(body),
        status: "pending",
        retries: 0,
        createdAt: Date.now(),
      };
      set((state) => ({ queue: [...state.queue, mutation] }));
      persist();
    },

    dequeue: (id) => {
      set((state) => ({ queue: state.queue.filter((m) => m.id !== id) }));
      persist();
    },

    retryFailed: () => {
      set((state) => ({
        queue: state.queue.map((m) =>
          m.status === "failed"
            ? { ...m, status: "pending" as const, retries: 0 }
            : m,
        ),
      }));
      persist();
    },

    hasPending: () =>
      get().queue.some(
        (m) => m.status === "pending" || m.status === "retrying",
      ),

    processQueue: async () => {
      const { queue } = get();
      const pending = queue.filter(
        (m) => m.status === "pending" || m.status === "retrying",
      );

      for (const mutation of pending) {
        set((state) => ({
          queue: state.queue.map((m) =>
            m.id === mutation.id ? { ...m, status: "retrying" as const } : m,
          ),
        }));

        try {
          const token = await SecureStorage.getAccessToken();
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) headers["Authorization"] = `Bearer ${token}`;

          const response = await fetch(`${getServerUrl()}${mutation.endpoint}`, {
            method: mutation.method,
            headers,
            body: mutation.method !== "DELETE" ? mutation.body : undefined,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          get().dequeue(mutation.id);
        } catch {
          set((state) => ({
            queue: state.queue.map((m) => {
              if (m.id !== mutation.id) return m;
              const retries = m.retries + 1;
              return {
                ...m,
                retries,
                status:
                  retries >= MAX_RETRIES
                    ? ("failed" as const)
                    : ("pending" as const),
              };
            }),
          }));
        }
      }

      // Persist the post-flush state (retry counts / failures).
      persist();
    },
  };
});
