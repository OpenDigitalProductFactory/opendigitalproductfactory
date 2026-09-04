// Self-test for the unattributable-deferral guard (BI-9DA5F179).
//
// The guard has to separate three things that all contain the same string:
// a BacklogItem write that parks an item, a `where` filter that merely selects
// deferred rows, and a plain return value from some unrelated function. Only the
// first is a defect, and only when it carries no deferral.

import assert from "node:assert/strict";
import test from "node:test";

import { findUnattributableDeferrals } from "./check-no-unattributable-deferral.mjs";

/** The exact shape that parked seven items, including BI-F0715C9C. */
const HISTORICAL_DEFECT = `
  if (originatingBacklogItemId) {
    try {
      await prisma.backlogItem.update({
        where: { id: originatingBacklogItemId },
        data: { status: "deferred", activeBuildId: null, updatedAt: now },
      });
      backlogItemDeferred = true;
    } catch (err) {
      await safeLog("failed");
    }
  }
`;

test("catches the historical escalation park with no deferral", () => {
  const hits = findUnattributableDeferrals("apps/web/lib/build/escalate-build-to-human.ts", HISTORICAL_DEFECT);
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /status: "deferred"/);
});

test("passes a write that carries the deferral fields", () => {
  const ok = `
    await tx.backlogItem.update({
      where: { id },
      data: {
        status: "deferred",
        deferReason: reason,
        deferTrigger: trigger,
        deferReviewAt: reviewAt,
        deferOwnerPrincipalId: ownerId,
      },
    });
  `;
  assert.deepEqual(findUnattributableDeferrals("a.ts", ok), []);
});

test("passes a write that spreads a deferral projection, as the governed action does", () => {
  const ok = `
    await tx.backlogItem.update({
      where: { id },
      data: { status: "deferred", ...deferralProjection },
    });
  `;
  assert.deepEqual(findUnattributableDeferrals("a.ts", ok), []);
});

test("ignores a where-filter that merely selects deferred rows", () => {
  const readOnly = `
    const count = await prisma.backlogItem.count({
      where: { status: "deferred" },
    });
  `;
  assert.deepEqual(findUnattributableDeferrals("a.ts", readOnly), []);
});

test("ignores an unrelated return value that happens to use the same string", () => {
  const unrelated = `
    return {
      ok: false,
      status: "deferred",
      runId: run.runId,
      reason: outcome.outcome,
    };
  `;
  assert.deepEqual(findUnattributableDeferrals("apps/web/lib/queue/functions/self-upgrade.ts", unrelated), []);
});

test("reports the offending line number, not the line the write started on", () => {
  const hits = findUnattributableDeferrals("a.ts", HISTORICAL_DEFECT);
  const lines = HISTORICAL_DEFECT.split("\n");
  assert.match(lines[hits[0].line - 1], /status: "deferred"/);
});

/** The second class (2026-09-02): the work-sync mirror copied a peer's status
 *  through, 19 lines above the upsert, with no literal "deferred" in the file. */
const PASSTHROUGH_DEFECT = `
  const data = {
    title: item.title,
    status: item.status,
    type: item.type,
    body: withFederatedWorkOriginMarker(item.body, origin, item.itemId),
    priority: item.priority,
    workType: item.workType,
    triageOutcome: item.triageOutcome,
    effortSize: item.effortSize,
    proposedOutcome: item.proposedOutcome,
    resolution: item.resolution,
    sensitivity: item.sensitivity,
    source: item.source,
    occurrenceCount: item.occurrenceCount,
    scopeKind: item.scopeKind,
    archetypeCategories: item.archetypeCategories,
    archetypeIds: item.archetypeIds,
    lifecycleTags: item.lifecycleTags,
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    epicId: item.epicId ? (epicLocalIds.get(item.epicId) ?? null) : null,
  };
  await db.backlogItem.upsert({
    where: { itemId: item.itemId },
    create: { itemId: item.itemId, createdAt: new Date(item.createdAt), ...data },
    update: data,
    select: { id: true },
  });
`;

test("catches a status copied through from another record into a BacklogItem write, even 19 lines from the call", () => {
  const hits = findUnattributableDeferrals("apps/web/lib/federation/work-sync.ts", PASSTHROUGH_DEFECT);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "passthrough");
  assert.match(hits[0].text, /status: item\.status/);
});

test("passes a pass-through status that spreads a deferral projection beside it", () => {
  const ok = PASSTHROUGH_DEFECT.replace("status: item.status,", "status: item.status,\n    ...deferral.projection,");
  assert.deepEqual(findUnattributableDeferrals("a.ts", ok), []);
});

test("ignores a JSON snapshot column on a provenance row", () => {
  const snapshot = `
    await db.federatedRecordMirror.upsert({
      where: mirrorWhere,
      create: { payload: { title: item.title, status: item.status, updatedAt: item.updatedAt } },
    });
    await db.backlogItem.upsert({ where: { itemId: item.itemId }, update: data });
  `;
  assert.deepEqual(findUnattributableDeferrals("a.ts", snapshot), []);
});
