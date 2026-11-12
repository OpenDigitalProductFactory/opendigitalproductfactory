"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { getResponseFeedbackAnswerAction } from "@/lib/actions/response-feedback";
import type { ResponseFeedbackState } from "@/lib/routing/response-feedback";
import { MarkdownHtml } from "@/components/shared/MarkdownHtml";
import { ResponseFeedback } from "@/components/agent/ResponseFeedback";
const BUTTON = "inline-flex min-h-11 min-w-11 items-center rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";
/** The general routing projection supplies only a locator; current answer access is checked separately. */
export function RoutingResponseReview({messageId,expectedAttemptId,onBack}:{messageId:string;expectedAttemptId:string;onBack:()=>void}) {
  const t=useT("routingManagement");
  const [answer,setAnswer]=useState<{content:string;state:ResponseFeedbackState;attemptId:string;providerId:string;modelId:string}|null>(null);
  const [status,setStatus]=useState<"loading"|"unavailable"|"ready">("loading");
  const [revision,setRevision]=useState(0);
  const backRef=useRef<HTMLButtonElement>(null);
  const current=useRef(0);
  useEffect(()=>{backRef.current?.focus();},[messageId]);
  useEffect(()=>{
    const generation=++current.current;setAnswer(null);setStatus("loading");
    void getResponseFeedbackAnswerAction(messageId,expectedAttemptId).then(result=>{
      if(generation!==current.current)return;
      if(!result.ok||!result.data.state.available){setStatus("unavailable");return;}
      setAnswer(result.data);setStatus("ready");
    }).catch(()=>{if(generation===current.current)setStatus("unavailable");});
    return()=>{current.current++;};
  },[messageId,expectedAttemptId,revision]);
  return <section aria-label={t("savedAnswer")} className="min-w-0 space-y-3">
    <button ref={backRef} type="button" data-surface-node-id="feedback.back-to-decision" className={BUTTON} onClick={onBack}>{t("backToDecision")}</button>
    <p role="status" aria-live="polite" className="text-sm text-[var(--dpf-muted)]">{status==="loading"?t("loadingAnswer"):status==="unavailable"?t("answerUnavailable"):null}</p>
    {status==="unavailable"&&<button type="button" data-surface-node-id="feedback.review-answer" className={BUTTON} onClick={()=>{backRef.current?.focus();setRevision(value=>value+1);}}>{t("retryAnswer")}</button>}
    {answer&&<><p className="break-words text-sm font-medium">{answer.providerId} · {answer.modelId}</p><div className="min-w-0 break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto"><MarkdownHtml source={answer.content}/></div><ResponseFeedback key={messageId} messageId={messageId} eligible initialState={answer.state}/></>}
  </section>;
}
