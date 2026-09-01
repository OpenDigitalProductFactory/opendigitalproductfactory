import { describe, expect, it, vi } from "vitest";

import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { recoverStaleApprovedRemoteTask } from "./mcp-task-approval-recovery";
import type { RecoverableTaskRun } from "./mcp-task-approval-recovery-contract";

const NOW = new Date("2026-08-28T13:45:30.000Z");
const TASK_RUN_ID = "TR-MCP-BI47-96433C11CA61";
const REQUEST_DIGEST = "10ae1afed510cded84185015a76806dc09702a693100e3b7dfe6e8281d831df5";

const binding: CoworkerApprovalBinding = {
  actingHumanUserId: "user-1",
  actingAgentId: "AGT-WS-PORTFOLIO",
  chainId: null,
  taskRunId: TASK_RUN_ID,
  toolName: "record_initiative_evidence",
  subject: { kind: "backlog-item", id: "BI-47ACE2C7" },
  routeContext: "/build",
  inputFingerprint: "1bf298b6f4641c8700535c9bc6c73613a2a88708343fab39cb97c62e848133b1",
  sensitivity: "internal",
  decisionVersionFingerprint: "54c71d9f3f5a71a93660a11ef6888bbb66540b2815e14a95f0f1f59e06a94e49",
};

function staleRun(
  status: "working" | "stalled" | "input-required" | "failed" = "stalled",
): RecoverableTaskRun {
  return {
    id: "task-internal",
    taskRunId: TASK_RUN_ID,
    status,
    updatedAt: new Date("2026-08-28T13:45:27.405Z"),
    lastHeartbeatAt: new Date("2026-08-28T13:05:21.350Z"),
    completedAt: status === "stalled" || status === "failed"
      ? new Date("2026-08-28T13:45:27.398Z")
      : null,
    progressPayload: null,
    a2aMetadata: {
      requestDigest: REQUEST_DIGEST,
      ...(status === "failed" ? {
        initiativeReviewBinding: {
          itemId: "BI-47ACE2C7",
          artifactRef: {
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            commitSha: "head-reviewed",
          },
        },
      } : {}),
    },
  };
}

function expiredEnvelope() {
  return {
    id: "cmtcyo4h900m001pa2ma0itjn",
    coworkerAgentId: binding.actingAgentId,
    delegatingUserId: binding.actingHumanUserId,
    threadId: "thread-bi47",
    chatMessageId: null,
    manifestActionId: binding.toolName,
    argsJson: { approvalBinding: binding },
    rationale: "Approval is required.",
    status: "approved",
    taskRunId: TASK_RUN_ID,
    delegationChainId: null,
    authorityDecisionId: "AUTH-BI47",
    inputFingerprint: binding.inputFingerprint,
    approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
    expiresAt: new Date("2026-08-28T13:17:04.457Z"),
  };
}

function proposal() {
  return {
    id: "tool-proposal-old",
    threadId: "thread-bi47",
    agentId: binding.actingAgentId,
    userId: "user-1",
    toolName: binding.toolName,
    parameters: {
      decision: "pass",
      backlogItemId: "BI-47ACE2C7",
      _takAlignment: { verdict: "aligned" },
    },
    result: {
      success: false,
      data: { envelopeId: "cmtcyo4h900m001pa2ma0itjn" },
      message: "Approval is required.",
    },
    success: false,
    executionMode: "proposal",
    routeContext: "/build",
    auditClass: "governed",
    capabilityId: null,
    summary: "Approval required",
    apiTokenId: "PAT-BI47",
    taskRunId: TASK_RUN_ID,
    skillId: null,
    delegatingUserId: "user-1",
    chatMessageId: null,
    envelopeId: null,
    delegationChainId: null,
  };
}

