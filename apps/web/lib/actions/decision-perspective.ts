"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import type { DecisionGateCaptureDraft } from "@/lib/decision-perspective/capture-types";

type CaptureType = "escalation" | "deferral";

type CaptureResult = {
  status: "captured" | "already-captured";
  captureType: CaptureType;
  captureId?: string;
};

function createCaptureId(prefix: "ESC" | "DEF"): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function splitLines(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

async function requireBuildCaptureUser(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user
    || !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_platform",
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

export async function captureDecisionInteraction(input: DecisionGateCaptureDraft & {
  buildId: string;
}): Promise<CaptureResult> {
  const userId = await requireBuildCaptureUser();
  const answer = trimmed(input.answer);
  if (!answer) {
    throw new Error("Human direction is required");
  }

  const row = await prisma.decisionInteraction.findUnique({
    where: { interactionId: input.interactionId },
    include: {
      build: {
        select: {
          buildId: true,
          createdById: true,
        },
      },
      escalationCapture: {
        select: { escalationId: true },
      },
      deferralCapture: {
        select: { deferralId: true },
      },
    },
  });

  if (!row || !row.build || row.build.buildId !== input.buildId) {
    throw new Error("Decision interaction not found");
  }
  if (row.build.createdById !== userId) {
    throw new Error("Forbidden");
  }
  if (row.outcomeType !== "escalate" && row.outcomeType !== "defer") {
    throw new Error("This WWMD outcome does not require capture");
  }
  if (row.outcomeType !== input.outcomeType) {
    throw new Error("Capture type does not match the WWMD outcome");
  }

  if (row.outcomeType === "escalate" && row.escalationCapture) {
    return {
      status: "already-captured",
      captureType: "escalation",
      captureId: row.escalationCapture.escalationId,
    };
  }
  if (row.outcomeType === "defer" && row.deferralCapture) {
    return {
      status: "already-captured",
      captureType: "deferral",
      captureId: row.deferralCapture.deferralId,
    };
  }

  const capturedAt = new Date().toISOString();
  const result = await prisma.$transaction(async (tx) => {
    if (row.outcomeType === "escalate") {
      const criteria = splitLines(input.criteriaText);
      const objectionsResolved = splitLines(input.objectionsResolvedText);
      const rationale = trimmed(input.rationale) || answer;
      const escalationId = createCaptureId("ESC");

      await tx.escalationCapture.create({
        data: {
          escalationId,
          interactionId: row.id,
          resolverUserId: userId,
          prompt: row.question,
          answer,
          criteria,
          rationale,
          objectionsResolved,
          domainClass: row.domainClass,
          candidateMaterial: input.candidateMaterial === true,
        },
      });
      await tx.decisionInteraction.update({
        where: { id: row.id },
        data: {
          humanOutcome: {
            type: "escalation",
            answer,
            rationale,
            criteria,
            objectionsResolved,
            candidateMaterial: input.candidateMaterial === true,
            resolverUserId: userId,
            capturedAt,
            clearsGate: true,
          },
        },
      });
      await tx.buildActivity.create({
        data: {
          buildId: input.buildId,
          tool: "wwmd_escalation_capture",
          summary: `WWMD human direction captured for ${row.interactionId}.`,
        },
      });

      return {
        status: "captured",
        captureType: "escalation",
        captureId: escalationId,
      } satisfies CaptureResult;
    }

    const suggestedSourceTypes = splitLines(input.suggestedSourceTypesText || input.criteriaText);
    const deferralId = createCaptureId("DEF");
    await tx.deferralCapture.create({
      data: {
        deferralId,
        interactionId: row.id,
        domain: row.domainClass,
        gapReason: answer,
        suggestedSourceTypes,
        candidateMaterial: input.candidateMaterial === true,
      },
    });
    await tx.decisionInteraction.update({
      where: { id: row.id },
      data: {
        humanOutcome: {
          type: "deferral",
          gapReason: answer,
          suggestedSourceTypes,
          candidateMaterial: input.candidateMaterial === true,
          resolverUserId: userId,
          capturedAt,
          clearsGate: false,
        },
      },
    });
    await tx.buildActivity.create({
      data: {
        buildId: input.buildId,
        tool: "wwmd_deferral_capture",
        summary: `WWMD coverage gap captured for ${row.interactionId}.`,
      },
    });

    return {
      status: "captured",
      captureType: "deferral",
      captureId: deferralId,
    } satisfies CaptureResult;
  });

  revalidatePath("/build");
  return result;
}
