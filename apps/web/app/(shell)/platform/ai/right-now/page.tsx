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

import { auth } from "@/lib/auth";
import { loadWorkforceActivity } from "@/lib/platform-runtime/workforce-activity";
import { WorkforceNowShell } from "@/components/platform/WorkforceNowShell";

export const dynamic = "force-dynamic";

export default async function RightNowPage() {
  await auth(); // (shell)/platform layout gates platform access; render read-only.
  const initialData = await loadWorkforceActivity();
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[var(--dpf-text)]">Right Now</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          What each AI coworker is doing, what they&rsquo;ve gotten done today, and where nobody is
          acting. Sensitive-data activity is shown as an aggregate flag only. Resource load lives on
          the{" "}
          <a className="text-[var(--dpf-accent)] underline" href="/portfolio/product/dpf-portal/health">
            System Health
          </a>{" "}
          page.
        </p>
      </header>
      <WorkforceNowShell initialData={initialData} />
    </div>
  );
}