function fakeDb(run = staleRun(), envelope = expiredEnvelope()) {
  const taskRun = {
    findUnique: vi.fn().mockResolvedValue(run),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const coworkerActionEnvelope = {
    findFirst: vi.fn().mockResolvedValue(envelope),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({ id: "ENV-REPLACEMENT" }),
  };
  const toolExecution = {
    findFirst: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(proposal()),
    create: vi.fn().mockResolvedValue({ id: "tool-proposal-new" }),
  };
  const workroom = {
    findMany: vi.fn().mockResolvedValue([{ capsuleId: "WC-BI47", headSha: "head-reviewed" }]),
  };
  const tx = { taskRun, coworkerActionEnvelope, toolExecution, workroom };
  return {
    tx,
    db: { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) },
  };
}

function failedReviewFixture(workroomHead = "a36f5d40b7fbf9de4848b18875009622e04e77f4") {
  const taskRunId = "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-ECA9859FC982";
  const commitSha = "a36f5d40b7fbf9de4848b18875009622e04e77f4";
  const failedBinding: CoworkerApprovalBinding = {
    ...binding,
    actingAgentId: "AGT-WS-REVIEW",
    taskRunId,
    toolName: "record_initiative_design_review",
    subject: { kind: "platform", id: "dpf" },
    inputFingerprint: "6a109f8e494f557c17f8d8333d80a2b2384bff06efae39099214c2ee74a324ca",
  };
  const run = {
    ...staleRun("failed"),
    taskRunId,
    progressPayload: {
      summary: `No live workroom for this subject records head ${commitSha}: WC-31648CD6 has head 9c761214.`,
    },
    a2aMetadata: {
      requestDigest: REQUEST_DIGEST,
      initiativeReviewBinding: {
        itemId: "BI-F48D7059",
        artifactRef: {
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commitSha,
        },
      },
    },
  };
  const envelope = {
    ...expiredEnvelope(),
    id: "cmtdnvz9p00pk01njobcvcjkj",
    coworkerAgentId: failedBinding.actingAgentId,
    manifestActionId: failedBinding.toolName,
    argsJson: { approvalBinding: failedBinding },
    taskRunId,
    inputFingerprint: failedBinding.inputFingerprint,
    approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(failedBinding),
    expiresAt: new Date("2026-08-28T13:50:00.000Z"),
  };
  const failedProposal = {
    ...proposal(),
    id: "cmtdnvzar00pm01nj2a9svwna",
    agentId: failedBinding.actingAgentId,
    toolName: failedBinding.toolName,
    parameters: { decision: "pass", profile: "fix", artifactRole: "design-spec", findings: [] },
    result: { success: false, data: { envelopeId: envelope.id }, error: "approval_required" },
    taskRunId,
  };
  const fixture = fakeDb(run, envelope);
  fixture.tx.toolExecution.findFirst.mockReset()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(failedProposal);
  fixture.tx.workroom.findMany.mockResolvedValue([{ capsuleId: "WC-31648CD6", headSha: workroomHead }]);
  return { ...fixture, run, envelope, failedBinding };
}

function recover(db: ReturnType<typeof fakeDb>["db"]) {
  return recoverStaleApprovedRemoteTask({
    taskRunId: TASK_RUN_ID,
    requestDigest: REQUEST_DIGEST,
    expectedUpdatedAt: new Date("2026-08-28T13:45:27.405Z"),
    userId: "user-1",
    agentId: binding.actingAgentId,
    writerToolName: binding.toolName,
    now: NOW,
  }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>);
}

