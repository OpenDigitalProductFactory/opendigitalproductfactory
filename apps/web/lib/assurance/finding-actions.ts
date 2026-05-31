import { randomUUID } from "node:crypto";
import type { Prisma } from "@dpf/db";
import { ASSURANCE_FINDING_STATUSES, type AssuranceFindingStatus } from "./types";

export const REMEDIATION_TERMINAL_STATUSES: AssuranceFindingStatus[] = [
  "resolved",
  "false-positive",
];

export interface FindingRemediationEvent {
  at: string;
  status: AssuranceFindingStatus;
  reason?: string;
  byUserId?: string | null;
  backlogItemId?: string;
}

type AssuranceFindingRow = {
  id: string;
  findingKey: string;
  title: string;
  status: string;
  policySeverity: string;
  buildId: string | null;
  digitalProductId: string | null;
  bomComponentId: string | null;
  vendorIdentifier: string;
  evidence: Prisma.JsonValue;
};

type FindingActionsDb = {
  assuranceFinding: {
    findUnique(args: unknown): Promise<null | AssuranceFindingRow>;
    update(args: unknown): Promise<{ id: string }>;
  };
};

function readRemediationEvents(evidence: Prisma.JsonValue): FindingRemediationEvent[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const remediation = (evidence as Record<string, unknown>).remediation;
  return Array.isArray(remediation) ? (remediation as FindingRemediationEvent[]) : [];
}

function mergeEvidence(
  evidence: Prisma.JsonValue,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base = (evidence && typeof evidence === "object" && !Array.isArray(evidence))
    ? { ...(evidence as Record<string, unknown>) }
    : {};
  return { ...base, ...patch } as Prisma.InputJsonValue;
}

export interface UpdateFindingStatusInput {
  findingKey: string;
  status: AssuranceFindingStatus;
  reason?: string;
  userId?: string | null;
  now: Date;
}

export interface UpdateFindingStatusResult {
  findingKey: string;
  previousStatus: string;
  status: AssuranceFindingStatus;
}

export async function updateAssuranceFindingStatus(
  db: FindingActionsDb,
  input: UpdateFindingStatusInput,
): Promise<UpdateFindingStatusResult> {
  if (!ASSURANCE_FINDING_STATUSES.includes(input.status)) {
    throw new Error(`Invalid assurance finding status: ${input.status}`);
  }

  const existing = await db.assuranceFinding.findUnique({
    where: { findingKey: input.findingKey },
    select: {
      id: true,
      findingKey: true,
      title: true,
      status: true,
      policySeverity: true,
      buildId: true,
      digitalProductId: true,
      bomComponentId: true,
      vendorIdentifier: true,
      evidence: true,
    },
  });

  if (!existing) {
    throw new Error(`Assurance finding not found: ${input.findingKey}`);
  }

  const remediationEvents = readRemediationEvents(existing.evidence);
  const newEvent: FindingRemediationEvent = {
    at: input.now.toISOString(),
    status: input.status,
    reason: input.reason,
    byUserId: input.userId ?? null,
  };

  const isTerminal = REMEDIATION_TERMINAL_STATUSES.includes(input.status);

  await db.assuranceFinding.update({
    where: { findingKey: input.findingKey },
    data: {
      status: input.status,
      resolvedAt: isTerminal ? input.now : null,
      ownerUserId: input.userId ?? null,
      evidence: mergeEvidence(existing.evidence, {
        remediation: [...remediationEvents, newEvent],
      }),
    },
  });

  return {
    findingKey: input.findingKey,
    previousStatus: existing.status,
    status: input.status,
  };
}

type EpicLookupDb = {
  epic?: {
    findFirst(args: unknown): Promise<null | { id: string; epicId: string; status: string }>;
    update?(args: unknown): Promise<unknown>;
  };
};

type BacklogCreateDb = {
  backlogItem: {
    create(args: unknown): Promise<{ id: string; itemId: string }>;
  };
};

