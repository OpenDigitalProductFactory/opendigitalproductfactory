"use server";

import { revalidatePath } from "next/cache";
import {
  linkNeedToBacklogItem,
  resolveCapabilityNeed,
} from "@/lib/coworker-self-assessment/assessment-service";
import {
  COWORKER_CAPABILITY_NEED_STATUSES,
  type CoworkerCapabilityNeedStatus,
} from "@/lib/coworker-self-assessment/types";

const REVIEW_PATH = "/platform/ai/capability-needs";
type ReviewDecisionStatus = Exclude<CoworkerCapabilityNeedStatus, "backlog-filed">;

const REVIEW_DECISION_STATUSES = new Set<ReviewDecisionStatus>([
  "reviewing",
  "accepted",
  "deferred",
  "duplicate",
  "discarded",
  "resolved",
]);

export async function resolveCoworkerCapabilityNeedAction(
  formData: FormData,
): Promise<void> {
  const needId = readString(formData.get("needId"));
  const status = readStatus(formData.get("status"));
  const duplicateOfId = readString(formData.get("duplicateOfId"));
  const reviewerNote = readString(formData.get("reviewerNote"));

  if (!needId || !status || !isReviewDecisionStatus(status)) return;
  if (status === "duplicate" && !duplicateOfId) {
    return;
  }

  await resolveCapabilityNeed(needId, {
    status,
    duplicateOfId: status === "duplicate" ? duplicateOfId : undefined,
    reviewerNote: reviewerNote || undefined,
  });
  revalidatePath(REVIEW_PATH);
}

export async function linkCoworkerCapabilityNeedToBacklogAction(
  formData: FormData,
): Promise<void> {
  const needId = readString(formData.get("needId"));
  const backlogItemId = readString(formData.get("backlogItemId")).toUpperCase();

  if (!needId || !/^BI-[A-Z0-9]+$/.test(backlogItemId)) return;

  await linkNeedToBacklogItem(needId, backlogItemId);
  revalidatePath(REVIEW_PATH);
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStatus(value: FormDataEntryValue | null): CoworkerCapabilityNeedStatus | null {
  const raw = readString(value);
  return COWORKER_CAPABILITY_NEED_STATUSES.includes(raw as CoworkerCapabilityNeedStatus)
    ? raw as CoworkerCapabilityNeedStatus
    : null;
}

function isReviewDecisionStatus(status: CoworkerCapabilityNeedStatus): status is ReviewDecisionStatus {
  return REVIEW_DECISION_STATUSES.has(status as ReviewDecisionStatus);
}
