// ─── Shared Backlog-Ingest Front Door ───────────────────────────────────────
// One path every detector / queue files portal-dev work through, so work lands
// in the backlog (BacklogItem) the instant it is detected — no manual promotion
// step, no parallel queue. Generalizes the process-observer-triage pattern
// (pure builder + dedup + injectable deps) and gives it an origin back-link.
//
// See docs/superpowers/specs/2026-06-06-work-intake-unification-design.md
// (EP-INTAKE-UNIFY, BI-2BB06F90).

import { randomUUID } from "crypto";

import { prisma as defaultPrisma } from "@dpf/db";

import type {
  BacklogWorkType,
  BacklogSource,
  BacklogTriageOutcome,
  BacklogEffortSize,
} from "@/lib/explore/backlog";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BacklogIngestInput {
  title: string;
  body?: string | null;
  /** The WHAT (closed enum) — required on every item per the workType spec. */
  workType: BacklogWorkType;
  /** The ORIGIN (closed enum) — how the work arrived. */
  source: BacklogSource;
  /** Ownership axis. Defaults to "portfolio" (platform-level work). */
  type?: "product" | "portfolio";
  /** Lifecycle status. Defaults to "triaging" so the item enters normal triage. */
  status?: "triaging" | "open" | "in-progress";
  triageOutcome?: BacklogTriageOutcome;
  effortSize?: BacklogEffortSize;
  priority?: number;
  /** Semantic (EP-…) or cuid epic id; resolved to the FK in the orchestrator. */
  epicId?: string;
  digitalProductId?: string | null;
  taxonomyNodeId?: string | null;
  submittedById?: string | null;
  agentId?: string | null;
  /** Optional itemId prefix, e.g. "IMP" → BI-IMP-XXXXXXXX. */
  itemIdPrefix?: string;
  /** Provenance back-link to the origin record (e.g. {kind:"improvement", id:"IP-6F240"}). */
  origin?: { kind: string; id: string };
}

export interface BacklogIngestResult {
  itemId: string;
  /** false = matched an existing non-terminal item (deduped, occurrence bumped). */
  created: boolean;
}

/**
 * Minimal structural view of the BacklogItem/Epic stores the front door touches.
 * Lets tests inject a fake without standing up a Prisma client.
 */
export interface IngestBacklogStore {
  backlogItem: {
    findFirst(args: unknown): Promise<{ id: string; itemId: string } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ itemId: string }>;
  };
  epic: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}

