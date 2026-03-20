import { create } from "zustand";
import { SecureStorage } from "@/src/repositories/SecureStorage";

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
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export interface OfflineQueueState {
  queue: QueuedMutation[];
  enqueue: (
    endpoint: string,
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
  ) => void;
  dequeue: (id: string) => void;
  processQueue: () => Promise<void>;
}

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `oq_${Date.now()}_${idCounter}`;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => ({
  queue: [],

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
  },

  dequeue: (id) => {
    set((state) => ({ queue: state.queue.filter((m) => m.id !== id) }));
  },

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

        const response = await fetch(`${API_BASE_URL}${mutation.endpoint}`, {
          method: mutation.method,
          headers,
          body: mutation.method !== "DELETE" ? mutation.body : undefined,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        // Success — remove from queue
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
  },
}));
