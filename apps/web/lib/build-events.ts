// apps/web/lib/build-events.ts
// Typed DOM CustomEvent interfaces for Build Studio ↔ Coworker Panel communication.
// Both components are siblings in the DOM (not in the same React tree),
// so cross-component communication uses window-level CustomEvents.

/** BuildStudio → CoworkerPanel: which build is active */
export type BuildActiveDetail = string | null; // buildId or null

/** CoworkerPanel → BuildStudio: relayed SSE event from the agent */
export type BuildProgressDetail = {
  type: string;
  buildId?: string;
  phase?: string;
  field?: string;
  port?: number;
  [key: string]: unknown;
};

/** CoworkerPanel → BuildStudio: threadId is now known for a build */
export type BuildThreadLinkedDetail = {
  buildId: string;
  threadId: string;
};

// Event name constants to avoid typos
export const BUILD_EVENTS = {
  /** BuildStudio dispatches when the active build changes */
  ACTIVE_BUILD: "build-studio-active-build",
  /** CoworkerPanel relays SSE events relevant to build progress */
  PROGRESS_UPDATE: "build-progress-update",
  /** CoworkerPanel notifies BuildStudio of the threadId for a build */
  THREAD_LINKED: "build-thread-linked",
} as const;

// SSE event types that should be relayed from the panel to the page
export const RELAY_EVENT_TYPES = [
  "phase:change",
  "evidence:update",
  "sandbox:ready",
  "orchestrator:task_complete",
  "done",
] as const;