export interface BacklogIngestDeps {
  store?: IngestBacklogStore;
  /** Override knowledge indexing (default: fire-and-forget semantic-memory store). */
  indexKnowledge?: (args: { entityId: string; title: string; content: string }) => void;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Stable, queryable, human-readable provenance marker embedded in the body. */
export function backlogOriginMarker(kind: string, id: string): string {
  return `[origin:${kind}:${id}]`;
}

export function generateBacklogItemId(prefix?: string): string {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const trimmed = prefix?.trim();
  return trimmed ? `BI-${trimmed.toUpperCase()}-${suffix}` : `BI-${suffix}`;
}

/** Append the marker on its own line, idempotently (never double-appends). */
export function composeIngestBody(
  body: string | null | undefined,
  marker: string | null,
): string | null {
  const base = typeof body === "string" && body.trim() ? body.trimEnd() : null;
  if (!marker) return base;
  if (base && base.includes(marker)) return base;
  return base ? `${base}\n\n${marker}` : marker;
}

/**
 * Map an ImprovementProposal category to a backlog workType. Mirrors the
 * create_backlog_item required-field contract so auto-filed items are never
 * workType-less (the historical prioritizeImprovement defect).
 */
export function improvementCategoryToWorkType(
  category: string | null | undefined,
): BacklogWorkType {
  const c = (category ?? "").toLowerCase();
  if (c === "skill") return "skill";
  if (c.includes("bug") || c.includes("defect") || c.includes("error") || c.includes("broken")) {
    return "bug";
  }
  if (c.includes("doc")) return "doc";
  if (c.includes("tool")) return "tool";
  if (c.includes("refactor") || c.includes("debt") || c.includes("cleanup")) return "refactor";
  if (c.includes("chore")) return "chore";
  return "feature";
}

/**
 * Enforce the same status/triageOutcome pairing rules as create_backlog_item.
 * Returns an error message, or null when valid.
 */
export function validateIngestStatus(
  status: string,
  triageOutcome: string | null,
  effortSize: string | null,
): string | null {
  if (status !== "triaging" && !triageOutcome) {
    return "triageOutcome is required when status is not 'triaging'";
  }
  if (status === "triaging" && triageOutcome) {
    return "triageOutcome must not be set when status='triaging'";
  }
  if (triageOutcome === "build" && !effortSize) {
    return "effortSize is required when triageOutcome='build'";
  }
  return null;
}

// ─── Default knowledge indexing (fire-and-forget) ─────────────────────────────

function defaultIndexKnowledge(args: { entityId: string; title: string; content: string }): void {
  import("@/lib/semantic-memory")
    .then(({ storePlatformKnowledge }) =>
      storePlatformKnowledge({
        entityId: args.entityId,
        entityType: "backlog",
        title: args.title,
        content: args.content,
      }),
    )
    .catch(() => {});
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * File (or dedupe) a BacklogItem for portal-dev work. Every detector/queue
 * routes through here so the backlog is the single source of truth for the work
 * while the origin record stays the evidence.
 *
 * Dedup: when `origin` is supplied and a non-terminal item already carries its
 * marker, the existing item's occurrenceCount is bumped and no duplicate is
 * created — so a recurring signal touches one item.
 */
export async function ingestBacklogItem(
  input: BacklogIngestInput,
  deps: BacklogIngestDeps = {},
): Promise<BacklogIngestResult> {
  const store = deps.store ?? (defaultPrisma as unknown as IngestBacklogStore);
  const indexKnowledge = deps.indexKnowledge ?? defaultIndexKnowledge;

  const status = input.status ?? "triaging";
  const triageOutcome = input.triageOutcome ?? null;
  const effortSize = input.effortSize ?? null;

  const validationError = validateIngestStatus(status, triageOutcome, effortSize);
  if (validationError) {
    throw new Error(`[backlog-ingest] ${validationError}`);
  }

  const marker = input.origin ? backlogOriginMarker(input.origin.kind, input.origin.id) : null;

  // Dedup by origin marker against non-terminal items.
  if (marker) {
    const existing = await store.backlogItem.findFirst({
      where: { body: { contains: marker }, status: { notIn: ["done", "deferred"] } },
      select: { id: true, itemId: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      await store.backlogItem.update({
        where: { id: existing.id },
        data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date() },
      });
      return { itemId: existing.itemId, created: false };
    }
  }

  // Resolve epic semantic id → cuid FK.
  let epicCuid: string | null = null;
  if (input.epicId && input.epicId.trim()) {
    const raw = input.epicId.trim();
    const epicRow = await store.epic.findFirst({
      where: { OR: [{ epicId: raw }, { id: raw }] },
      select: { id: true },
    });
    epicCuid = epicRow?.id ?? null;
  }

  const itemId = generateBacklogItemId(input.itemIdPrefix);
  const body = composeIngestBody(input.body, marker);

  const item = await store.backlogItem.create({
    data: {
      itemId,
      title: input.title || "Untitled",
      type: input.type ?? "portfolio",
      status,
      workType: input.workType,
      source: input.source,
      lastSeenAt: new Date(),
      ...(body !== null ? { body } : {}),
      ...(triageOutcome ? { triageOutcome } : {}),
      ...(effortSize ? { effortSize } : {}),
      ...(typeof input.priority === "number" ? { priority: input.priority } : {}),
      ...(epicCuid ? { epicId: epicCuid } : {}),
      ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      ...(input.taxonomyNodeId ? { taxonomyNodeId: input.taxonomyNodeId } : {}),
      ...(input.submittedById ? { submittedById: input.submittedById } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    },
  });

  indexKnowledge({ entityId: item.itemId, title: input.title, content: input.body ?? "" });

  return { itemId: item.itemId, created: true };
}
