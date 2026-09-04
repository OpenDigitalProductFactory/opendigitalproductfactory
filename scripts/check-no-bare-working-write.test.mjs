// BI-3B6DC1DC — the guard must police TaskRun writes, and only those.
//
// It exists so TaskRun.status="working" always lands with lastHeartbeatAt, or
// the stall watchdog false-positives. Matching the literal anywhere in a file
// made a Workroom upsert trip a TaskRun guard, and every allowlist entry added
// for a non-TaskRun model makes the allowlist a weaker signal about the thing
// the guard actually protects.

import assert from "node:assert/strict";
import { test } from "node:test";

import { findTaskRunWorkingWrites } from "./check-no-bare-working-write.mjs";

test("catches a bare TaskRun working-write", () => {
  const body = `
    await prisma.taskRun.update({
      where: { taskRunId },
      data: { status: "working" },
    });
  `;
  assert.equal(findTaskRunWorkingWrites(body).length, 1);
});

test("catches it through updateMany and create too", () => {
  const many = `await prisma.taskRun.updateMany({ where: { taskRunId }, data: { status: "working" } });`;
  const created = `await prisma.taskRun.create({ data: { taskRunId, status: "working" } });`;
  assert.equal(findTaskRunWorkingWrites(many).length, 1);
  assert.equal(findTaskRunWorkingWrites(created).length, 1);
});

test("ignores a Workroom write, which has no heartbeat contract", () => {
  const body = `
    const room = await prisma.workroom.upsert({
      where: { idempotencyKey: GOVERNANCE_ROOM_KEY },
      create: { title: "Decision governance", status: "working" },
    });
  `;
  assert.deepEqual(findTaskRunWorkingWrites(body), []);
});

test("ignores any other model's status field", () => {
  for (const model of ["workItem", "featureBuild", "deliberationRun", "scheduledJob"]) {
    const body = `await prisma.${model}.update({ where: { id }, data: { status: "working" } });`;
    assert.deepEqual(findTaskRunWorkingWrites(body), [], `${model} must not trip the TaskRun guard`);
  }
});

test("a nearby TaskRun write does not launder a Workroom write", () => {
  const body = `
    await prisma.taskRun.update({ where: { taskRunId }, data: { lastHeartbeatAt: new Date() } });

    await prisma.workroom.upsert({ where: { key }, create: { status: "working" } });
  `;
  assert.deepEqual(findTaskRunWorkingWrites(body), []);
});
