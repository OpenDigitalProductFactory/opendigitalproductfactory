"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
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
  return (await requireCapability("view_platform")).userId;
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

  // BI-6DCF772F: if the human picked a structured option, it must be one of the
  // options the gate actually scored — otherwise chosenOptionId would never
  // resolve against scoredOptions and the weight-inference adapter would drop
  // the row. A malformed pick is rejected before any write.
  // scoredOptions is a Json column (DecisionOption[]); read it as unknown and
  // narrow, mirroring weight-inference-adapter.ts, so this does not depend on
  // the generated row shape.
  const rawScoredOptions = (row as { scoredOptions?: unknown }).scoredOptions;
  const scoredIds = Array.isArray(rawScoredOptions)
    ? (rawScoredOptions as Array<{ id?: unknown }>)
      .map((option) => option?.id)
      .filter((id): id is string => typeof id === "string")
    : [];
  const chosenOptionId = (input.chosenOptionId ?? "").trim() || null;
  if (chosenOptionId && !scoredIds.includes(chosenOptionId)) {
    throw new Error("Chosen option is not one of the scored options for this decision");
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
          chosenOptionId,
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
            chosenOptionId,
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
        chosenOptionId,
        humanOutcome: {
          type: "deferral",
          gapReason: answer,
          suggestedSourceTypes,
          candidateMaterial: input.candidateMaterial === true,
          resolverUserId: userId,
          capturedAt,
          clearsGate: false,
          chosenOptionId,
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
