// ─── Shared Backlog-Ingest Front Door ───────────────────────────────────────
// One path every detector / queue files portal-dev work through, so work lands
// in the backlog (BacklogItem) the instant it is detected — no manual promotion
// step, no parallel queue. Generalizes the process-observer-triage pattern
// (pure builder + dedup + injectable deps) and gives it three-layer provenance.
//
// Provenance (per EA review): typed back-link (set by the caller on its own
// origin row), a BacklogItemActivity(kind="intake_origin") audit row written
// here, and a body marker as a no-migration compatibility bridge.
//
// See docs/superpowers/specs/2026-06-06-work-intake-unification-design.md
// (EP-INTAKE-UNIFY, BI-2BB06F90).

import { randomUUID } from "crypto";

import { prisma as defaultPrisma } from "@dpf/db";

import {
  BACKLOG_SOURCE_VALUES,
  BACKLOG_SCOPE_KIND_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  type BacklogWorkType,
  type BacklogSource,
  type BacklogTriageOutcome,
  type BacklogEffortSize,
  type BacklogScopeKind,
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
  /** Advisory suggestion for triage (non-binding). */
  proposedOutcome?: BacklogTriageOutcome;
  effortSize?: BacklogEffortSize;
  priority?: number;
  /** Semantic (EP-…) or cuid epic id; resolved to the FK in the orchestrator. */
  epicId?: string;
  digitalProductId?: string | null;
  taxonomyNodeId?: string | null;
  submittedById?: string | null;
  agentId?: string | null;
  /** Explicit full item id (e.g. BI-PORT-005). Generated when omitted. */
  itemId?: string;
  /** Item-id prefix used when no explicit itemId, e.g. "IMP" → BI-IMP-XXXXXXXX. */
  itemIdPrefix?: string;
  /** Provenance back-link to the origin record (e.g. {kind:"improvement", id:"IP-6F240"}). */
  origin?: { kind: string; id: string };
  /** Roadmap/budget scope: platform/common/archetype-specific/multi-archetype. */
  scopeKind?: BacklogScopeKind | null;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string | null;
  lifecycleTags?: string[];
}

export interface BacklogIngestResult {
  /** Semantic item id (BI-…). */
  itemId: string;
  /** Internal cuid (BacklogItem.id) — useful for FK writes by callers. */
  id: string;
  /** false = matched an existing non-terminal item (deduped, occurrence bumped). */
  created: boolean;
}

/**
 * Minimal structural view of the stores the front door touches. Lets tests
 * inject a fake without standing up a Prisma client.
 */
export interface IngestBacklogStore {
  backlogItem: {
    findFirst(args: unknown): Promise<{ id: string; itemId: string } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ id: string; itemId: string }>;
  };
  backlogItemActivity: {
    create(args: unknown): Promise<unknown>;
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
 * Validate an ingest request against the canonical enums and the same
 * status/triageOutcome pairing rules create_backlog_item enforces. Returns an
 * error message, or null when valid. Single validation authority for both the
 * MCP boundary and queue callers (EA review: no duplicated validation path).
 */
export function validateIngestInput(input: {
  workType?: string;
  source?: string;
  status?: string;
  triageOutcome?: string | null;
  effortSize?: string | null;
  scopeKind?: string | null;
}): string | null {
  if (!input.workType || !(BACKLOG_WORK_TYPE_VALUES as readonly string[]).includes(input.workType)) {
    return `workType is required (one of: ${BACKLOG_WORK_TYPE_VALUES.join(" | ")}).`;
  }
  if (!input.source || !(BACKLOG_SOURCE_VALUES as readonly string[]).includes(input.source)) {
    return `source must be one of: ${BACKLOG_SOURCE_VALUES.join(" | ")}.`;
  }
  const status = input.status ?? "triaging";
  const triageOutcome = input.triageOutcome ?? null;
  if (status !== "triaging" && !triageOutcome) {
    return "triageOutcome is required when status is not 'triaging'.";
  }
  if (status === "triaging" && triageOutcome) {
    return "triageOutcome must not be set when status='triaging'.";
  }
  if (triageOutcome === "build" && !input.effortSize) {
    return "effortSize is required when triageOutcome='build'.";
  }
  if (input.scopeKind && !(BACKLOG_SCOPE_KIND_VALUES as readonly string[]).includes(input.scopeKind)) {
    return `scopeKind must be one of: ${BACKLOG_SCOPE_KIND_VALUES.join(" | ")}.`;
  }
  return null;
}

function cleanStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
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
 * File (or dedupe) a BacklogItem for portal-dev work. Every detector/queue and
 * create_backlog_item route through here so the backlog is the single source of
 * truth for the work while the origin record stays the evidence.
 *
 * Throws on invalid input (the canonical validation authority). The MCP boundary
 * (create_backlog_item) catches and maps to its structured {success:false}; queue
 * callers may let it throw.
 *
 * Dedup: when `origin` is supplied and a non-terminal item already carries its
 * marker, the existing item's occurrenceCount is bumped, an intake_origin
 * activity row is appended, and no duplicate is created.
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

  const validationError = validateIngestInput({
    workType: input.workType,
    source: input.source,
    status,
    triageOutcome,
    effortSize,
    scopeKind: input.scopeKind ?? null,
  });
  if (validationError) {
    throw new Error(`[backlog-ingest] ${validationError}`);
  }

  const marker = input.origin ? backlogOriginMarker(input.origin.kind, input.origin.id) : null;

  // Provenance audit row (canonical record; the body marker is only a bridge).
  const writeOriginActivity = async (backlogCuid: string, created: boolean): Promise<void> => {
    if (!input.origin) return;
    await store.backlogItemActivity.create({
      data: {
        backlogItemId: backlogCuid,
        kind: "intake_origin",
        summary: created
          ? `Filed from ${input.origin.kind} ${input.origin.id}`
          : `Recurrence from ${input.origin.kind} ${input.origin.id}`,
        payload: { origin: input.origin, created, createdBy: "backlog-ingest" },
        ...(input.submittedById ? { recordedById: input.submittedById } : {}),
        ...(input.agentId ? { recordedByAgentId: input.agentId } : {}),
      },
    });
  };

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
      await writeOriginActivity(existing.id, false);
      return { itemId: existing.itemId, id: existing.id, created: false };
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

  const itemId = input.itemId?.trim() || generateBacklogItemId(input.itemIdPrefix);
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
      ...(input.proposedOutcome ? { proposedOutcome: input.proposedOutcome } : {}),
      ...(effortSize ? { effortSize } : {}),
      ...(typeof input.priority === "number" ? { priority: input.priority } : {}),
      ...(epicCuid ? { epicId: epicCuid } : {}),
      ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      ...(input.taxonomyNodeId ? { taxonomyNodeId: input.taxonomyNodeId } : {}),
      ...(input.submittedById ? { submittedById: input.submittedById } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.scopeKind ? { scopeKind: input.scopeKind } : {}),
      ...(input.archetypeCategories ? { archetypeCategories: cleanStringArray(input.archetypeCategories) } : {}),
      ...(input.archetypeIds ? { archetypeIds: cleanStringArray(input.archetypeIds) } : {}),
      ...(input.scopeRationale && input.scopeRationale.trim() ? { scopeRationale: input.scopeRationale.trim() } : {}),
      ...(input.lifecycleTags ? { lifecycleTags: cleanStringArray(input.lifecycleTags) } : {}),
    },
  });

  await writeOriginActivity(item.id, true);
  indexKnowledge({ entityId: item.itemId, title: input.title, content: input.body ?? "" });

  return { itemId: item.itemId, id: item.id, created: true };
}
