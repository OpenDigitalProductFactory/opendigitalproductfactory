// EP-CWQ-001: Canonical string enums (CLAUDE.md compliance — hyphens, not underscores)

export const QUEUE_TYPES = ["team", "personal", "triage", "escalation"] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];

export const WORK_ITEM_SOURCE_TYPES = ["task-node", "backlog-item", "approval", "manual-task", "scheduled"] as const;
export type WorkItemSourceType = (typeof WORK_ITEM_SOURCE_TYPES)[number];

export const WORK_ITEM_URGENCIES = ["routine", "priority", "urgent", "emergency"] as const;
export type WorkItemUrgency = (typeof WORK_ITEM_URGENCIES)[number];

export const WORK_ITEM_EFFORT_CLASSES = ["instant", "short", "medium", "long", "physical"] as const;
export type WorkItemEffortClass = (typeof WORK_ITEM_EFFORT_CLASSES)[number];

export const WORK_ITEM_STATUSES = [
  "queued", "assigned", "in-progress", "awaiting-input", "awaiting-approval",
  "completed", "failed", "cancelled", "escalated", "deferred",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_MESSAGE_TYPES = ["comment", "question", "approval-request", "status-update", "escalation", "handoff"] as const;
export type WorkItemMessageType = (typeof WORK_ITEM_MESSAGE_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["in-app", "email", "slack", "sms", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const WORKER_TYPES = ["human", "ai-agent"] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

export interface WorkerConstraint {
  workerType: "human" | "ai-agent" | "either" | "team";
  requiredCapabilities?: string[];
  requiredRole?: string;
  requiredAgentId?: string;
  excludeWorkers?: string[];
  preferredWorkerIds?: string[];
  sensitivityLevel?: "public" | "internal" | "confidential" | "restricted";
}

export interface RoutingPolicy {
  mode: "auto" | "manual" | "round-robin" | "capability-match" | "load-balanced";
  considerAvailability: boolean;
  considerPerformance: boolean;
  maxConcurrentPerWorker: number;
  autoEscalateAfterMinutes?: number;
  escalationQueueId?: string;
}

export interface RoutingDecision {
  teamId?: string;
  candidateCount: number;
  selectedWorkerId: string;
  selectedWorkerType: WorkerType;
  score: number;
  reason: string;
  timestamp: string;
}
