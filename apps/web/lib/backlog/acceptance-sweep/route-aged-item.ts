// Route an aged awaiting-acceptance item to its coworker (BI-C1781121, slice 3
// of BI-5F3D6A37). Design:
// docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.4.
//
// For each aged item with an owner, oldest first and at most the route limit
// per run, the sweep upserts ONE steward Workroom keyed `acceptance:<itemId>`:
//
// - It names the item through `outcomeAnchor {kind: "backlog-item"}` and never
//   through `backlogItemId`. A live room bound by backlogItemId is live
//   ownership, and the author's own re-claim would be refused
//   (work-capsules/backlog-workroom-ownership.ts). The steward room verifies the
//   work; it does not own it.
// - It declares the acceptance-verification work shape, whose one stage is
//   answered by `role:acceptance-verifier`, and binds that role to the resolved
//   owner (`agent:<id>`). The Workroom drive dispatches that agent through the
//   existing ScheduledAgentTask path and briefs it from the room objective,
//   which this module writes: the item, each owed code with its nextAction, the
//   writes the stage is mandated to make, and the item's acceptance criteria.
// - The room's requester and Process Overseer is the person accountable for
//   the platform's automatic work (portfolio/accountable-owner.ts
//   resolveWorkOwner: the Foundational portfolio's accountable person, then the
//   organization's, then the install's oldest active superuser), which gives
//   the drive its task owner user. That person owns the room; the coworker does
//   the stage. Without one nothing is created and the item is reported
//   `unroutable: no-install-operator`.
//
// The owner is the one the sweep's projection resolved (owed-acceptance.ts over
// the terminal recovery chain, in-platform coworkers only). An item with no
// owner is reported unroutable with its reasons and gets no room. It is never
// routed to a person. A closable item (completion verdict already `allowed`) is
// never routed: nothing is owed, so there is nothing for a coworker to verify,
// and closing it is the operator pre-authorisation's job (acceptance-sweep-close.ts).
// An existing room is never re-created.

import type { Prisma } from "@dpf/db";

import { parseItemBodyAcceptance } from "@/lib/backlog/initiative-readiness/item-body-baseline";
import { readinessLaneForRole } from "@/lib/tak/initiative-readiness-tool-grants";
import {
  ACCEPTANCE_VERIFICATION_SHAPE_REF,
  ACCEPTANCE_VERIFIER_ROLE,
  ACCEPTANCE_VERIFIER_WRITES,
} from "@/lib/work-management/acceptance-verification-shape";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "@/lib/work-management/workroom-shape-claim";

import { EXECUTION_EVIDENCE_WRITER } from "./execution-evidence-owner";
import { ACCEPTANCE_FAMILY_ROLES, type OwedAcceptance, type OwedAcceptanceRequirement } from "./owed-acceptance";

export const ROUTE_OUTCOMES = ["routed", "already-routed", "routed-unresolved", "unroutable", "deferred"] as const;
export type RouteOutcomeKind = (typeof ROUTE_OUTCOMES)[number];

export type AgedRouteCandidate = {
  rowId: string;
  itemId: string;
  title: string;
  body: string | null;
  /** Whole days in awaiting-acceptance (or since creation when no entry row exists). */
  ageDays: number;
  projection: OwedAcceptance;
};

export type RouteOutcome = {
  itemId: string;
  ageDays: number;
  outcome: RouteOutcomeKind;
  capsuleId: string | null;
  ownerAgentId: string | null;
  /** For `unroutable`: the machine-stable reason code(s), comma-separated. */
  reason: string | null;
};

type RoomRow = { capsuleId: string; archivedAt: Date | null; workspaceState: unknown };

/** Exactly the reads and writes routing performs; `prisma` satisfies it. */
export type AcceptanceRouteDb = {
  principal: { findFirst(args: unknown): Promise<{ id: string } | null> };
  workroom: {
    findUnique(args: unknown): Promise<RoomRow | null>;
    upsert(args: unknown): Promise<{ id: string }>;
  };
};

export const NO_INSTALL_OPERATOR = "no-install-operator";

export function acceptanceRoomKey(itemId: string): string {
  return `acceptance:${itemId}`;
}

