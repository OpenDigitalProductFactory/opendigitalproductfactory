// BI-AA47C672 — the platform's own reviewer takes a merged break-fix's owed
// post-implementation review when no author client can carry it. Routing opens
// one review room bound to an eligible in-platform reviewer; the writer admits
// that room's run only for the platform-issued packet readiness still issues.
import { describe, expect, it, vi } from "vitest";

import { ok, err } from "@/lib/shared/action-result";
import { PLATFORM_REVIEW_SHAPE_REF } from "@/lib/work-management/platform-review-shape";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "@/lib/work-management/workroom-shape-claim";

import {
  PLATFORM_REVIEW_ISSUER_ID,
  PLATFORM_REVIEW_PACKET_KIND,
  loadPlatformReviewRunAuthority,
  platformReviewDriveTaskId,
  platformReviewRoomCapsuleId,
  routeReviewToPlatformReviewer,
  type PlatformReviewRouteDb,
} from "./platform-review-room";

const NOW = new Date("2026-10-28T09:00:00.000Z");
const ITEM = "BI-0B2C3F6D";
const REVIEWER = "AGT-WS-REVIEW";
const issuer = { userId: "user-admin", agentId: null };
const repo = "OpenDigitalProductFactory/opendigitalproductfactory";

function packet(over: { targetAgent?: string; gate?: string; itemId?: string } = {}) {
  return {
    targetAgent: over.targetAgent ?? REVIEWER,
    objective: "Review the merged repair.",
    questionPacketSummary: `Post-implementation review of ${ITEM}`,
    requestKey: `initiative-readiness:${ITEM}:post-implementation-review:${"a".repeat(40)}`,
    tier: 2,
    enteredVia: "handoff",
    requiredToolNames: ["read_source_at_version", "record_initiative_post_implementation_review"],
    initiativeReviewBinding: {
      writerToolName: over.gate === "plan-review" ? "record_initiative_design_review" : "record_initiative_post_implementation_review",
      itemId: over.itemId ?? ITEM,
      gate: over.gate ?? "post-implementation-review",
      workroomRef: { kind: "workroom-head", workroomId: "WC-DELIVERY", repositoryFullName: repo, branchName: "fix/x", headSha: "2".repeat(40) },
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: repo, commitSha: "3".repeat(40), path: "apps/web/x.ts", providerBlobId: "4".repeat(40) },
    },
  };
}

type Agent = { agentId: string; executionConfig: { executionType: string } | null; toolGrants: Array<{ grantKey: string }> };

function routeDb(options: { agent?: Agent | null; room?: Awaited<ReturnType<PlatformReviewRouteDb["workroom"]["findUnique"]>>; newest?: unknown } = {}) {
  const agent: Agent | null = options.agent === undefined
    ? { agentId: REVIEWER, executionConfig: { executionType: "in_process" }, toolGrants: [{ grantKey: "initiative_design_review" }] }
    : options.agent;
  const db = {
    agent: { findFirst: vi.fn(async () => agent) },
    principal: { findFirst: vi.fn(async (args: { where: { kind: string } }) => ({ id: args.where.kind === "human" ? "P-OWNER" : "P-REVIEWER" })) },
    workroom: {
      findUnique: vi.fn(async () => options.room ?? null),
      upsert: vi.fn(async () => ({ id: "room-1", capsuleId: platformReviewRoomCapsuleId(ITEM), status: "working", archivedAt: null, scopeClaims: [] })),
      update: vi.fn(async () => ({})),
    },
    workroomActivity: {
      findFirst: vi.fn(async () => (options.newest === undefined ? null : { payload: options.newest })),
      create: vi.fn(async () => ({ id: "act-1" })),
    },
  };
  return db;
}

function routeDeps(db: ReturnType<typeof routeDb>, actors: string[] = ["AGT-EXT-GROK"]) {
  return { db: db as unknown as PlatformReviewRouteDb, loadDeliveryActorIds: vi.fn(async () => ok(actors)), resolveOwnerUserId: vi.fn(async () => "user-owner") };
}

