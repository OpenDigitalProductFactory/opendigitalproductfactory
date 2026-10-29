import type { PrismaClient } from "../../../packages/db/generated/client/client";
import type { WorkCapsuleSource } from "../lib/work-capsules";

export const APPROVAL_FIXTURE_WORKROOM_SOURCE: WorkCapsuleSource = "external-adoption";
export function approvalFixtureScope(runKey: string, userId: string, principalId: string) {
  if (!/^ux-approval-\d+-\d+$/.test(runKey) || !userId || !principalId)
    throw new Error("Invalid isolated approval fixture ownership");
  return { roomId: "WC-" + runKey.toUpperCase(), taskRunId: "TR-" + runKey.toUpperCase(),
    threadId: runKey + "-presentation-only", contextKey: runKey + "-presentation-only",
    prefix: runKey + "-", userId, principalId };
}
type Scope = ReturnType<typeof approvalFixtureScope>;
export type ApprovalFixtureCase = { key: string; tool: string; args: Record<string, unknown>; expired?: boolean };
export async function prepareApprovalFixtures(db: PrismaClient, scope: Scope) {
  const { roomId, taskRunId, threadId, contextKey, userId, principalId, prefix } = scope;
  await db.$transaction(async tx => {
    if (await tx.coworkerActionEnvelope.count({ where: { id: { startsWith: prefix } } })
      || await tx.workroom.count({ where: { capsuleId: roomId } })
      || await tx.taskRun.count({ where: { taskRunId } })
      || await tx.agentThread.count({ where: { id: threadId } }))
      throw new Error("Approval fixture identity collision");
    await tx.workroom.create({ data: { capsuleId: roomId, title: "Review supplier commitments",
      objective: "CI presentation only; no execution or scheduling.", status: "draft", source: APPROVAL_FIXTURE_WORKROOM_SOURCE,
      createdByPrincipalId: principalId } });
    await tx.agentThread.create({ data: { id: threadId, userId, contextKey } });
    await tx.taskRun.create({ data: { taskRunId, userId, title: "Approval presentation fixture",
      objective: "Display only; never execute.", status: "completed", source: "coworker",
      a2aMetadata: { initiativeReviewBinding: { gate: "research", itemId: "BI-038AA4BC",
        writerToolName: "record_initiative_evidence", artifactRef: { kind: "repo-blob-at-commit",
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha: "89e875eb49be0604ee8fa4156d0903b6a0932e62",
          path: "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
          providerBlobId: "bddca7c5a0b109f9460f84b2b0d886f5d794cbb6" } } } } });
  });
}
export async function createApprovalFixtureEnvelope(db: PrismaClient, scope: Scope, value: ApprovalFixtureCase, suffix = value.key) {
  const { prefix, userId, threadId, taskRunId } = scope;
  const id = prefix + suffix;
  await db.coworkerActionEnvelope.create({ data: { id, delegatingUserId: userId,
    coworkerAgentId: value.key === "handover" ? "AGT-EXT-CODEX" : "AGT-WS-PORTFOLIO",
    threadId, manifestActionId: value.tool, argsJson: JSON.parse(JSON.stringify(value.args)),
    rationale: "CI presentation only; no action is authorized or executed.", status: "proposed",
    taskRunId: value.key === "research" ? taskRunId : null,
    expiresAt: new Date(Date.now() + (value.expired ? -1 : 60) * 60_000) } });
  return id;
}
export async function cleanupApprovalFixtures(db: PrismaClient, scope: Scope) {
  const { prefix, userId, threadId, taskRunId, roomId, principalId, contextKey } = scope;
  await db.$transaction(async tx => {
    await tx.coworkerActionEnvelope.deleteMany({ where: { id: { startsWith: prefix }, threadId, delegatingUserId: userId } });
    await tx.taskRun.deleteMany({ where: { taskRunId, userId, source: "coworker" } });
    await tx.agentThread.deleteMany({ where: { id: threadId, userId, contextKey } });
    await tx.workroom.deleteMany({ where: { capsuleId: roomId, source: APPROVAL_FIXTURE_WORKROOM_SOURCE, createdByPrincipalId: principalId } });
  });
}