/** Stable, human-quotable room id: one room per item. */
export function acceptanceRoomCapsuleId(itemId: string): string {
  return `WC-ACC-${itemId.replace(/^BI-/i, "").toUpperCase()}`;
}

const ROOM_OWNER_REASON = "Accountable for the platform's automatic work: owns the acceptance steward room the daily sweep opened for this item.";
const ROOM_VERIFIER_REASON = "Named by the acceptance sweep as the coworker who verifies this item and records its acceptance evidence.";

/**
 * The governed tool that records one owed acceptance-family requirement, or
 * null when none does. The lane map is the readiness resolver's own
 * (readinessLaneForRole); a delivery-coordinator acceptance or delivery check
 * is recorded with record_execution_evidence (shape-lane-escalations.ts,
 * execution-evidence-owner.ts).
 */
export function acceptanceWriterTool(entry: Pick<OwedAcceptanceRequirement, "code" | "accountableRole">): string | null {
  if (!ACCEPTANCE_FAMILY_ROLES.includes(entry.accountableRole)) return null;
  if (entry.accountableRole === "delivery-coordinator") {
    return EXECUTION_EVIDENCE_CODES.includes(entry.code) ? EXECUTION_EVIDENCE_WRITER : null;
  }
  return readinessLaneForRole(entry.accountableRole)?.toolName ?? null;
}

const EXECUTION_EVIDENCE_CODES: readonly string[] = ["ACCEPTANCE_EVIDENCE_REQUIRED", "DELIVERY_EVIDENCE_REQUIRED"];

/**
 * BI-7C7E8CAC: what a runtime check owed to a delivery-coordinator owner looks
 * like as a record_execution_evidence call. A small item is accepted by the
 * runtime check on the live install or the failing-to-passing test
 * (shape-requirements.ts small()); the dimension each kind lands in is
 * readiness-guidance.ts CODES_BY_EVIDENCE_DIMENSION.
 */
function runtimeCheckLines(itemId: string, codes: readonly string[]): string[] {
  const lines = [
    ``,
    `Record the runtime check with record_execution_evidence, itemId ${itemId}, one call per check, with a summary of what you observed:`,
  ];
  if (codes.includes("ACCEPTANCE_EVIDENCE_REQUIRED")) {
    lines.push(`- ACCEPTANCE_EVIDENCE_REQUIRED: kind "manual_check" for the check you ran on the live install (kind "ux_verified" when what changed is visible in the UI).`);
  }
  if (codes.includes("DELIVERY_EVIDENCE_REQUIRED")) {
    lines.push(`- DELIVERY_EVIDENCE_REQUIRED: kind "test_pass" for the failing-to-passing test you ran (with its URL when there is one), or kind "manual_check" for the delivered change observed on the live install.`);
  }
  lines.push(`Where the check fails, record that with kind "test_fail" or "ux_fail" instead. Evidence is all you record: whoever closes the item cites it.`);
  return lines;
}