describe("routing an owed review to the platform reviewer (BI-AA47C672)", () => {
  it("opens one review room bound to the packet's in-platform reviewer and issues it the packet as the platform", async () => {
    const db = routeDb();
    const outcome = await routeReviewToPlatformReviewer({ deps: routeDeps(db), itemId: ITEM, requestCoworker: packet(), issuer, now: NOW });
    expect(outcome).toEqual({ kind: "routed", capsuleId: "WC-PIR-0B2C3F6D", targetAgent: REVIEWER, issued: "issued" });
    const create = (db.workroom.upsert.mock.calls[0] as unknown as [{ where: unknown; create: Record<string, unknown> }])[0];
    expect(create.where).toEqual({ idempotencyKey: `platform-review:${ITEM}` });
    expect(create.create).toEqual(expect.objectContaining({
      capsuleId: "WC-PIR-0B2C3F6D", status: "working", source: "scheduled-steward",
      outcomeAnchor: { kind: "backlog-item", id: ITEM }, requestedByPrincipalId: "P-OWNER",
      scopeClaims: [buildWorkShapeClaim(PLATFORM_REVIEW_SHAPE_REF, NOW), buildWorkShapeRoleBindingsClaim({ "post-implementation-reviewer": `agent:${REVIEWER}` }, NOW)],
    }));
    // Never a delivery room: the item is named only through the outcome anchor.
    expect(create.create).not.toHaveProperty("backlogItemId");
    expect(db.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "room-1", kind: PLATFORM_REVIEW_PACKET_KIND, recordedByAgentId: PLATFORM_REVIEW_ISSUER_ID,
      payload: { itemId: ITEM, requestCoworker: packet(), issuer },
    }) });
  });

  it("does not re-issue an unchanged packet", async () => {
    const room = { id: "room-1", capsuleId: "WC-PIR-0B2C3F6D", status: "working", archivedAt: null,
      scopeClaims: [buildWorkShapeRoleBindingsClaim({ "post-implementation-reviewer": `agent:${REVIEWER}` }, NOW)] };
    const db = routeDb({ room, newest: { itemId: ITEM, requestCoworker: packet(), issuer } });
    await expect(routeReviewToPlatformReviewer({ deps: routeDeps(db), itemId: ITEM, requestCoworker: packet(), issuer, now: NOW }))
      .resolves.toEqual(expect.objectContaining({ kind: "routed", issued: "current" }));
    expect(db.workroom.upsert).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("leaves any other review to its author", async () => {
    const db = routeDb();
    await expect(routeReviewToPlatformReviewer({ deps: routeDeps(db), itemId: ITEM, requestCoworker: packet({ gate: "plan-review" }), issuer, now: NOW }))
      .resolves.toEqual({ kind: "not-applicable" });
    expect(db.workroom.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["runs only outside the platform", { agentId: REVIEWER, executionConfig: { executionType: "external_cli" }, toolGrants: [{ grantKey: "initiative_design_review" }] }, [], /runs only outside the platform/],
    ["lacks the lane grant", { agentId: REVIEWER, executionConfig: { executionType: "in_process" }, toolGrants: [] }, [], /does not hold initiative_design_review/],
    ["is not an active coworker", null, [], /is not an active coworker/],
    ["delivered the item", undefined, [REVIEWER], /delivered BI-0B2C3F6D/],
  ] as const)("names what is missing when the reviewer %s", async (_case, agent, actors, detail) => {
    const db = routeDb({ agent: agent as Agent | null | undefined });
    const outcome = await routeReviewToPlatformReviewer({ deps: routeDeps(db, [...actors]), itemId: ITEM, requestCoworker: packet(), issuer, now: NOW });
    expect(outcome).toEqual({ kind: "ineligible", detail: expect.stringMatching(detail) });
    expect(db.workroom.upsert).not.toHaveBeenCalled();
  });

  it("opens nothing when no person owns the platform's automatic work", async () => {
    const db = routeDb();
    const deps = { ...routeDeps(db), resolveOwnerUserId: vi.fn(async () => null) };
    await expect(routeReviewToPlatformReviewer({ deps, itemId: ITEM, requestCoworker: packet(), issuer, now: NOW }))
      .resolves.toEqual({ kind: "ineligible", detail: expect.stringMatching(/accountable/) });
    expect(db.workroom.upsert).not.toHaveBeenCalled();
  });
});

// ── writer authority ────────────────────────────────────────────────────────

const RUN_ID = "TR-SCHED-PIR00001";
function run(over: Record<string, unknown> = {}) {
  return {
    taskRunId: RUN_ID, userId: "user-owner", currentAgentId: REVIEWER, status: "working", completedAt: null, archivedAt: null,
    a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: platformReviewDriveTaskId(ITEM) } },
    ...over,
  };
}
function liveRoom(over: Record<string, unknown> = {}) {
  return {
    id: "room-1", capsuleId: platformReviewRoomCapsuleId(ITEM), idempotencyKey: `platform-review:${ITEM}`, source: "scheduled-steward",
    status: "working", archivedAt: null, outcomeAnchor: { kind: "backlog-item", id: ITEM },
    scopeClaims: [buildWorkShapeClaim(PLATFORM_REVIEW_SHAPE_REF, NOW), buildWorkShapeRoleBindingsClaim({ "post-implementation-reviewer": `agent:${REVIEWER}` }, NOW)],
    ...over,
  };
}
function authorityDeps(options: { room?: unknown; issued?: unknown; actors?: string[]; current?: unknown[] | null } = {}) {
  return {
    db: {
      workroom: { findUnique: vi.fn(async () => (options.room === undefined ? liveRoom() : options.room)) },
      workroomActivity: { findFirst: vi.fn(async () => (options.issued === undefined
        ? { payload: { itemId: ITEM, requestCoworker: packet(), issuer }, recordedByAgentId: PLATFORM_REVIEW_ISSUER_ID, recordedById: null }
        : options.issued)) },
    },
    loadDeliveryActorIds: vi.fn(async () => ok(options.actors ?? ["AGT-EXT-GROK"])),
    issuedPackets: vi.fn(async () => (options.current === undefined ? [packet()] : options.current) as Array<Record<string, unknown>> | null),
  };
}

