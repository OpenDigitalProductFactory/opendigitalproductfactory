"use server";

import { requireUser } from "./shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getResponseFeedback, getResponseFeedbackAnswer, recordResponseFeedback, type ResponseFeedbackInput, type ResponseFeedbackState, type ResponseFeedbackAnswer } from "@/lib/routing/response-feedback";

export async function getResponseFeedbackAction(messageId: string): Promise<ActionResult<ResponseFeedbackState>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return err("forbidden"); }
  if (typeof messageId !== "string" || !messageId.trim()) return err("unavailable");
  try { return ok(await getResponseFeedback(messageId, { userId })); }
  catch (error) { return err(error instanceof Error && error.message === "forbidden" ? "forbidden" : "save-failed"); }
}

export async function recordResponseFeedbackAction(input: ResponseFeedbackInput): Promise<ActionResult<{ state: ResponseFeedbackState; changed: boolean }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return err("forbidden"); }
  if (!input || typeof input !== "object") return err("unavailable");
  const result = await recordResponseFeedback({ messageId: input.messageId, value: input.value, expectedRevision: input.expectedRevision }, { userId, surface: "portal" });
  return result;
}

export async function getResponseFeedbackAnswerAction(messageId: string, expectedAttemptId: string): Promise<ActionResult<ResponseFeedbackAnswer>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return err("forbidden"); }
  if (typeof messageId !== "string" || !messageId.trim() || typeof expectedAttemptId !== "string" || !expectedAttemptId.trim()) return err("unavailable");
  try {
    const answer = await getResponseFeedbackAnswer(messageId, expectedAttemptId, { userId });
    return answer ? ok(answer) : err("unavailable");
  } catch (error) { return err(error instanceof Error && error.message === "forbidden" ? "forbidden" : "save-failed"); }
}