/** The brief the drive sends the coworker, as the room's objective. */
export function buildAcceptanceRoomObjective(candidate: AgedRouteCandidate): string {
  const { projection } = candidate;
  const ownedCodes = new Set<string>(projection.owner?.codes ?? []);
  const yours = projection.owed.filter((entry) => ownedCodes.has(entry.code));
  const notYours = projection.owed.filter((entry) => !ownedCodes.has(entry.code));
  const unroutable = new Map(projection.unroutable.map((entry) => [entry.code, entry]));
  const criteria = parseItemBodyAcceptance(candidate.body).criteria;
  const lines: string[] = [
    `Verify the acceptance of ${candidate.itemId} "${candidate.title}" on the live install and record the evidence.`,
    `It was delivered and has waited ${candidate.ageDays} days in awaiting-acceptance.`,
    ``,
    `Owed to you, from the item's completion readiness:`,
    ...yours.map((entry) => {
      const tool = acceptanceWriterTool(entry);
      const writable = tool !== null && ACCEPTANCE_VERIFIER_WRITES.includes(tool);
      return `- ${entry.code} (${entry.accountableRole})${writable ? `, recorded with ${tool}` : ""}: ${entry.nextAction ?? "no next action was stated; read the item's readiness with get_backlog_item."}`;
    }),
  ];
  const runtimeChecks = yours
    .filter((entry) => entry.accountableRole === "delivery-coordinator" && acceptanceWriterTool(entry) === EXECUTION_EVIDENCE_WRITER)
    .map((entry) => entry.code);
  if (runtimeChecks.length > 0) lines.push(...runtimeCheckLines(candidate.itemId, runtimeChecks));
  const packetBound = [...new Set(yours
    .map((entry) => acceptanceWriterTool(entry))
    .filter((tool): tool is string => tool !== null && !ACCEPTANCE_VERIFIER_WRITES.includes(tool)))];
  if (packetBound.length > 0) {
    lines.push(
      ``,
      `Its lane writer, ${packetBound.join(" and ")} (objective-mapping), accepts only a server-issued review packet: an external-MCP run bound to the item's delivery Workroom. This scheduled room run does not carry one, so the call is refused; do not call it. `
        + `Record what you verified for these requirements with record_workroom_evidence in this room instead, one line per criterion with what you observed, so the reviewer the packet is issued to can map it.`,
    );
  }
  if (notYours.length > 0) {
    lines.push(``, `Not yours (the sweep reports these; do not record them):`);
    for (const entry of notYours) {
      const reason = unroutable.get(entry.code);
      lines.push(`- ${entry.code} (${entry.accountableRole})${reason ? `: ${reason.reason}. ${reason.nextAction ?? ""}`.trimEnd() : ""}`);
    }
  }
  lines.push(``);
  if (criteria.length > 0) {
    lines.push(`Acceptance criteria from the item body:`, ...criteria.map((criterion) => `- ${criterion}`));
  } else {
    lines.push(`The item body has no acceptance criteria section. Verify against the owed requirements above and say in the evidence that the body states none.`);
  }
  lines.push(
    ``,
    `How to do it: read the item with get_backlog_item ${candidate.itemId}. Check each criterion against the running install, not against the code or the item's own claims.`,
    `Record what you observed with the writes this room is authorized to make: ${ACCEPTANCE_VERIFIER_WRITES.join(" and ")}. `
      + `Use record_execution_evidence for a requirement marked "recorded with record_execution_evidence" above, following its next action, and record_workroom_evidence (kind "acceptance-receipt") in this room for what you verified. No other write is authorized here.`,
    `Record only what you verified. Where a criterion does not hold or cannot be checked, record that instead. Do not change the item's status or close it: the completion gate decides that.`,
  );
  return lines.join("\n");
}

async function humanPrincipalId(db: AcceptanceRouteDb, userId: string): Promise<string | null> {
  const principal = await db.principal.findFirst({
    where: { kind: "human", status: "active", aliases: { some: { aliasType: "user", issuer: "", aliasValue: userId } } },
    select: { id: true },
  } satisfies Prisma.PrincipalFindFirstArgs);
  return principal?.id ?? null;
}

async function agentPrincipalId(db: AcceptanceRouteDb, agentId: string): Promise<string | null> {
  const principal = await db.principal.findFirst({
    where: { kind: "agent", aliases: { some: { aliasType: "agent", issuer: "", aliasValue: agentId } } },
    select: { id: true },
  } satisfies Prisma.PrincipalFindFirstArgs);
  return principal?.id ?? null;
}

/** The operator owns the room (Process Overseer); the coworker is admitted to do the stage. */
function roomParticipants(operatorPrincipalId: string, verifierPrincipalId: string | null): Prisma.WorkroomParticipantUncheckedCreateWithoutWorkroomInput[] {
  const participants: Prisma.WorkroomParticipantUncheckedCreateWithoutWorkroomInput[] = [
    { principalId: operatorPrincipalId, roles: ["coordinator"], assignmentSource: "explicit", enteredReason: ROOM_OWNER_REASON, lifecycle: "active" },
  ];
  if (verifierPrincipalId) {
    participants.push({ principalId: verifierPrincipalId, roles: ["contributor"], assignmentSource: "explicit", enteredReason: ROOM_VERIFIER_REASON, lifecycle: "active" });
  }
  return participants;
}

