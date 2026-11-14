// apps/web/app/(shell)/platform/ai/right-now/page.tsx
//
// "Right Now" — the live AI workforce view (BI-1A68257F). The coworker is the
// unit, like a person: what each is doing, what they got done today (outcome
// digest), who the responsible human is, and where nobody is acting. Resources
// are a secondary concern with their own home (the System Health tab); this
// surface does not replicate them.
//
// Design grounding: extends EP-FULL-OBS. Founder-approved HTML prototype and
// kernel-scored surface decision (DI-B78B2A014223). Activity data comes from the
// workforce-activity loader over TaskRun/ToolExecution/TokenUsage; the
// action->outcome map is the curated translation layer. No new contract.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RightNowPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const source = searchParams ? await searchParams : {};
  const target = new URLSearchParams({ view: "activity" });
  for (const key of ["capsuleId", "taskRunId", "agentId"] as const) {
    const value = source[key];
    if (typeof value === "string") target.set(key, value);
  }
  redirect(`/workforce?${target.toString()}`);
}