describe("same-TaskRun approval recovery", () => {
  it("supersedes an expired approval and recreates its exact proposal on the stalled TaskRun", async () => {
    const { db, tx } = fakeDb();

    const result = await recover(db);

    expect(result).toEqual({
      kind: "fresh-approval-required",
      sourceEnvelopeId: "cmtcyo4h900m001pa2ma0itjn",
      replacementEnvelopeId: "ENV-REPLACEMENT",
      replacementProposalExecutionId: "tool-proposal-new",
    });
    expect(tx.coworkerActionEnvelope.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cmtcyo4h900m001pa2ma0itjn",
        status: "approved",
        expiresAt: { lte: NOW },
      },
      data: { status: "cancelled", resolvedAt: NOW },
    });
    expect(tx.coworkerActionEnvelope.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskRunId: TASK_RUN_ID,
        status: "proposed",
        manifestActionId: "record_initiative_evidence",
        argsJson: { approvalBinding: binding },
        approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
        expiresAt: new Date("2026-08-28T14:00:30.000Z"),
        resolvedAt: null,
      }),
      select: { id: true },
    });
    expect(tx.toolExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskRunId: TASK_RUN_ID,
        toolName: "record_initiative_evidence",
        parameters: proposal().parameters,
        result: expect.objectContaining({
          data: { envelopeId: "ENV-REPLACEMENT" },
        }),
        success: false,
        executionMode: "proposal",
      }),
      select: { id: true },
    });
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith({
      where: {
        taskRunId: TASK_RUN_ID,
        status: "stalled",
        updatedAt: new Date("2026-08-28T13:45:27.405Z"),
      },
      data: {
        status: "input-required",
        completedAt: null,
        progressPayload: {
          approvalRecovery: {
            schemaVersion: 1,
            kind: "expired-approved-envelope",
            requestDigest: REQUEST_DIGEST,
            sourceStatus: "stalled",
            sourceEnvelopeId: "cmtcyo4h900m001pa2ma0itjn",
            replacementEnvelopeId: "ENV-REPLACEMENT",
            replacementProposalExecutionId: "tool-proposal-new",
            approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
            observedAt: NOW.toISOString(),
            inferenceRerun: false,
            freshApprovalRequired: true,
          },
        },
      },
    });
  });

  it("supersedes an expired approval on the same stale input-required TaskRun", async () => {
    const { db, tx } = fakeDb(staleRun("input-required"));

    const result = await recover(db);

    expect(result).toEqual({
      kind: "fresh-approval-required",
      sourceEnvelopeId: "cmtcyo4h900m001pa2ma0itjn",
      replacementEnvelopeId: "ENV-REPLACEMENT",
      replacementProposalExecutionId: "tool-proposal-new",
    });
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "input-required" }),
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          approvalRecovery: expect.objectContaining({
            sourceStatus: "input-required",
            inferenceRerun: false,
            freshApprovalRequired: true,
          }),
        }),
      }),
    }));
  });

  it("supersedes an expired proposed envelope without rerunning the same TaskRun review", async () => {
    const envelope = { ...expiredEnvelope(), status: "proposed" };
    const { db, tx } = fakeDb(staleRun("input-required"), envelope);

    const result = await recover(db);

    expect(result).toEqual({
      kind: "fresh-approval-required",
      sourceEnvelopeId: envelope.id,
      replacementEnvelopeId: "ENV-REPLACEMENT",
      replacementProposalExecutionId: "tool-proposal-new",
    });
    expect(tx.coworkerActionEnvelope.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        taskRunId: TASK_RUN_ID,
        status: { in: ["approved", "failed", "proposed"] },
      }),
    }));
    expect(tx.coworkerActionEnvelope.updateMany).toHaveBeenCalledWith({
      where: {
        id: envelope.id,
        status: "proposed",
        expiresAt: { lte: NOW },
      },
      data: { status: "cancelled", resolvedAt: NOW },
    });
    expect(tx.coworkerActionEnvelope.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskRunId: TASK_RUN_ID,
        status: "proposed",
        argsJson: envelope.argsJson,
        approvalBindingFingerprint: envelope.approvalBindingFingerprint,
      }),
    }));
    expect(tx.toolExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskRunId: TASK_RUN_ID,
        parameters: proposal().parameters,
        executionMode: "proposal",
      }),
    }));
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "input-required",
        progressPayload: expect.objectContaining({
          approvalRecovery: expect.objectContaining({
            kind: "expired-proposed-envelope",
            sourceEnvelopeId: envelope.id,
            inferenceRerun: false,
            freshApprovalRequired: true,
          }),
        }),
      }),
    }));
  });

  it("refuses to replace an unexpired approval on an input-required TaskRun", async () => {
    const envelope = { ...expiredEnvelope(), expiresAt: new Date("2026-08-28T13:50:00.000Z") };
    const { db, tx } = fakeDb(staleRun("input-required"), envelope);

    await expect(recover(db)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(tx.toolExecution.create).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to replace an unexpired proposed envelope", async () => {
    const envelope = {
      ...expiredEnvelope(),
      status: "proposed",
      expiresAt: new Date("2026-08-28T13:50:00.000Z"),
    };
    const { db, tx } = fakeDb(staleRun("input-required"), envelope);

    await expect(recover(db)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(tx.toolExecution.create).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("parks an unexpired approved envelope for immediate same-TaskRun resume without replacing it", async () => {
    const envelope = { ...expiredEnvelope(), expiresAt: new Date("2026-08-28T13:50:00.000Z") };
    const { db, tx } = fakeDb(staleRun("working"), envelope);

    const result = await recover(db);

    expect(result).toEqual({
      kind: "approved-resume-ready",
      envelopeId: envelope.id,
    });
    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(tx.toolExecution.create).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "working" }),
      data: expect.objectContaining({ status: "input-required", completedAt: null }),
    }));
  });

  it("re-parks a failed same-TaskRun approval replay after its exact Workroom head prerequisite is repaired", async () => {
    const { db, tx, run, envelope, failedBinding } = failedReviewFixture();

    const result = await recoverStaleApprovedRemoteTask({
      taskRunId: run.taskRunId,
      requestDigest: REQUEST_DIGEST,
      expectedUpdatedAt: run.updatedAt,
      userId: "user-1",
      agentId: failedBinding.actingAgentId,
      writerToolName: failedBinding.toolName,
      now: NOW,
    }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>);

    expect(result).toEqual({ kind: "approved-resume-ready", envelopeId: envelope.id });
    expect(tx.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        backlogItemId: "BI-F48D7059",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      }),
    }));
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "failed" }),
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          approvalRecovery: expect.objectContaining({
            kind: "failed-prerequisite-approved-envelope",
            sourceStatus: "failed",
            inferenceRerun: false,
            freshApprovalRequired: false,
          }),
        }),
      }),
    }));
  });

  it("supersedes a failed provider-provenance envelope on the same TaskRun", async () => {
    const { db, tx, run, envelope, failedBinding } = failedReviewFixture();
    const providerRun = {
      ...run,
      progressPayload: {
        summary: "Repository provider could not resolve immutable commit provenance.",
      },
    };
    const failedEnvelope = {
      ...envelope,
      status: "failed",
      expiresAt: new Date("2026-08-28T13:40:00.000Z"),
    };
    tx.taskRun.findUnique.mockResolvedValue(providerRun);
    tx.coworkerActionEnvelope.findFirst.mockResolvedValue(failedEnvelope);
    tx.coworkerActionEnvelope.updateMany.mockResolvedValue({ count: 1 });

    const result = await recoverStaleApprovedRemoteTask({
      taskRunId: run.taskRunId,
      requestDigest: REQUEST_DIGEST,
      expectedUpdatedAt: run.updatedAt,
      userId: "user-1",
      agentId: failedBinding.actingAgentId,
      writerToolName: failedBinding.toolName,
      now: NOW,
    }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>);

    expect(result).toEqual({
      kind: "fresh-approval-required",
      sourceEnvelopeId: failedEnvelope.id,
      replacementEnvelopeId: "ENV-REPLACEMENT",
      replacementProposalExecutionId: "tool-proposal-new",
    });
    expect(tx.workroom.findMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.updateMany).toHaveBeenCalledWith({
      where: {
        id: failedEnvelope.id,
        status: "failed",
        expiresAt: { lte: NOW },
      },
      data: { status: "cancelled", resolvedAt: NOW },
    });
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        progressPayload: expect.objectContaining({
          approvalRecovery: expect.objectContaining({
            kind: "failed-provider-envelope",
            sourceEnvelopeId: failedEnvelope.id,
            freshApprovalRequired: true,
            inferenceRerun: false,
          }),
        }),
      }),
    }));
  });

  it("refuses a failed envelope when the failure is not immutable provider provenance", async () => {
    const { db, tx, run, envelope, failedBinding } = failedReviewFixture();
    tx.taskRun.findUnique.mockResolvedValue({
      ...run,
      progressPayload: { summary: "CANONICAL_DESIGN_REQUIRED: findings present." },
    });
    tx.coworkerActionEnvelope.findFirst.mockResolvedValue({
      ...envelope,
      status: "failed",
      expiresAt: new Date("2026-08-28T13:40:00.000Z"),
    });

    await expect(recoverStaleApprovedRemoteTask({
      taskRunId: run.taskRunId,
      requestDigest: REQUEST_DIGEST,
      expectedUpdatedAt: run.updatedAt,
      userId: "user-1",
      agentId: failedBinding.actingAgentId,
      writerToolName: failedBinding.toolName,
      now: NOW,
    }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
  });

  it("refuses failed replay recovery while the Workroom still records a stale head", async () => {
    const { db, tx, run, failedBinding } = failedReviewFixture("9c761214a76a6f0f13e24cbb7f13e1283430181b");

    await expect(recoverStaleApprovedRemoteTask({
      taskRunId: run.taskRunId,
      requestDigest: REQUEST_DIGEST,
      expectedUpdatedAt: run.updatedAt,
      userId: "user-1",
      agentId: failedBinding.actingAgentId,
      writerToolName: failedBinding.toolName,
      now: NOW,
    }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses failed replay recovery without the exact approved envelope", async () => {
    const { db, tx, run, failedBinding } = failedReviewFixture();
    tx.coworkerActionEnvelope.findFirst.mockResolvedValue(null);

    await expect(recoverStaleApprovedRemoteTask({
      taskRunId: run.taskRunId,
      requestDigest: REQUEST_DIGEST,
      expectedUpdatedAt: run.updatedAt,
      userId: "user-1",
      agentId: failedBinding.actingAgentId,
      writerToolName: failedBinding.toolName,
      now: NOW,
    }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>)).resolves.toBeNull();

    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unrelated failed TaskRun even when its Workroom head matches", async () => {
    const { db, tx, run, failedBinding } = failedReviewFixture();
    tx.taskRun.findUnique.mockResolvedValue({
      ...run,
      progressPayload: { summary: "Provider request failed." },
    });

    await expect(recoverStaleApprovedRemoteTask({
      taskRunId: run.taskRunId,
      requestDigest: REQUEST_DIGEST,
      expectedUpdatedAt: run.updatedAt,
      userId: "user-1",
      agentId: failedBinding.actingAgentId,
      writerToolName: failedBinding.toolName,
      now: NOW,
    }, db as NonNullable<Parameters<typeof recoverStaleApprovedRemoteTask>[1]>)).resolves.toBeNull();

    expect(tx.workroom.findMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses input-required recovery while the TaskRun heartbeat is fresh", async () => {
    const run = { ...staleRun("input-required"), lastHeartbeatAt: new Date("2026-08-28T13:44:30.000Z") };
    const { db, tx } = fakeDb(run);

    await expect(recover(db)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses input-required recovery when the stored approval binding conflicts", async () => {
    const conflicting = {
      ...binding,
      taskRunId: "TR-MCP-DIFFERENT",
    };
    const envelope = {
      ...expiredEnvelope(),
      argsJson: { approvalBinding: conflicting },
      approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(conflicting),
    };
    const { db, tx } = fakeDb(staleRun("input-required"), envelope);

    await expect(recover(db)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
    expect(tx.toolExecution.create).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses recovery when a writer already succeeded or produced a receipt", async () => {
    const { db, tx } = fakeDb();
    tx.toolExecution.findFirst.mockReset().mockResolvedValueOnce({ id: "writer-success" });

    await expect(recover(db)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("refuses recovery when the transaction sees a different stored request digest", async () => {
    const run = { ...staleRun(), a2aMetadata: { requestDigest: "different" } };
    const { db, tx } = fakeDb(run);

    await expect(recover(db)).resolves.toBeNull();

    expect(tx.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });
});