/** The drive has dispatched this room at least once. */
function roomHasRun(room: RoomRow): boolean {
  const state = room.workspaceState && typeof room.workspaceState === "object" ? room.workspaceState as Record<string, unknown> : null;
  const drive = state?.workroomDrive && typeof state.workroomDrive === "object" ? state.workroomDrive as Record<string, unknown> : null;
  return typeof drive?.taskId === "string" && drive.taskId.length > 0;
}

function unroutableReason(projection: OwedAcceptance): string {
  const reasons = [...new Set(projection.unroutable.map((entry) => entry.reason))];
  return reasons.length > 0 ? reasons.join(", ") : "no-owner";
}

/**
 * Route one run's aged items. Candidates are routed oldest first; a closable
 * item is skipped (nothing is owed). Existing rooms are reported, never
 * re-created, and do not count against `limit`, which bounds rooms CREATED.
 */
export async function routeAgedItems(input: {
  db: AcceptanceRouteDb;
  now: Date;
  candidates: readonly AgedRouteCandidate[];
  limit: number;
  /** The User accountable for the platform's automatic work, or null when none can be resolved. */
  resolveOwnerUserId: () => Promise<string | null>;
}): Promise<RouteOutcome[]> {
  const { db, now } = input;
  const ordered = [...input.candidates]
    .filter((candidate) => !candidate.projection.closable)
    .sort((left, right) => right.ageDays - left.ageDays || (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
  let operator: Promise<string | null> | null = null;
  const operatorPrincipal = async () => {
    const userId = await input.resolveOwnerUserId().catch(() => null);
    return userId ? humanPrincipalId(db, userId) : null;
  };
  let created = 0;
  const outcomes: RouteOutcome[] = [];

  for (const candidate of ordered) {
    const base = { itemId: candidate.itemId, ageDays: candidate.ageDays, capsuleId: null, ownerAgentId: candidate.projection.owner?.agentId ?? null, reason: null };
    const key = acceptanceRoomKey(candidate.itemId);
    const existing = await db.workroom.findUnique({
      where: { idempotencyKey: key },
      select: { capsuleId: true, archivedAt: true, workspaceState: true },
    } satisfies Prisma.WorkroomFindUniqueArgs);
    if (existing) {
      outcomes.push({ ...base, capsuleId: existing.capsuleId, outcome: existing.archivedAt || roomHasRun(existing) ? "routed-unresolved" : "already-routed" });
      continue;
    }
    const owner = candidate.projection.owner;
    if (!owner) {
      outcomes.push({ ...base, outcome: "unroutable", reason: unroutableReason(candidate.projection) });
      continue;
    }
    const operatorPrincipalId = await (operator ??= operatorPrincipal());
    if (!operatorPrincipalId) {
      outcomes.push({ ...base, outcome: "unroutable", reason: NO_INSTALL_OPERATOR });
      continue;
    }
    if (created >= input.limit) {
      outcomes.push({ ...base, outcome: "deferred" });
      continue;
    }
    const capsuleId = acceptanceRoomCapsuleId(candidate.itemId);
    const verifierPrincipalId = await agentPrincipalId(db, owner.agentId);
    await db.workroom.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        capsuleId,
        idempotencyKey: key,
        title: `Acceptance: ${candidate.itemId} ${candidate.title}`.slice(0, 200),
        objective: buildAcceptanceRoomObjective(candidate),
        status: "working",
        source: "scheduled-steward",
        activityKind: "governance",
        decisionScope: "wwmd",
        servedPersona: "Owner of delivered work that has not yet proved its acceptance criteria",
        outcomeAnchor: { kind: "backlog-item", id: candidate.itemId },
        scopeClaims: [
          buildWorkShapeClaim(ACCEPTANCE_VERIFICATION_SHAPE_REF, now),
          buildWorkShapeRoleBindingsClaim({ [ACCEPTANCE_VERIFIER_ROLE]: `agent:${owner.agentId}` }, now),
        ] as Prisma.InputJsonValue,
        requestedByPrincipalId: operatorPrincipalId,
        lastSyncedAt: now,
        participants: { create: roomParticipants(operatorPrincipalId, verifierPrincipalId) },
      },
      select: { id: true },
    } satisfies Prisma.WorkroomUpsertArgs);
    created += 1;
    outcomes.push({ ...base, capsuleId, outcome: "routed" });
  }
  return outcomes;
}
