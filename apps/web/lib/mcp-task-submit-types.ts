// Remote coworker task-submit contract types: the auth, outcome and stored-row
// shapes the task submitter (lib/mcp-task-submit.ts) shares with its
// execution, recovery, capacity-resume and attempt-state modules
// (RemoteTaskSubmitAuth, RemoteTaskSubmitOutcome, ExistingRemoteTask).
//
// Types only, and a leaf: it imports one type from lib/mcp/tool-tier, which
// does not import back into the submitter. The types used to live in the
// submitter itself, which made every collaborator's `import type` an edge back
// into apps/web's largest import cycle; TypeScript project references need
// that graph acyclic (dependency-diet plan, M11 step 2). The guard
// scripts/check-no-web-import-cycle-growth.mjs ratchets that cycle.

import type { McpAuthSource } from "@/lib/mcp/tool-tier";

export type RemoteTaskSubmitAuth = {
  tokenId: string;
  userId: string;
  capability: "read" | "write";
  source: McpAuthSource;
};

export type RemoteTaskSubmitOutcome =
  | { kind: "invalid_params"; message: string }
  | { kind: "result"; result: Record<string, unknown> };

export type ExistingRemoteTask = {
  id: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  contextId: string | null;
  status: string;
  progressPayload: unknown;
  a2aMetadata: unknown;
  lastHeartbeatAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};
