import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";

import { recordCoworkerNote, type RecordNoteResult } from "./coworker-memory";
import {
  distillMemoryNotesFromExperience,
  type MemoryExperienceSource,
} from "./memory-acquisition";
import { advanceThreadCheckpointForThread } from "./thread-checkpoint-runner";

type FindMany<T> = { findMany(args?: unknown): Promise<T[]> };

export type MemoryAcquisitionDb = {
  phaseHandoff: FindMany<PhaseHandoffRow>;
  taskRun: FindMany<TaskRunRow>;
  featureBuild: FindMany<FeatureBuildRow>;
  coworkerMemoryNote: FindMany<{ sourceRef: string | null }>;
  agent: FindMany<{ id: string; agentId: string }>;
  agentThread: FindMany<AgentThreadRow>;
};

export type MemoryAcquisitionResult = {
  experiencesScanned: number;
  notesAttempted: number;
  notesCreated: number;
  notesUpdated: number;
  notesUnchanged: number;
  notesRejected: number;
  skippedAlreadyDistilled: number;
  skippedNoAgent: number;
};

export type ThreadCheckpointSweepResult = {
  threadsChecked: number;
  advanceAttempts: number;
  advanceFailures: number;
};

type PhaseHandoffRow = {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  summary: string;
  decisionsMade: string[];
  openIssues: string[];
  userPreferences: string[];
  createdAt: Date;
};

type TaskRunRow = {
  taskRunId: string;
  title: string;
  status: string;
  currentAgentId: string | null;
  initiatingAgentId: string | null;
  progressPayload: unknown;
  completedAt: Date | null;
};

type FeatureBuildRow = {
  buildId: string;
  title: string;
  phase: string;
  claimedByAgentId: string | null;
  diffSummary: string | null;
  changeNarrative: unknown;
  updatedAt: Date;
};

type AgentThreadRow = {
  id: string;
  contextKey: string;
  updatedAt: Date;
};

type RecordNote = typeof recordCoworkerNote;

const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_EXPERIENCE_TAKE = 100;
const DEFAULT_THREAD_TAKE = 100;
const prismaMemoryDb = prisma as unknown as MemoryAcquisitionDb;

export async function runMemoryAcquisitionSweep(
  db: MemoryAcquisitionDb = prismaMemoryDb,
  opts: {
    now?: Date;
    lookbackDays?: number;
    take?: number;
    recordNote?: RecordNote;
  } = {},
): Promise<MemoryAcquisitionResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000);
  const take = opts.take ?? DEFAULT_EXPERIENCE_TAKE;
  const recordNote = opts.recordNote ?? recordCoworkerNote;
  const result: MemoryAcquisitionResult = {
    experiencesScanned: 0,
    notesAttempted: 0,
    notesCreated: 0,
    notesUpdated: 0,
    notesUnchanged: 0,
    notesRejected: 0,
    skippedAlreadyDistilled: 0,
    skippedNoAgent: 0,
  };

  const experiences = await loadRecentExperiences(db, since, take);
  result.experiencesScanned = experiences.length;

  const existingSourceRefs = await loadExistingSourceRefs(
    db,
    experiences.map((experience) => sourceRefFor(experience)),
  );
  const sourceAgentRefs = [...new Set(experiences.map((experience) => experience.agentId).filter(isNonEmptyString))];
  const agentIds = [...new Set(sourceAgentRefs.flatMap((agentId) => [agentId, resolveCanonicalAgentId(agentId)]))];
  const agents = await db.agent.findMany({
    where: { agentId: { in: agentIds } },
    select: { id: true, agentId: true },
  });
  const agentsByAgentId = new Map(agents.map((agent) => [agent.agentId, agent.id]));
  const agentCuidBySourceRef = new Map(
    sourceAgentRefs.map((agentId) => [
      agentId,
      agentsByAgentId.get(agentId) ?? agentsByAgentId.get(resolveCanonicalAgentId(agentId)) ?? null,
    ]),
  );

  for (const experience of experiences) {
    const sourceRef = sourceRefFor(experience);
    if (existingSourceRefs.has(sourceRef)) {
      result.skippedAlreadyDistilled += 1;
      continue;
    }
    const agentCuid = experience.agentId ? agentCuidBySourceRef.get(experience.agentId) : null;
    if (!agentCuid) {
      result.skippedNoAgent += 1;
      continue;
    }

    for (const candidate of distillMemoryNotesFromExperience(experience)) {
      result.notesAttempted += 1;
      countRecordResult(result, await recordNote({
        agentCuid,
        noteKind: candidate.noteKind,
        noteKey: candidate.noteKey,
        content: candidate.content,
        sourceRef: candidate.sourceRef,
        createdBy: null,
      }));
    }
  }

  return result;
}

