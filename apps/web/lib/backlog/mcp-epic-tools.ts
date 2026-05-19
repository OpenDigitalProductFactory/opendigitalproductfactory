import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { BACKLOG_SOURCE_VALUES, EPIC_STATUSES } from "@/lib/explore/backlog";

type ToolExecutionContext = {
  agentId?: string;
  routeContext?: string;
  taskRunId?: string;
  threadId?: string;
};

type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
};

type SimilarEpic = {
  epicId: string;
  title: string;
  status: string;
  score: number;
};

type EpicOwner = {
  id: string;
  employeeId: string;
  displayName: string;
  workEmail: string | null;
};

const ACTIVE_EPIC_STATUSES = ["open", "in-progress"] as const;

function optionalString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseEpicStatus(value: unknown): { ok: true; status: string } | { ok: false; result: ToolResult } {
  const status = typeof value === "string" && value.trim() ? value.trim() : "open";
  if (!(EPIC_STATUSES as readonly string[]).includes(status)) {
    return {
      ok: false,
      result: {
        success: false,
        error: "invalid_status",
        message: `status must be one of ${EPIC_STATUSES.join("|")}, got ${status}`,
      },
    };
  }
  return { ok: true, status };
}

function parsePriority(value: unknown): { ok: true; priority?: number } | { ok: false; result: ToolResult } {
  if (value === undefined || value === null || value === "") return { ok: true };
  const priority = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
    return {
      ok: false,
      result: {
        success: false,
        error: "invalid_priority",
        message: "priority must be an integer from 0 to 999",
      },
    };
  }
  return { ok: true, priority };
}

function parseSource(value: unknown): { ok: true; source: string | null } | { ok: false; result: ToolResult } {
  if (typeof value !== "string" || !value.trim()) return { ok: true, source: null };
  const source = value.trim();
  if (!(BACKLOG_SOURCE_VALUES as readonly string[]).includes(source)) {
    return {
      ok: false,
      result: {
        success: false,
        error: "invalid_source",
        message: `source must be one of ${BACKLOG_SOURCE_VALUES.join("|")}, got ${source}`,
      },
    };
  }
  return { ok: true, source };
}