export type CreateBacklogFromFindingDb = FindingActionsDb & EpicLookupDb & BacklogCreateDb;

export interface CreateBacklogFromFindingInput {
  findingKey: string;
  userId?: string | null;
  now: Date;
  epicId?: string;
}

export interface CreateBacklogFromFindingResult {
  findingKey: string;
  backlogItemId: string;
  epicCuid: string | null;
  alreadyLinked: boolean;
}

function findingHasBacklog(evidence: Prisma.JsonValue): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const value = (evidence as Record<string, unknown>).backlogItemId;
  return typeof value === "string" && value ? value : null;
}

function severityLabel(severity: string): string {
  return severity ? severity.toUpperCase() : "UNKNOWN";
}

export async function createBacklogItemFromFinding(
  db: CreateBacklogFromFindingDb,
  input: CreateBacklogFromFindingInput,
): Promise<CreateBacklogFromFindingResult> {
  const existing = await db.assuranceFinding.findUnique({
    where: { findingKey: input.findingKey },
    select: {
      id: true,
      findingKey: true,
      title: true,
      status: true,
      policySeverity: true,
      buildId: true,
      digitalProductId: true,
      bomComponentId: true,
      vendorIdentifier: true,
      evidence: true,
    },
  });

  if (!existing) {
    throw new Error(`Assurance finding not found: ${input.findingKey}`);
  }

  const existingBacklog = findingHasBacklog(existing.evidence);
  if (existingBacklog) {
    return {
      findingKey: input.findingKey,
      backlogItemId: existingBacklog,
      epicCuid: null,
      alreadyLinked: true,
    };
  }

  const epicId = input.epicId ?? "EP-ASSURANCE-LEDGER";
  const epic = await db.epic?.findFirst({
    where: { epicId },
    select: { id: true, epicId: true, status: true },
  });

  const body = [
    `Auto-filed from assurance finding ${existing.findingKey} (${existing.vendorIdentifier}).`,
    "",
    `Severity: ${severityLabel(existing.policySeverity)}`,
    existing.buildId ? `Build: ${existing.buildId}` : null,
    existing.digitalProductId ? `Product: ${existing.digitalProductId}` : null,
    "",
    "Generated by `createBacklogItemFromFinding`. Link back via finding evidence.",
  ].filter(Boolean).join("\n");

  const item = await db.backlogItem.create({
    data: {
      itemId: `BI-${randomUUID()}`,
      type: "product",
      title: `Remediate: ${existing.title}`.slice(0, 180),
      body,
      status: "triaging",
      source: "automated-detection",
      // Assurance/supply-chain findings are bug-class remediation work.
      workType: "bug",
      proposedOutcome: "build",
      effortSize: "medium",
      epicId: epic?.id ?? null,
      digitalProductId: existing.digitalProductId,
    } satisfies Prisma.BacklogItemUncheckedCreateInput,
    select: { id: true, itemId: true },
  });

  if (epic && epic.status === "done" && db.epic?.update) {
    await db.epic.update({
      where: { id: epic.id },
      data: { status: "open" },
    });
  }

  const remediationEvents = readRemediationEvents(existing.evidence);
  const newEvent: FindingRemediationEvent = {
    at: input.now.toISOString(),
    status: "planned",
    reason: `Linked to backlog item ${item.itemId}`,
    byUserId: input.userId ?? null,
    backlogItemId: item.itemId,
  };

  await db.assuranceFinding.update({
    where: { findingKey: input.findingKey },
    data: {
      status: "planned",
      ownerUserId: input.userId ?? null,
      evidence: mergeEvidence(existing.evidence, {
        backlogItemId: item.itemId,
        remediation: [...remediationEvents, newEvent],
      }),
    },
  });

  return {
    findingKey: input.findingKey,
    backlogItemId: item.itemId,
    epicCuid: epic?.id ?? null,
    alreadyLinked: false,
  };
}