export async function runThreadCheckpointSweep(
  db: MemoryAcquisitionDb = prismaMemoryDb,
  opts: {
    now?: Date;
    lookbackDays?: number;
    take?: number;
    advance?: (threadId: string, keepRecentCount: number) => Promise<void>;
  } = {},
): Promise<ThreadCheckpointSweepResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000);
  const threads = await db.agentThread.findMany({
    where: { updatedAt: { gte: since }, cancelledAt: null },
    orderBy: { updatedAt: "desc" },
    take: opts.take ?? DEFAULT_THREAD_TAKE,
    select: { id: true, contextKey: true, updatedAt: true },
  });
  const advance = opts.advance ?? advanceThreadCheckpointForThread;
  const result: ThreadCheckpointSweepResult = {
    threadsChecked: threads.length,
    advanceAttempts: 0,
    advanceFailures: 0,
  };

  for (const thread of threads) {
    try {
      result.advanceAttempts += 1;
      await advance(thread.id, keepRecentCountForThread(thread));
    } catch (err) {
      result.advanceFailures += 1;
      console.warn(`[memory-acquisition] checkpoint advance failed for ${thread.id}:`, err);
    }
  }
  return result;
}

async function loadRecentExperiences(
  db: MemoryAcquisitionDb,
  since: Date,
  take: number,
): Promise<MemoryExperienceSource[]> {
  const [handoffs, tasks, builds] = await Promise.all([
    db.phaseHandoff.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        fromAgentId: true,
        toAgentId: true,
        summary: true,
        decisionsMade: true,
        openIssues: true,
        userPreferences: true,
        createdAt: true,
      },
    }),
    db.taskRun.findMany({
      where: {
        status: { in: ["completed", "failed"] },
        completedAt: { gte: since },
      },
      orderBy: { completedAt: "desc" },
      take,
      select: {
        taskRunId: true,
        title: true,
        status: true,
        currentAgentId: true,
        initiatingAgentId: true,
        progressPayload: true,
        completedAt: true,
      },
    }),
    db.featureBuild.findMany({
      where: {
        phase: { in: ["complete", "failed", "abandoned"] },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        buildId: true,
        title: true,
        phase: true,
        claimedByAgentId: true,
        diffSummary: true,
        changeNarrative: true,
        updatedAt: true,
      },
    }),
  ]);

  return [
    ...handoffs.map(handoffToExperience),
    ...tasks.map(taskToExperience),
    ...builds.map(buildToExperience),
  ];
}

async function loadExistingSourceRefs(
  db: MemoryAcquisitionDb,
  sourceRefs: string[],
): Promise<Set<string>> {
  const uniqueSourceRefs = [...new Set(sourceRefs)];
  if (uniqueSourceRefs.length === 0) return new Set();
  const rows = await db.coworkerMemoryNote.findMany({
    where: { sourceRef: { in: uniqueSourceRefs } },
    select: { sourceRef: true },
  });
  return new Set(rows.map((row) => row.sourceRef).filter(isNonEmptyString));
}

function handoffToExperience(row: PhaseHandoffRow): MemoryExperienceSource {
  return {
    sourceKind: "phase-handoff",
    sourceId: row.id,
    agentId: row.fromAgentId ?? row.toAgentId,
    title: "Phase handoff",
    summary: row.summary,
    decisionsMade: row.decisionsMade,
    openIssues: row.openIssues,
    userPreferences: row.userPreferences,
  };
}

function taskToExperience(row: TaskRunRow): MemoryExperienceSource {
  return {
    sourceKind: "task-run",
    sourceId: row.taskRunId,
    agentId: row.currentAgentId ?? row.initiatingAgentId,
    title: row.title,
    status: row.status,
    summary: summaryFromProgress(row.progressPayload) ?? row.title,
  };
}

function buildToExperience(row: FeatureBuildRow): MemoryExperienceSource {
  const status = row.phase === "complete" ? "completed" : "failed";
  return {
    sourceKind: "build",
    sourceId: row.buildId,
    agentId: row.claimedByAgentId,
    title: row.title,
    status,
    summary: row.diffSummary ?? summaryFromProgress(row.changeNarrative) ?? row.title,
  };
}

function sourceRefFor(source: MemoryExperienceSource): string {
  return `memory-distill:${source.sourceKind}:${source.sourceId}`;
}

function summaryFromProgress(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["summary", "error", "scheduledSummary", "result", "outcome"]) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
  }
  return null;
}

function countRecordResult(result: MemoryAcquisitionResult, recordResult: RecordNoteResult) {
  if (!recordResult.ok) {
    result.notesRejected += 1;
    return;
  }
  if (recordResult.status === "created") result.notesCreated += 1;
  else if (recordResult.status === "updated") result.notesUpdated += 1;
  else result.notesUnchanged += 1;
}

function keepRecentCountForThread(thread: AgentThreadRow): number {
  return /^build:/i.test(thread.contextKey) ? 20 : 8;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