function generateEpicId(): string {
  return `EP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

async function findSimilarActiveEpics(title: string): Promise<SimilarEpic[]> {
  const epics = await prisma.epic.findMany({
    where: { status: { in: [...ACTIVE_EPIC_STATUSES] } },
    take: 100,
    orderBy: [{ updatedAt: "desc" }],
    select: { epicId: true, title: true, status: true },
  });

  return epics
    .map((epic) => ({ ...epic, score: titleSimilarity(title, epic.title) }))
    .filter((epic) => epic.score >= 0.72)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function resolveOwner(owner: string | null): Promise<
  | { ok: true; owner: EpicOwner | null }
  | { ok: false; result: ToolResult }
> {
  if (!owner) return { ok: true, owner: null };
  const employee = await prisma.employeeProfile.findFirst({
    where: {
      OR: [
        { id: owner },
        { employeeId: owner },
        { workEmail: { equals: owner, mode: "insensitive" } },
        { personalEmail: { equals: owner, mode: "insensitive" } },
        { displayName: { equals: owner, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      employeeId: true,
      displayName: true,
      workEmail: true,
    },
  });

  if (!employee) {
    return {
      ok: false,
      result: {
        success: false,
        error: "invalid_owner",
        message: "owner must match an EmployeeProfile id, employeeId, workEmail, personalEmail, or exact displayName",
      },
    };
  }
  return { ok: true, owner: employee };
}

function indexEpicContext(input: {
  epicId: string;
  title: string;
  description?: string | null;
  source?: string | null;
  specPath?: string | null;
  planPath?: string | null;
  rationale?: string | null;
  priority?: number;
  owner?: EpicOwner | null;
}) {
  const content = [
    input.description ?? "",
    input.source ? `source: ${input.source}` : "",
    input.specPath ? `specPath: ${input.specPath}` : "",
    input.planPath ? `planPath: ${input.planPath}` : "",
    input.rationale ? `rationale: ${input.rationale}` : "",
    input.priority !== undefined ? `priority: ${input.priority}` : "",
    input.owner ? `owner: ${input.owner.displayName} (${input.owner.employeeId})` : "",
  ].filter(Boolean).join("\n");
  if (!content.trim()) return;

  import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
    storePlatformKnowledge({
      entityId: input.epicId,
      entityType: "epic",
      title: input.title,
      content,
    })
  ).catch(() => {});
}

function ownerPayload(owner: EpicOwner | null | undefined) {
  if (!owner) return null;
  return {
    employeeId: owner.employeeId,
    displayName: owner.displayName,
    workEmail: owner.workEmail,
  };
}

export async function createEpicTool(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const title = String(params["title"] ?? "").trim();
  if (!title) {
    return { success: false, error: "missing_title", message: "title is required" };
  }

  const requestedEpicId = optionalString(params, "epicId");
  const epicId = requestedEpicId ?? generateEpicId();
  if (!epicId.startsWith("EP-")) {
    return {
      success: false,
      error: "invalid_epicId",
      message: "epicId must use the semantic EP-* format.",
    };
  }

  const statusResult = parseEpicStatus(params["status"]);
  if (!statusResult.ok) return statusResult.result;
  const priorityResult = parsePriority(params["priority"]);
  if (!priorityResult.ok) return priorityResult.result;
  const sourceResult = parseSource(params["source"]);
  if (!sourceResult.ok) return sourceResult.result;
  const ownerResult = await resolveOwner(optionalString(params, "owner"));
  if (!ownerResult.ok) return ownerResult.result;

  const existing = await prisma.epic.findFirst({
    where: { epicId },
    select: { epicId: true, title: true, status: true },
  });
  if (existing) {
    return {
      success: false,
      error: "duplicate_epicId",
      message: `Epic ${epicId} already exists: ${existing.title}`,
      data: { existingEpic: existing },
    };
  }

  const similarEpics = await findSimilarActiveEpics(title);
  const warnings = similarEpics.length > 0
    ? ["A similar active epic already exists; review before linking new backlog work."]
    : [];

  const description = optionalString(params, "description") ?? "";
  const specPath = optionalString(params, "specPath");
  const planPath = optionalString(params, "planPath");
  const rationale = optionalString(params, "rationale");
  const priority = priorityResult.priority;

  const epic = await prisma.epic.create({
    data: {
      epicId,
      title,
      status: statusResult.status,
      submittedById: userId,
      agentId: context?.agentId ?? null,
      ...(description ? { description } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(ownerResult.owner ? { accountableEmployeeId: ownerResult.owner.id } : {}),
      ...(statusResult.status === "done" ? { completedAt: new Date() } : {}),
    },
    include: {
      accountableEmployee: {
        select: {
          employeeId: true,
          displayName: true,
          workEmail: true,
        },
      },
    },
  });

  indexEpicContext({
    epicId: epic.epicId,
    title,
    description,
    source: sourceResult.source,
    specPath,
    planPath,
    rationale,
    priority,
    owner: ownerResult.owner,
  });

  return {
    success: true,
    entityId: epic.epicId,
    message: `Created epic ${epic.epicId}`,
    data: {
      epicId: epic.epicId,
      title: epic.title,
      status: epic.status,
      priority: epic.priority ?? null,
      owner: ownerPayload(ownerResult.owner),
      source: sourceResult.source,
      specPath,
      planPath,
      similarEpics,
      warnings,
    },
  };
}

export async function updateEpicTool(params: Record<string, unknown>): Promise<ToolResult> {
  const epicRaw = String(params["epicId"] ?? "").trim();
  if (!epicRaw) {
    return { success: false, error: "missing_epicId", message: "epicId is required" };
  }

  const existing = await prisma.epic.findFirst({
    where: { OR: [{ epicId: epicRaw }, { id: epicRaw }] },
    select: {
      id: true,
      epicId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      completedAt: true,
    },
  });
  if (!existing) {
    return { success: false, error: "not_found", message: `Epic ${epicRaw} not found` };
  }

  const data: Record<string, unknown> = {};
  if (typeof params["title"] === "string") {
    const title = params["title"].trim();
    if (!title) {
      return { success: false, error: "missing_title", message: "title cannot be blank" };
    }
    data["title"] = title;
  }
  if (typeof params["description"] === "string") {
    const description = params["description"].trim();
    data["description"] = description || null;
  }
  if (typeof params["status"] === "string") {
    const statusResult = parseEpicStatus(params["status"]);
    if (!statusResult.ok) return statusResult.result;
    data["status"] = statusResult.status;
    if (statusResult.status === "done" && existing.status !== "done") {
      data["completedAt"] = new Date();
    }
    if (statusResult.status !== "done" && existing.status === "done") {
      data["completedAt"] = null;
    }
  }
  const priorityResult = parsePriority(params["priority"]);
  if (!priorityResult.ok) return priorityResult.result;
  if (priorityResult.priority !== undefined) {
    data["priority"] = priorityResult.priority;
  }

  const specPath = optionalString(params, "specPath");
  const planPath = optionalString(params, "planPath");
  const rationale = optionalString(params, "rationale");

  const updated = Object.keys(data).length === 0
    ? existing
    : await prisma.epic.update({
        where: { id: existing.id },
        data,
      });

  indexEpicContext({
    epicId: updated.epicId,
    title: updated.title,
    description: typeof data["description"] === "string" ? String(data["description"]) : existing.description,
    specPath,
    planPath,
    rationale,
    priority: priorityResult.priority,
  });

  return {
    success: true,
    entityId: updated.epicId,
    message: Object.keys(data).length === 0
      ? `${updated.epicId} unchanged (no editable fields provided)`
      : `Updated epic ${updated.epicId}`,
    data: {
      epicId: updated.epicId,
      title: updated.title,
      status: updated.status,
      priority: updated.priority ?? null,
      completedAt: updated.completedAt ? updated.completedAt.toISOString() : null,
      specPath,
      planPath,
    },
  };
}