describe("the platform review run's writer authority (BI-AA47C672)", () => {
  it("admits the room's run for the platform-issued packet readiness still issues, re-derived for the same issuer", async () => {
    const deps = authorityDeps();
    const authority = await loadPlatformReviewRunAuthority(deps as never, run());
    expect(authority).toEqual(ok({ itemId: ITEM, binding: expect.objectContaining({ itemId: ITEM, gate: "post-implementation-review" }) }));
    expect(deps.issuedPackets).toHaveBeenCalledWith(ITEM, issuer);
  });

  it.each([
    ["an external task", run({ taskRunId: "TR-MCP-1", a2aMetadata: { trigger: "external-mcp" } }), {}, "not-a-platform-review-run"],
    ["another room's drive run", run({ a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: "workroom-WC-ACC-1-acceptance-verification" } } }), {}, "not-a-platform-review-run"],
    ["a finished run", run({ status: "completed" }), {}, "run-not-executing"],
    ["a closed room", run(), { room: liveRoom({ status: "archived" }) }, "room-not-bound"],
    ["a room bound to another reviewer", run(), { room: liveRoom({ scopeClaims: [buildWorkShapeClaim(PLATFORM_REVIEW_SHAPE_REF, NOW), buildWorkShapeRoleBindingsClaim({ "post-implementation-reviewer": "agent:AGT-OTHER" }, NOW)] }) }, "room-not-bound"],
    ["a packet a coworker wrote", run(), { issued: { payload: { itemId: ITEM, requestCoworker: packet(), issuer }, recordedByAgentId: REVIEWER, recordedById: null } }, "packet-not-server-issued"],
    ["no packet", run(), { issued: null }, "packet-not-issued"],
    ["a delivery actor", run(), { actors: [REVIEWER] }, "reviewer-delivered-item"],
    ["a packet readiness no longer issues", run(), { current: [] }, "packet-no-longer-owed"],
    ["unreadable readiness", run(), { current: null }, "packet-no-longer-owed"],
  ] as const)("refuses %s", async (_case, theRun, options, reason) => {
    const authority = await loadPlatformReviewRunAuthority(authorityDeps(options as never) as never, theRun as never);
    expect(authority).toEqual(expect.objectContaining({ ok: false, reason }));
  });

  it("fails closed when the delivery actors cannot be read", async () => {
    const deps = { ...authorityDeps(), loadDeliveryActorIds: vi.fn(async () => err("too many rooms")) };
    await expect(loadPlatformReviewRunAuthority(deps as never, run())).resolves.toEqual(expect.objectContaining({ reason: "delivery-actors-unavailable" }));
  });
});

describe("independence under a coworker's other name (BI-AA47C672)", () => {
  it("treats an item that records the reviewer by its slug as delivered by that reviewer", async () => {
    const db = routeDb();
    await expect(routeReviewToPlatformReviewer({ deps: routeDeps(db, ["change-reviewer"]), itemId: ITEM, requestCoworker: packet(), issuer, now: NOW }))
      .resolves.toEqual({ kind: "ineligible", detail: expect.stringMatching(/delivered/) });
    await expect(loadPlatformReviewRunAuthority(authorityDeps({ actors: ["change-reviewer"] }) as never, run()))
      .resolves.toEqual(expect.objectContaining({ reason: "reviewer-delivered-item" }));
  });
});
