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
